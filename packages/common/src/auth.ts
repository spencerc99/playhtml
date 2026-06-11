// ABOUTME: Shared identity/auth/permissions contract between the playhtml client and the
// ABOUTME: partykit server: message types, ECDSA helpers, and pure permission-rule evaluation.

// ---------------------------------------------------------------------------
// Identity / key format
// ---------------------------------------------------------------------------

/**
 * Public keys are ECDSA P-256 raw uncompressed points, hex encoded with a
 * "pk_" prefix (133 chars total) — the same format the "we were online"
 * extension uses, so extension and library identities verify identically.
 */
export const PK_PREFIX = "pk_";
export const PK_HEX_LENGTH = 130; // 65-byte uncompressed point

export function isVerifiablePublicKey(publicKey: string): boolean {
  return (
    typeof publicKey === "string" &&
    publicKey.startsWith(PK_PREFIX) &&
    publicKey.length === PK_PREFIX.length + PK_HEX_LENGTH &&
    /^[0-9a-f]+$/.test(publicKey.slice(PK_PREFIX.length))
  );
}

export const AUTH_PROTOCOL = "playhtml-auth-v1";

/**
 * Canonical string a client signs to prove key ownership. Binds the
 * server-issued nonce to the room, the page origin, and the protocol label so
 * a captured signature cannot be replayed against another room, site, or
 * protocol.
 */
export function buildAuthChallengePayload(args: {
  nonce: string;
  roomId: string;
  origin: string;
  ts: number;
}): string {
  const { nonce, roomId, origin, ts } = args;
  return [AUTH_PROTOCOL, nonce, roomId, origin, String(ts)].join("|");
}

// ---------------------------------------------------------------------------
// Crypto helpers (browser + workers + node >= 19 via globalThis.crypto)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const ECDSA_PARAMS: EcKeyImportParams = { name: "ECDSA", namedCurve: "P-256" };
const ECDSA_SIGN_PARAMS: EcdsaParams = { name: "ECDSA", hash: "SHA-256" };

export async function importPublicKey(publicKey: string): Promise<CryptoKey> {
  if (!isVerifiablePublicKey(publicKey)) {
    throw new Error(`Invalid public key format: ${publicKey.slice(0, 16)}…`);
  }
  const raw = hexToBytes(publicKey.slice(PK_PREFIX.length));
  return crypto.subtle.importKey("raw", raw as BufferSource, ECDSA_PARAMS, false, [
    "verify",
  ]);
}

export async function exportPublicKeyHex(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  let hex = "";
  for (let i = 0; i < raw.length; i++) hex += raw[i].toString(16).padStart(2, "0");
  return PK_PREFIX + hex;
}

export async function signAuthPayload(
  privateKey: CryptoKey,
  payload: string,
): Promise<string> {
  const sig = await crypto.subtle.sign(
    ECDSA_SIGN_PARAMS,
    privateKey,
    new TextEncoder().encode(payload),
  );
  return bytesToBase64(new Uint8Array(sig));
}

/** Returns false (never throws) on malformed keys/signatures. */
export async function verifyAuthSignature(
  publicKey: string,
  payload: string,
  signatureBase64: string,
): Promise<boolean> {
  try {
    const key = await importPublicKey(publicKey);
    return await crypto.subtle.verify(
      ECDSA_SIGN_PARAMS,
      key,
      base64ToBytes(signatureBase64) as BufferSource,
      new TextEncoder().encode(payload),
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Permission rules
// ---------------------------------------------------------------------------

export type PermissionAction = "write" | "create" | "update" | "delete";

export const PERMISSION_ACTIONS: PermissionAction[] = [
  "write",
  "create",
  "update",
  "delete",
];

/**
 * Built-in role names:
 * - "anyone": no requirement (the default when no rule matches)
 * - "verified": any connection that completed the key handshake
 * - "creator": the verified pid recorded on a keyed-collection entry at create time
 *
 * A raw public key ("pk_…") is also accepted anywhere a role name is — it
 * matches exactly that pid, so single-owner sites need no role indirection.
 */
export type RoleRef = string | string[];

/** Action -> required role(s); the object form of a permissions spec. */
export type PermissionActionSpec = Partial<Record<PermissionAction, RoleRef>>;

/**
 * Map of element id pattern (or, client-side only, CSS selector) to a
 * permissions spec — either the string mini-language ("write:admin,
 * delete:admin|creator") or the object form. The ergonomic way to declare
 * rules; normalized to PermissionRule[] internally.
 */
export type ElementRulesMap = Record<string, string | PermissionActionSpec>;

export interface PermissionRule {
  /**
   * Element id pattern: an exact element id, or a prefix glob with a trailing
   * "*" (e.g. "note-*"). A leading "#" is tolerated and stripped so rules read
   * like selectors. Server-side enforcement matches on element ids only;
   * client-side init rules may additionally use arbitrary CSS selectors (those
   * are UX gating only and never sent to the server).
   */
  match: string;
  /** Restrict the rule to one room path on the domain (e.g. "/wall"). Omit for all rooms. */
  path?: string;
  write?: RoleRef;
  create?: RoleRef;
  update?: RoleRef;
  delete?: RoleRef;
}

/** Role membership in enforceable configs is always an explicit pk list. */
export type EnforceableRoles = Record<string, string[]>;

/**
 * Shape of https://<domain>/.well-known/playhtml.json — the domain-bound
 * source of truth the server fetches. Whoever controls the domain's content
 * controls the rules (same trust model as the site itself).
 */
export interface WellKnownPermissionsConfig {
  roles?: EnforceableRoles;
  rules?: PermissionRule[];
  /** Ergonomic alternative to `rules`: pattern -> spec map (normalized into rules). */
  elements?: ElementRulesMap;
}

/**
 * True when a match pattern can only be a CSS selector, never an element id
 * pattern — these silently match nothing in server-enforced configs.
 * (Heuristic: ids may legally contain dots/colons, so only obvious selector
 * prefixes are flagged.)
 */
export function looksLikeCssSelector(pattern: string): boolean {
  const p = pattern.trim();
  return (
    p.startsWith(".") || p.startsWith("[") || /[\s>+~]/.test(p)
  );
}

/**
 * Parses the permissions spec mini-language used by the `permissions` HTML
 * attribute and as config shorthand: comma-separated `action:role` entries;
 * multiple acceptable roles join with "|".
 * Example: `"write:admin, delete:admin|creator"`.
 */
export function parsePermissionsSpec(value: string): PermissionActionSpec {
  const parsed: PermissionActionSpec = {};
  for (const entry of value.split(",")) {
    const colonIndex = entry.indexOf(":");
    if (colonIndex === -1) continue;
    const action = entry.slice(0, colonIndex).trim();
    const roleSpec = entry.slice(colonIndex + 1).trim();
    if (!action || !roleSpec) continue;
    if (!(PERMISSION_ACTIONS as string[]).includes(action)) {
      console.warn(`[playhtml] Unknown permission action "${action}" in spec`);
      continue;
    }
    const roleList = roleSpec
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    parsed[action as PermissionAction] =
      roleList.length === 1 ? roleList[0] : roleList;
  }
  return parsed;
}

/** Inverse of parsePermissionsSpec; passes strings through unchanged. */
export function serializePermissionsSpec(
  spec: string | PermissionActionSpec,
): string {
  if (typeof spec === "string") return spec;
  return Object.entries(spec)
    .map(
      ([action, roles]) =>
        `${action}:${Array.isArray(roles) ? roles.join("|") : roles}`,
    )
    .join(", ");
}

/** Normalizes the ergonomic elements-map form into rule objects. */
export function normalizeElementRules(
  elements: ElementRulesMap,
): PermissionRule[] {
  const rules: PermissionRule[] = [];
  for (const [match, spec] of Object.entries(elements)) {
    if (!match) continue;
    const actionSpec =
      typeof spec === "string" ? parsePermissionsSpec(spec) : spec;
    if (!actionSpec || Object.keys(actionSpec).length === 0) continue;
    rules.push({ match, ...actionSpec });
  }
  return rules;
}

/** Strips a tolerated leading "#" from a rule match pattern. */
function normalizeMatch(pattern: string): string {
  return pattern.startsWith("#") ? pattern.slice(1) : pattern;
}

export function matchesRulePattern(pattern: string, elementId: string): boolean {
  const p = normalizeMatch(pattern);
  if (p.endsWith("*")) return elementId.startsWith(p.slice(0, -1));
  return p === elementId;
}

export function ruleAppliesToPath(
  rule: Pick<PermissionRule, "path">,
  roomPath: string | undefined,
): boolean {
  if (!rule.path) return true;
  if (roomPath === undefined) return false;
  return rule.path === roomPath;
}

export function findRulesForElement(
  rules: PermissionRule[],
  elementId: string,
  roomPath?: string,
): PermissionRule[] {
  return rules.filter(
    (rule) =>
      ruleAppliesToPath(rule, roomPath) && matchesRulePattern(rule.match, elementId),
  );
}

/**
 * Returns the role refs required for `action` on `elementId`, or null when no
 * matching rule restricts the action (= allowed for anyone).
 *
 * "update"/"create"/"delete" fall back to the rule's "write" requirement when
 * not specified, so `{ match: "x", write: "admin" }` gates all mutations.
 */
export function requiredRolesForAction(
  rules: PermissionRule[],
  elementId: string,
  action: PermissionAction,
  roomPath?: string,
): RoleRef | null {
  for (const rule of findRulesForElement(rules, elementId, roomPath)) {
    const specific = rule[action];
    if (specific !== undefined) return specific;
    if (action !== "write" && rule.write !== undefined) return rule.write;
  }
  return null;
}

export interface PermissionPrincipal {
  /** Stable public key of the actor; undefined when unknown. */
  pid?: string;
  /** True when the actor completed the key handshake for this connection. */
  verified: boolean;
  /** True when the actor is the recorded creator of the targeted entry. */
  isCreator?: boolean;
}

/**
 * Pure role-satisfaction check shared by client and server. The server passes
 * the verified connection pid; the client passes its own claimed pid (UX
 * gating). For key-listed roles the pid must be verified to count server-side;
 * client-side gating intentionally doesn't require verification so UIs unlock
 * immediately (the server remains the authority).
 */
export function satisfiesRole(
  required: RoleRef,
  principal: PermissionPrincipal,
  roles: EnforceableRoles,
  options: { requireVerifiedForKeyRoles?: boolean } = {},
): boolean {
  const requiredList = Array.isArray(required) ? required : [required];
  for (const roleName of requiredList) {
    if (roleName === "anyone") return true;
    if (roleName === "verified" && principal.verified) return true;
    if (roleName === "creator" && principal.isCreator) return true;
    // A raw public key in role position matches exactly that pid.
    if (roleName.startsWith(PK_PREFIX)) {
      if (principal.pid === roleName) {
        if (!options.requireVerifiedForKeyRoles || principal.verified) return true;
      }
      continue;
    }
    const members = roles[roleName];
    if (members && principal.pid && members.includes(principal.pid)) {
      if (!options.requireVerifiedForKeyRoles || principal.verified) return true;
    }
  }
  return false;
}

export function isActionAllowed(args: {
  rules: PermissionRule[];
  roles: EnforceableRoles;
  elementId: string;
  action: PermissionAction;
  principal: PermissionPrincipal;
  roomPath?: string;
  requireVerifiedForKeyRoles?: boolean;
}): boolean {
  const required = requiredRolesForAction(
    args.rules,
    args.elementId,
    args.action,
    args.roomPath,
  );
  if (required === null) return true;
  return satisfiesRole(required, args.principal, args.roles, {
    requireVerifiedForKeyRoles: args.requireVerifiedForKeyRoles,
  });
}

/**
 * Validates an untrusted parsed .well-known/playhtml.json body. Returns a
 * sanitized config or null when the shape is unusable. Oversized or
 * wrong-typed entries are dropped rather than failing the whole config.
 */
export function sanitizeWellKnownConfig(
  raw: unknown,
  limits: { maxRules?: number; maxRoleMembers?: number } = {},
): WellKnownPermissionsConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { maxRules = 200, maxRoleMembers = 500 } = limits;
  const input = raw as Record<string, unknown>;

  const roles: EnforceableRoles = {};
  if (typeof input.roles === "object" && input.roles !== null) {
    for (const [name, members] of Object.entries(input.roles)) {
      if (!Array.isArray(members)) continue;
      const pks = members
        .filter((m): m is string => typeof m === "string" && isVerifiablePublicKey(m))
        .slice(0, maxRoleMembers);
      roles[name] = pks;
    }
  }

  const rules: PermissionRule[] = [];
  const pushRule = (rule: PermissionRule) => {
    if (looksLikeCssSelector(rule.match)) {
      console.warn(
        `[playhtml] Dropping rule "${rule.match}": CSS selectors can't be ` +
          `server-enforced — use an element id or trailing-* glob.`,
      );
      return;
    }
    if (rules.length < maxRules) rules.push(rule);
  };

  // Ergonomic map form: { "site-title": "write:admin", … }
  if (typeof input.elements === "object" && input.elements !== null) {
    for (const [match, spec] of Object.entries(input.elements)) {
      if (!match) continue;
      let actionSpec: PermissionActionSpec | null = null;
      if (typeof spec === "string") {
        actionSpec = parsePermissionsSpec(spec);
      } else if (typeof spec === "object" && spec !== null) {
        actionSpec = {};
        for (const action of PERMISSION_ACTIONS) {
          const value = (spec as Record<string, unknown>)[action];
          if (typeof value === "string") actionSpec[action] = value;
          else if (
            Array.isArray(value) &&
            value.every((v) => typeof v === "string")
          ) {
            actionSpec[action] = value as string[];
          }
        }
      }
      if (!actionSpec || Object.keys(actionSpec).length === 0) continue;
      pushRule({ match, ...actionSpec });
    }
  }

  if (Array.isArray(input.rules)) {
    for (const entry of input.rules.slice(0, maxRules)) {
      if (typeof entry !== "object" || entry === null) continue;
      const r = entry as Record<string, unknown>;
      if (typeof r.match !== "string" || r.match.length === 0) continue;
      const rule: PermissionRule = { match: r.match };
      if (typeof r.path === "string") rule.path = r.path;
      for (const action of PERMISSION_ACTIONS) {
        const value = r[action];
        if (typeof value === "string") rule[action] = value;
        else if (
          Array.isArray(value) &&
          value.every((v) => typeof v === "string")
        ) {
          rule[action] = value as string[];
        }
      }
      pushRule(rule);
    }
  }

  // A config with roles but no rules is still useful: the server publishes
  // the role lists (and verifies identities), letting pages gate UI by role
  // even when no element writes are server-gated.
  if (rules.length === 0 && Object.keys(roles).length === 0) return null;
  return { roles, rules };
}

// ---------------------------------------------------------------------------
// Wire protocol (sent as custom messages over the existing Yjs WebSocket)
// ---------------------------------------------------------------------------

export interface AuthChallengeMessage {
  type: "auth_challenge";
  nonce: string;
  roomId: string;
  ts: number;
}

export interface AuthResponseMessage {
  type: "auth_response";
  pid: string;
  /** Page origin the client signed into the payload; server validates it against the room's domain. */
  origin: string;
  signature: string;
}

/** Fast-resume with a previously issued session token (skips the signature). */
export interface AuthResumeMessage {
  type: "auth_resume";
  token: string;
}

/** Client asks the server to (re)issue a challenge, e.g. after identity change. */
export interface AuthRequestMessage {
  type: "auth_request";
}

export interface AuthOkMessage {
  type: "auth_ok";
  pid: string;
  token: string;
  expiresAt: number;
}

export interface AuthErrorMessage {
  type: "auth_error";
  reason: string;
}

/**
 * Sent by the server after connect when the room's domain published an
 * enforceable config. Roles/rules are public information (public keys are
 * public); the client uses them to route gated writes and gate UI.
 */
export interface PermissionsStatusMessage {
  type: "permissions_status";
  enforced: boolean;
  roles: EnforceableRoles;
  rules: PermissionRule[];
  /** The room path the server matched rules against. */
  roomPath?: string;
}

export interface GatedWriteMessage {
  type: "gated_write";
  opId: string;
  tag: string;
  elementId: string;
  /** Full replacement value for the element's data (wait-for-server semantics). */
  data: unknown;
}

export interface GatedWriteResultMessage {
  type: "gated_write_result";
  opId: string;
  ok: boolean;
  reason?: string;
}

export type AuthClientMessage =
  | AuthResponseMessage
  | AuthResumeMessage
  | AuthRequestMessage
  | GatedWriteMessage;

export type AuthServerMessage =
  | AuthChallengeMessage
  | AuthOkMessage
  | AuthErrorMessage
  | PermissionsStatusMessage
  | GatedWriteResultMessage;
