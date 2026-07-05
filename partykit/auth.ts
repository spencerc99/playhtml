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
  findBestRuleForElement,
  verifyAuthSignature,
  LOCAL_HOST_IDENTIFIER,
  type AuthChallengeMessage,
  type AuthResponseMessage,
  type GatedWriteOp,
  type PermissionRule,
  type PermissionPrincipal,
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
const PAGE_DATA_TAG = "__page__";

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

export type GatedWriteVerdict =
  | { ok: true; ops: GatedWriteOp[] }
  | { ok: false; reason: string };

/**
 * Decides whether a verified pid may apply a batch of gated write operations,
 * and returns the normalized operations to apply all at once.
 */
export function evaluateGatedWrite(args: {
  rules: PermissionRule[];
  roles: EnforceableRoles;
  roomPath: string | undefined;
  elementId: string;
  pid: string | undefined;
  currentData: unknown;
  ops: GatedWriteOp[];
}): GatedWriteVerdict {
  const { rules, roles, roomPath, elementId, pid, currentData, ops } = args;
  const principal: PermissionPrincipal = { pid, verified: pid !== undefined };
  const check = (
    required: ReturnType<typeof requiredRolesForAction>,
    candidate = principal
  ) =>
    required === null ||
    satisfiesRole(required, candidate, roles, {
      requireVerifiedForKeyRoles: true,
    });

  if (!Array.isArray(ops) || ops.length === 0) {
    return { ok: false, reason: "gated write requires at least one operation" };
  }

  const hasReplace = ops.some((op) => op.op === "replace");
  if (hasReplace && ops.length !== 1) {
    return {
      ok: false,
      reason: "replace operations cannot be batched with keyed operations",
    };
  }

  const hasOwn = (record: Record<string, unknown>, key: string) =>
    Object.prototype.hasOwnProperty.call(record, key);
  const current = isPlainObject(currentData) ? currentData : {};
  const working: Record<string, unknown> = { ...current };
  const normalizedOps: GatedWriteOp[] = [];

  const hasValue = (op: GatedWriteOp) =>
    Object.prototype.hasOwnProperty.call(op, "value");
  const ownerOf = (entry: unknown) =>
    isPlainObject(entry) ? (entry.createdBy as string | undefined) : undefined;
  const stampCreatedBy = (value: unknown) =>
    isPlainObject(value) ? { ...value, createdBy: pid } : value;
  const pinCreatedBy = (value: unknown, ownerPid: string | undefined) => {
    if (!isPlainObject(value)) return value;
    const pinned = { ...value };
    if (ownerPid === undefined) {
      delete pinned.createdBy;
    } else {
      pinned.createdBy = ownerPid;
    }
    return pinned;
  };

  for (const op of ops) {
    if (typeof op?.op !== "string" || typeof op.key !== "string") {
      return { ok: false, reason: "invalid gated write operation" };
    }

    if (op.op === "replace") {
      if (op.key !== "" || !hasValue(op)) {
        return { ok: false, reason: "invalid replace operation" };
      }
      const rule = findBestRuleForElement(rules, elementId, roomPath);
      const required = rule?.write;
      if (required === undefined || !satisfiesRole(required, principal, roles, {
        requireVerifiedForKeyRoles: true,
      })) {
        return { ok: false, reason: "missing required role for write" };
      }
      normalizedOps.push({ op: "replace", key: "", value: op.value });
      continue;
    }

    if (op.key === "") {
      return { ok: false, reason: "keyed operations require an entry key" };
    }

    if (op.op === "create") {
      if (!hasValue(op)) {
        return { ok: false, reason: `create entry "${op.key}" requires a value` };
      }
      if (!isPlainObject(op.value)) {
        return { ok: false, reason: `create entry "${op.key}" requires an object value` };
      }
      if (hasOwn(working, op.key)) {
        return { ok: false, reason: `entry "${op.key}" already exists` };
      }
      const required = requiredRolesForAction(
        rules,
        elementId,
        "create",
        roomPath,
      );
      if (!check(required)) {
        return { ok: false, reason: `not allowed to create entry "${op.key}"` };
      }
      const value = stampCreatedBy(op.value);
      working[op.key] = value;
      normalizedOps.push({ op: "create", key: op.key, value });
      continue;
    }

    if (op.op === "update") {
      if (!hasValue(op)) {
        return { ok: false, reason: `update entry "${op.key}" requires a value` };
      }
      if (!isPlainObject(op.value)) {
        return { ok: false, reason: `update entry "${op.key}" requires an object value` };
      }
      if (!hasOwn(working, op.key)) {
        return { ok: false, reason: `cannot update missing entry "${op.key}"` };
      }
      const ownerPid = ownerOf(working[op.key]);
      const required = requiredRolesForAction(
        rules,
        elementId,
        "update",
        roomPath,
      );
      if (
        !check(required, {
          ...principal,
          isCreator: ownerPid !== undefined && ownerPid === pid,
        })
      ) {
        return { ok: false, reason: `not allowed to update entry "${op.key}"` };
      }
      const value = pinCreatedBy(op.value, ownerPid);
      working[op.key] = value;
      normalizedOps.push({ op: "update", key: op.key, value });
      continue;
    }

    if (op.op === "delete") {
      if (!hasOwn(working, op.key)) {
        return { ok: false, reason: `cannot delete missing entry "${op.key}"` };
      }
      const ownerPid = ownerOf(working[op.key]);
      const required = requiredRolesForAction(
        rules,
        elementId,
        "delete",
        roomPath,
      );
      if (
        !check(required, {
          ...principal,
          isCreator: ownerPid !== undefined && ownerPid === pid,
        })
      ) {
        return { ok: false, reason: `not allowed to delete entry "${op.key}"` };
      }
      delete working[op.key];
      normalizedOps.push({ op: "delete", key: op.key });
      continue;
    }

    return { ok: false, reason: "invalid gated write operation" };
  }

  return { ok: true, ops: normalizedOps };
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
    if (path[0] === PAGE_DATA_TAG) {
      ids.add(String(path[1]));
      continue;
    }
    ids.add(String(path[1]));
  }
  return ids;
}

/**
 * A corrective action the gated-write backstop takes for one element that a
 * non-authoritative (non-GATED_WRITE_ORIGIN) transaction touched:
 * - "restore": overwrite the element with its last authoritative snapshot.
 * - "remove": no snapshot exists, so the only authoritative baseline is
 *   absence — the direct write is removed rather than adopted.
 */
export interface GatedRevert {
  elementId: string;
  action: "restore" | "remove";
  snapshot?: GatedSnapshot;
}

/**
 * Pure decision for the observe-and-revert backstop: given the element ids a
 * raw transaction may have touched, the room's rules, and the stored
 * snapshots, returns the revert actions to apply. Only gated elements are
 * considered; a gated element with a snapshot is restored to it, and one
 * without a snapshot is removed (never adopted from ambient client state).
 */
export function planGatedReverts(
  changedElementIds: Set<string> | null,
  rules: PermissionRule[],
  roomPath: string | undefined,
  snapshots: GatedSnapshots,
): GatedRevert[] {
  const candidates =
    changedElementIds === null
      ? Object.keys(snapshots)
      : Array.from(changedElementIds);
  const reverts: GatedRevert[] = [];
  for (const elementId of candidates) {
    if (!isElementGated(rules, elementId, roomPath)) continue;
    const snapshot = snapshots[elementId];
    if (!snapshot) {
      reverts.push({ elementId, action: "remove" });
    } else {
      reverts.push({ elementId, action: "restore", snapshot });
    }
  }
  return reverts;
}

export function removeElementDataFromPlayDoc(
  doc: Y.Doc,
  elementId: string,
): boolean {
  const play = doc.getMap("play") as Y.Map<any>;
  let removed = false;
  play.forEach((tagMap: any) => {
    if (
      typeof tagMap?.has !== "function" ||
      typeof tagMap.delete !== "function"
    ) {
      return;
    }
    if (!tagMap.has(elementId)) return;
    tagMap.delete(elementId);
    removed = true;
  });
  return removed;
}
