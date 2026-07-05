// ABOUTME: Client side of the auth handshake and gated-write protocol, spoken as custom
// ABOUTME: messages over the existing Yjs WebSocket. Verification never blocks sync.

import type {
  AuthChallengeMessage,
  AuthOkMessage,
  AuthErrorMessage,
  PermissionsStatusMessage,
  GatedWriteResultMessage,
  PermissionAction,
  GatedWriteOp,
} from "@playhtml/common";
import { buildAuthChallengePayload } from "@playhtml/common";
import { signChallengeForPid } from "./identity";
import {
  setServerPermissionsStatus,
  setVerified,
  setCounters,
  dispatchPermissionDenied,
  setServerPermissionsPending,
} from "./permissions";

const SESSION_TOKEN_KEY_PREFIX = "playhtml_auth_token_";

interface PendingGatedWrite {
  target: EventTarget;
  elementId: string;
  action: PermissionAction;
  timer: ReturnType<typeof setTimeout>;
}

interface HandshakeContext {
  send: (message: string) => void;
  getPid: () => string | undefined;
  roomId: string;
}

let context: HandshakeContext | null = null;
let resumeAttempted = false;
const pendingGatedWrites = new Map<string, PendingGatedWrite>();

const VERIFY_TIMEOUT_MS = 15_000;
const GATED_WRITE_TIMEOUT_MS = 10_000;

interface PendingVerification {
  promise: Promise<boolean>;
  resolve: (ok: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

let pendingVerification: PendingVerification | null = null;

function settleVerification(ok: boolean): void {
  if (!pendingVerification) return;
  clearTimeout(pendingVerification.timer);
  pendingVerification.resolve(ok);
  pendingVerification = null;
}

function clearPendingGatedWrites(): void {
  for (const pending of pendingGatedWrites.values()) {
    clearTimeout(pending.timer);
  }
  pendingGatedWrites.clear();
}

/**
 * (Re)binds the handshake to the current provider/room. Called at init and on
 * navigation when the main provider is rebuilt — verification state is per
 * connection, so it resets here.
 */
export function bindHandshake(next: HandshakeContext): void {
  context = next;
  resumeAttempted = false;
  clearPendingGatedWrites();
  settleVerification(false);
  setVerified(false);
  setServerPermissionsPending(true);
}

export function unbindHandshake(): void {
  context = null;
  clearPendingGatedWrites();
  settleVerification(false);
  setVerified(false);
  setServerPermissionsStatus(null);
}

function tokenStorageKey(roomId: string): string {
  return SESSION_TOKEN_KEY_PREFIX + roomId;
}

function getStoredToken(roomId: string): string | null {
  try {
    return sessionStorage.getItem(tokenStorageKey(roomId));
  } catch {
    return null;
  }
}

function storeToken(roomId: string, token: string): void {
  try {
    sessionStorage.setItem(tokenStorageKey(roomId), token);
  } catch {}
}

function clearToken(roomId: string): void {
  try {
    sessionStorage.removeItem(tokenStorageKey(roomId));
  } catch {}
}

/**
 * Asks the server to (re)issue a challenge — used after a late identity
 * change (e.g. extension injection after connect) and by playhtml.verify().
 *
 * Resolves true on `auth_ok`, false on a terminal `auth_error`, timeout
 * (~15s, e.g. extension didn't answer the signing request), or rebind.
 */
export function requestVerification(): Promise<boolean> {
  resumeAttempted = false;
  setVerified(false);
  if (!context) return Promise.resolve(false);
  clearToken(context.roomId);
  if (!pendingVerification) {
    let resolve!: (ok: boolean) => void;
    const promise = new Promise<boolean>((r) => (resolve = r));
    const timer = setTimeout(() => settleVerification(false), VERIFY_TIMEOUT_MS);
    pendingVerification = { promise, resolve, timer };
  }
  context.send(JSON.stringify({ type: "auth_request" }));
  return pendingVerification.promise;
}

async function handleChallenge(message: AuthChallengeMessage): Promise<void> {
  const ctx = context;
  if (!ctx) return;

  // Fast path: resume a previous session for this room without a signature
  // (and without the extension round trip). If the server rejects the token
  // it re-issues a challenge; resumeAttempted prevents a resume loop.
  if (!resumeAttempted) {
    const token = getStoredToken(ctx.roomId);
    if (token) {
      resumeAttempted = true;
      ctx.send(JSON.stringify({ type: "auth_resume", token }));
      return;
    }
  }

  const pid = ctx.getPid();
  if (!pid) return;

  const origin = window.location.origin;
  const payload = buildAuthChallengePayload({
    nonce: message.nonce,
    roomId: message.roomId,
    origin,
    ts: message.ts,
  });

  const signature = await signChallengeForPid(pid, payload);
  if (!signature) return; // no reachable key — stay unverified, never error

  // Context may have been rebound (navigation) while signing.
  if (context !== ctx) return;
  ctx.send(
    JSON.stringify({ type: "auth_response", pid, origin, signature }),
  );
}

function handleAuthOk(message: AuthOkMessage): void {
  if (!context) return;
  const expectedPid = context.getPid();
  if (expectedPid !== undefined && message.pid !== expectedPid) {
    clearToken(context.roomId);
    setVerified(false);
    settleVerification(false);
    return;
  }
  storeToken(context.roomId, message.token);
  if (message.stats?.counters) {
    setCounters(message.stats.counters);
  }
  setVerified(true);
  settleVerification(true);
}

function handleAuthError(message: AuthErrorMessage): void {
  if (!context) return;
  if (message.reason === "invalid_token") {
    // Resume failed (expired/foreign token) — drop it; the server follows up
    // with a fresh challenge which we'll answer with a signature. Not
    // terminal, so any pending verify() keeps waiting.
    clearToken(context.roomId);
    return;
  }
  console.warn("[playhtml] Auth handshake failed:", message.reason);
  setVerified(false);
  settleVerification(false);
}

function handleGatedWriteResult(message: GatedWriteResultMessage): void {
  const pending = pendingGatedWrites.get(message.opId);
  if (!pending) return;
  pendingGatedWrites.delete(message.opId);
  clearTimeout(pending.timer);
  if (!message.ok) {
    dispatchPermissionDenied(pending.target, {
      action: pending.action,
      elementId: pending.elementId,
      reason: message.reason ?? "rejected by server",
    });
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function buildGatedWriteOps(args: {
  before: unknown;
  after: unknown;
  keyed: boolean;
}): GatedWriteOp[] {
  if (!args.keyed) {
    return [{ op: "replace", key: "", value: args.after }];
  }

  if (!isPlainRecord(args.after)) {
    return [{ op: "replace", key: "", value: args.after }];
  }

  const before = isPlainRecord(args.before) ? args.before : {};
  const ops: GatedWriteOp[] = [];
  for (const [key, value] of Object.entries(args.after)) {
    if (!Object.prototype.hasOwnProperty.call(before, key)) {
      ops.push({ op: "create", key, value });
    } else if (!valuesEqual(before[key], value)) {
      ops.push({ op: "update", key, value });
    }
  }
  for (const key of Object.keys(before)) {
    if (!Object.prototype.hasOwnProperty.call(args.after, key)) {
      ops.push({ op: "delete", key });
    }
  }
  return ops;
}

/**
 * Routes a write to a server-gated element through the gated-write path.
 * Wait-for-server semantics: nothing is applied locally; the authoritative
 * value arrives via normal Yjs sync once the server applies it.
 */
export function sendGatedWrite(args: {
  target: EventTarget;
  tag: string;
  elementId: string;
  ops: GatedWriteOp[];
}): void {
  const ctx = context;
  if (!ctx) return;
  const opId = crypto.randomUUID();
  const timer = setTimeout(() => {
    const pending = pendingGatedWrites.get(opId);
    if (!pending) return;
    pendingGatedWrites.delete(opId);
    dispatchPermissionDenied(pending.target, {
      action: pending.action,
      elementId: pending.elementId,
      reason: "timed out waiting for server",
    });
  }, GATED_WRITE_TIMEOUT_MS);
  pendingGatedWrites.set(opId, {
    target: args.target,
    elementId: args.elementId,
    action: "write",
    timer,
  });
  ctx.send(
    JSON.stringify({
      type: "gated_write",
      opId,
      tag: args.tag,
      elementId: args.elementId,
      ops: args.ops,
    }),
  );
}

/**
 * Feeds a parsed custom message into the auth protocol. Returns true when the
 * message was an auth/permissions message (i.e. consumed), false otherwise.
 */
export function handleAuthMessage(message: { type?: string }): boolean {
  switch (message.type) {
    case "auth_challenge":
      void handleChallenge(message as AuthChallengeMessage);
      return true;
    case "auth_ok":
      handleAuthOk(message as AuthOkMessage);
      return true;
    case "auth_error":
      handleAuthError(message as AuthErrorMessage);
      return true;
    case "permissions_status":
      setServerPermissionsStatus(message as PermissionsStatusMessage);
      return true;
    case "gated_write_result":
      handleGatedWriteResult(message as GatedWriteResultMessage);
      return true;
    default:
      return false;
  }
}
