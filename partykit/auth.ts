// ABOUTME: Server-side auth/permissions policy: room-name parsing, .well-known config
// ABOUTME: fetching, challenge verification, session pruning, and gated-write evaluation.
import {
  buildAuthChallengePayload,
  isVerifiablePublicKey,
  normalizeHost,
  sanitizeWellKnownConfig,
  satisfiesRole,
  requiredRolesForAction,
  findRulesForElement,
  verifyAuthSignature,
  LOCAL_HOST_IDENTIFIER,
  type AuthChallengeMessage,
  type AuthResponseMessage,
  type PermissionRule,
  type EnforceableRoles,
  type WellKnownPermissionsConfig,
} from "@playhtml/common";
import type * as Y from "yjs";

export const AUTH_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const AUTH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
export const WELL_KNOWN_TTL_MS = 5 * 60 * 1000;
export const MAX_WELL_KNOWN_BYTES = 64 * 1024;
export const MAX_AUTH_SESSIONS = 1000;
export const MAX_GATED_WRITE_BYTES = 256 * 1024;

export const AUTH_STORAGE_KEYS = {
  sessions: "authSessions",
  gatedSnapshots: "gatedSnapshots",
  wellKnownPermissions: "wellKnownPermissions",
} as const;

/** Yjs transaction origin marking server-authoritative gated writes. */
export const GATED_WRITE_ORIGIN = "__playhtml_gated__";

export interface AuthSessionRecord {
  pid: string;
  expiresAt: number;
}

export type AuthSessions = Record<string, AuthSessionRecord>;

export interface PendingChallenge {
  nonce: string;
  ts: number;
}

export interface WellKnownCacheEntry {
  config: WellKnownPermissionsConfig | null;
  fetchedAt: number;
}

export interface GatedSnapshot {
  tag: string;
  data: unknown;
}

export type GatedSnapshots = Record<string, GatedSnapshot>;

// ---------------------------------------------------------------------------
// Room name parsing
// ---------------------------------------------------------------------------

/**
 * Room names are `encodeURIComponent(normalizedHost + "-" + normalizedPath)`
 * (path always starts with "/"), or just the host for domain-scoped rooms.
 * Hosts may themselves contain "-", so split on the first "-/" boundary.
 */
export function parseRoomName(roomName: string): {
  domain: string;
  path: string | undefined;
} {
  let decoded = roomName;
  try {
    decoded = decodeURIComponent(roomName);
  } catch {}
  const boundary = decoded.indexOf("-/");
  if (boundary === -1) {
    return { domain: decoded, path: undefined };
  }
  return {
    domain: decoded.slice(0, boundary),
    path: decoded.slice(boundary + 1),
  };
}

function isLoopbackHost(domain: string): boolean {
  const hostname = domain.split(":")[0];
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * URL of the domain-bound permissions config, or null for rooms with no
 * fetchable domain (file:// pages).
 */
export function wellKnownUrlForDomain(domain: string): string | null {
  if (!domain || domain === LOCAL_HOST_IDENTIFIER) return null;
  const scheme = isLoopbackHost(domain) ? "http" : "https";
  return `${scheme}://${domain}/.well-known/playhtml.json`;
}

/**
 * Fetches and sanitizes a domain's .well-known/playhtml.json. Returns null on
 * any failure (no file, bad JSON, oversized) — absence of a config simply
 * means no server enforcement for the domain.
 */
export async function fetchWellKnownConfig(
  domain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WellKnownPermissionsConfig | null> {
  const url = wellKnownUrlForDomain(domain);
  if (!url) return null;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const text = await response.text();
    if (text.length > MAX_WELL_KNOWN_BYTES) {
      console.warn(
        `[Auth] Ignoring oversized well-known config for ${domain} (${text.length} bytes)`,
      );
      return null;
    }
    return sanitizeWellKnownConfig(JSON.parse(text));
  } catch {
    return null;
  }
}

export function isWellKnownCacheFresh(
  entry: WellKnownCacheEntry | undefined | null,
  now: number,
  ttlMs: number = WELL_KNOWN_TTL_MS,
): boolean {
  return !!entry && now - entry.fetchedAt < ttlMs;
}

// ---------------------------------------------------------------------------
// Challenge / session lifecycle
// ---------------------------------------------------------------------------

export function createChallenge(
  roomId: string,
  now: number = Date.now(),
): AuthChallengeMessage {
  return {
    type: "auth_challenge",
    nonce: crypto.randomUUID(),
    roomId,
    ts: now,
  };
}

export function isChallengeExpired(
  challenge: PendingChallenge,
  now: number = Date.now(),
): boolean {
  return now - challenge.ts > AUTH_CHALLENGE_TTL_MS;
}

/**
 * Verifies a signed challenge response. The origin the client signed must
 * resolve to the room's own domain — a page can only verify identities for
 * sessions on itself, so signatures can't be phished cross-site.
 */
export async function verifyChallengeResponse(args: {
  challenge: PendingChallenge;
  response: Pick<AuthResponseMessage, "pid" | "origin" | "signature">;
  roomId: string;
  roomDomain: string;
  now?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { challenge, response, roomId, roomDomain, now = Date.now() } = args;

  if (isChallengeExpired(challenge, now)) {
    return { ok: false, reason: "challenge_expired" };
  }
  if (!isVerifiablePublicKey(response.pid)) {
    return { ok: false, reason: "invalid_pid" };
  }

  if (roomDomain !== LOCAL_HOST_IDENTIFIER) {
    let originHost: string;
    try {
      originHost = normalizeHost(new URL(response.origin).host);
    } catch {
      return { ok: false, reason: "invalid_origin" };
    }
    if (originHost !== roomDomain) {
      return { ok: false, reason: "origin_mismatch" };
    }
  }

  const payload = buildAuthChallengePayload({
    nonce: challenge.nonce,
    roomId,
    origin: response.origin,
    ts: challenge.ts,
  });
  const valid = await verifyAuthSignature(
    response.pid,
    payload,
    response.signature,
  );
  return valid ? { ok: true } : { ok: false, reason: "invalid_signature" };
}

export function createSessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let hex = "";
  for (let i = 0; i < bytes.length; i++)
    hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

/**
 * Drops expired sessions and, if still over capacity, the soonest-expiring
 * ones. Returns a new record (never mutates the input).
 */
export function pruneSessions(
  sessions: AuthSessions,
  now: number = Date.now(),
  max: number = MAX_AUTH_SESSIONS,
): AuthSessions {
  const live = Object.entries(sessions).filter(
    ([, record]) => record.expiresAt > now,
  );
  live.sort((a, b) => b[1].expiresAt - a[1].expiresAt);
  return Object.fromEntries(live.slice(0, max));
}

// ---------------------------------------------------------------------------
// Gated write evaluation
// ---------------------------------------------------------------------------

export function isElementGated(
  rules: PermissionRule[],
  elementId: string,
  roomPath: string | undefined,
): boolean {
  return findRulesForElement(rules, elementId, roomPath).length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function entriesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export type GatedWriteVerdict =
  | { ok: true; data: unknown }
  | { ok: false; reason: string };

/**
 * Decides whether a verified pid may replace a gated element's data, and
 * returns the (possibly adjusted) data to apply.
 *
 * Two layers:
 * - "write"-gated elements: a satisfied write role replaces the value wholesale.
 * - entry-level rules (create/update/delete): the element data must be a keyed
 *   map of object entries (`Record<entryKey, entry>`). The server diffs current
 *   vs incoming keys, checks each change, stamps `createdBy` with the verified
 *   pid on creates, and pins `createdBy` to its original value on updates so
 *   entry ownership can never be rewritten by clients.
 */
export function evaluateGatedWrite(args: {
  rules: PermissionRule[];
  roles: EnforceableRoles;
  roomPath: string | undefined;
  elementId: string;
  pid: string | undefined;
  currentData: unknown;
  incomingData: unknown;
}): GatedWriteVerdict {
  const { rules, roles, roomPath, elementId, pid, currentData, incomingData } =
    args;
  const principal = { pid, verified: pid !== undefined };
  const check = (required: ReturnType<typeof requiredRolesForAction>) =>
    required === null ||
    satisfiesRole(required, principal, roles, {
      requireVerifiedForKeyRoles: true,
    });

  const writeRequired = requiredRolesForAction(
    rules,
    elementId,
    "write",
    roomPath,
  );
  const writeSatisfied = writeRequired !== null && check(writeRequired);

  const hasEntryRules = findRulesForElement(rules, elementId, roomPath).some(
    (rule) =>
      rule.create !== undefined ||
      rule.update !== undefined ||
      rule.delete !== undefined,
  );

  if (!hasEntryRules) {
    if (writeRequired === null || writeSatisfied) {
      return { ok: true, data: incomingData };
    }
    return { ok: false, reason: "missing required role for write" };
  }

  // A satisfied element-level write role overrides entry checks (admin path),
  // but ownership stamps still apply below for consistency.
  if (!isPlainObject(incomingData)) {
    return {
      ok: false,
      reason:
        "entry-level rules (create/update/delete) require the element data to be a keyed map of object entries",
    };
  }
  const current = isPlainObject(currentData) ? currentData : {};
  const result: Record<string, unknown> = {};

  for (const [key, incomingEntry] of Object.entries(incomingData)) {
    const currentEntry = current[key];
    if (currentEntry === undefined) {
      // create
      if (!writeSatisfied) {
        const required = requiredRolesForAction(
          rules,
          elementId,
          "create",
          roomPath,
        );
        if (!check(required)) {
          return { ok: false, reason: `not allowed to create entry "${key}"` };
        }
      }
      result[key] = isPlainObject(incomingEntry)
        ? { ...incomingEntry, createdBy: pid }
        : incomingEntry;
    } else if (!entriesEqual(currentEntry, incomingEntry)) {
      // update
      const ownerPid = isPlainObject(currentEntry)
        ? (currentEntry.createdBy as string | undefined)
        : undefined;
      if (!writeSatisfied) {
        const required = requiredRolesForAction(
          rules,
          elementId,
          "update",
          roomPath,
        );
        const allowed =
          required === null ||
          satisfiesRole(required, { ...principal, isCreator: ownerPid !== undefined && ownerPid === pid }, roles, {
            requireVerifiedForKeyRoles: true,
          });
        if (!allowed) {
          return { ok: false, reason: `not allowed to update entry "${key}"` };
        }
      }
      result[key] = isPlainObject(incomingEntry)
        ? { ...incomingEntry, ...(ownerPid !== undefined ? { createdBy: ownerPid } : {}) }
        : incomingEntry;
    } else {
      result[key] = currentEntry;
    }
  }

  for (const [key, currentEntry] of Object.entries(current)) {
    if (key in incomingData) continue;
    // delete
    if (!writeSatisfied) {
      const ownerPid = isPlainObject(currentEntry)
        ? (currentEntry.createdBy as string | undefined)
        : undefined;
      const required = requiredRolesForAction(
        rules,
        elementId,
        "delete",
        roomPath,
      );
      const allowed =
        required === null ||
        satisfiesRole(required, { ...principal, isCreator: ownerPid !== undefined && ownerPid === pid }, roles, {
          requireVerifiedForKeyRoles: true,
        });
      if (!allowed) {
        return { ok: false, reason: `not allowed to delete entry "${key}"` };
      }
    }
  }

  return { ok: true, data: result };
}

// ---------------------------------------------------------------------------
// Backstop observer helpers
// ---------------------------------------------------------------------------

/**
 * Extracts which element ids a batch of deep events on the "play" map could
 * have touched. Paths are relative to the play map: [tag, elementId, ...].
 * A change at depth 0 (whole tags replaced) returns null, meaning "anything
 * may have changed" — callers should then check every gated id.
 */
export function collectChangedElementIds(
  events: Array<Y.YEvent<any>>,
): Set<string> | null {
  const ids = new Set<string>();
  for (const event of events) {
    const path = event.path;
    if (path.length === 0) {
      // Keys changed directly on the play map are tags, not element ids —
      // any element under those tags may be new/changed.
      return null;
    }
    if (path.length === 1) {
      // Change on a tag map: changed keys are element ids.
      for (const key of event.changes.keys.keys()) ids.add(String(key));
      continue;
    }
    ids.add(String(path[1]));
  }
  return ids;
}
