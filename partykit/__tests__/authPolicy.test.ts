// ABOUTME: Verifies server auth policy: room-name parsing, challenge verification,
// ABOUTME: session pruning, well-known config sanitization, and gated-write evaluation.
import { describe, expect, it } from "bun:test";
import {
  parseRoomName,
  wellKnownUrlForDomain,
  createChallenge,
  isChallengeExpired,
  verifyChallengeResponse,
  pruneSessions,
  evaluateGatedWrite,
  isElementGated,
  collectChangedElementIds,
  AUTH_CHALLENGE_TTL_MS,
} from "../auth";
import {
  buildAuthChallengePayload,
  exportPublicKeyHex,
  sanitizeWellKnownConfig,
  signAuthPayload,
  matchesRulePattern,
  requiredRolesForAction,
  isVerifiablePublicKey,
  type PermissionRule,
} from "@playhtml/common";
import * as Y from "yjs";

async function makeKeypair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  const pid = await exportPublicKeyHex(keyPair.publicKey);
  return { pid, privateKey: keyPair.privateKey };
}

describe("parseRoomName", () => {
  it("splits encoded host-path room names on the first '-/' boundary", () => {
    expect(parseRoomName(encodeURIComponent("example.com-/wall"))).toEqual({
      domain: "example.com",
      path: "/wall",
    });
  });

  it("keeps hyphenated hosts intact", () => {
    expect(parseRoomName(encodeURIComponent("my-site.com-/a-b/c"))).toEqual({
      domain: "my-site.com",
      path: "/a-b/c",
    });
  });

  it("treats domain-only room names as having no path", () => {
    expect(parseRoomName("example.com")).toEqual({
      domain: "example.com",
      path: undefined,
    });
  });
});

describe("wellKnownUrlForDomain", () => {
  it("builds https urls for real domains and http for loopback", () => {
    expect(wellKnownUrlForDomain("example.com")).toBe(
      "https://example.com/.well-known/playhtml.json"
    );
    expect(wellKnownUrlForDomain("localhost:5173")).toBe(
      "http://localhost:5173/.well-known/playhtml.json"
    );
  });

  it("returns null for LOCAL (file://) rooms", () => {
    expect(wellKnownUrlForDomain("LOCAL")).toBeNull();
  });
});

describe("challenge verification", () => {
  const roomId = encodeURIComponent("example.com-/wall");

  it("accepts a correctly signed response bound to the room's domain", async () => {
    const { pid, privateKey } = await makeKeypair();
    const challenge = createChallenge(roomId);
    const origin = "https://example.com";
    const payload = buildAuthChallengePayload({
      nonce: challenge.nonce,
      roomId,
      origin,
      ts: challenge.ts,
    });
    const signature = await signAuthPayload(privateKey, payload);

    const verdict = await verifyChallengeResponse({
      challenge: { nonce: challenge.nonce, ts: challenge.ts },
      response: { pid, origin, signature },
      roomId,
      roomDomain: "example.com",
    });
    expect(verdict).toEqual({ ok: true });
  });

  it("rejects signatures from a different key", async () => {
    const { pid } = await makeKeypair();
    const other = await makeKeypair();
    const challenge = createChallenge(roomId);
    const origin = "https://example.com";
    const payload = buildAuthChallengePayload({
      nonce: challenge.nonce,
      roomId,
      origin,
      ts: challenge.ts,
    });
    const signature = await signAuthPayload(other.privateKey, payload);

    const verdict = await verifyChallengeResponse({
      challenge: { nonce: challenge.nonce, ts: challenge.ts },
      response: { pid, origin, signature },
      roomId,
      roomDomain: "example.com",
    });
    expect(verdict).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects origins that don't resolve to the room's domain", async () => {
    const { pid, privateKey } = await makeKeypair();
    const challenge = createChallenge(roomId);
    const origin = "https://evil.com";
    const payload = buildAuthChallengePayload({
      nonce: challenge.nonce,
      roomId,
      origin,
      ts: challenge.ts,
    });
    const signature = await signAuthPayload(privateKey, payload);

    const verdict = await verifyChallengeResponse({
      challenge: { nonce: challenge.nonce, ts: challenge.ts },
      response: { pid, origin, signature },
      roomId,
      roomDomain: "example.com",
    });
    expect(verdict).toEqual({ ok: false, reason: "origin_mismatch" });
  });

  it("accepts www-prefixed origins for the bare domain", async () => {
    const { pid, privateKey } = await makeKeypair();
    const challenge = createChallenge(roomId);
    const origin = "https://www.example.com";
    const payload = buildAuthChallengePayload({
      nonce: challenge.nonce,
      roomId,
      origin,
      ts: challenge.ts,
    });
    const signature = await signAuthPayload(privateKey, payload);

    const verdict = await verifyChallengeResponse({
      challenge: { nonce: challenge.nonce, ts: challenge.ts },
      response: { pid, origin, signature },
      roomId,
      roomDomain: "example.com",
    });
    expect(verdict).toEqual({ ok: true });
  });

  it("rejects expired challenges and malformed pids", async () => {
    const now = Date.now();
    const stale = { nonce: "n", ts: now - AUTH_CHALLENGE_TTL_MS - 1 };
    expect(isChallengeExpired(stale, now)).toBe(true);

    const verdict = await verifyChallengeResponse({
      challenge: stale,
      response: { pid: "pk_short", origin: "https://example.com", signature: "x" },
      roomId,
      roomDomain: "example.com",
      now,
    });
    expect(verdict.ok).toBe(false);
  });
});

describe("pruneSessions", () => {
  it("drops expired sessions and caps total count", () => {
    const now = 1_000_000;
    const sessions = {
      expired: { pid: "pk_a", expiresAt: now - 1 },
      live1: { pid: "pk_b", expiresAt: now + 1000 },
      live2: { pid: "pk_c", expiresAt: now + 2000 },
    };
    const pruned = pruneSessions(sessions, now, 1);
    expect(Object.keys(pruned)).toEqual(["live2"]);
  });
});

describe("sanitizeWellKnownConfig", () => {
  const validPk = "pk_" + "ab".repeat(65);

  it("keeps valid roles and rules and drops malformed entries", () => {
    const config = sanitizeWellKnownConfig({
      roles: { admin: [validPk, "not-a-key", 42], broken: "nope" },
      rules: [
        { match: "site-title", write: "admin" },
        { match: "" },
        "garbage",
        { match: "note-*", create: "anyone", update: "creator" },
      ],
    });
    expect(config).not.toBeNull();
    expect(config!.roles).toEqual({ admin: [validPk] });
    expect(config!.rules).toHaveLength(2);
    expect(config!.rules![1].update).toBe("creator");
  });

  it("returns null when there are no usable rules", () => {
    expect(sanitizeWellKnownConfig({ roles: {} })).toBeNull();
    expect(sanitizeWellKnownConfig("nope")).toBeNull();
  });

  it("validates pk format strictly", () => {
    expect(isVerifiablePublicKey(validPk)).toBe(true);
    expect(isVerifiablePublicKey("pk_zz")).toBe(false);
    expect(isVerifiablePublicKey("ab".repeat(65))).toBe(false);
  });
});

describe("rule matching", () => {
  it("matches exact ids, #-prefixed patterns, and trailing globs", () => {
    expect(matchesRulePattern("site-title", "site-title")).toBe(true);
    expect(matchesRulePattern("#site-title", "site-title")).toBe(true);
    expect(matchesRulePattern("note-*", "note-42")).toBe(true);
    expect(matchesRulePattern("note-*", "other")).toBe(false);
  });

  it("falls back from entry actions to the write requirement", () => {
    const rules: PermissionRule[] = [{ match: "x", write: "admin" }];
    expect(requiredRolesForAction(rules, "x", "delete")).toBe("admin");
    expect(requiredRolesForAction(rules, "y", "write")).toBeNull();
  });

  it("respects rule path scoping", () => {
    const rules: PermissionRule[] = [
      { match: "x", path: "/wall", write: "admin" },
    ];
    expect(requiredRolesForAction(rules, "x", "write", "/wall")).toBe("admin");
    expect(requiredRolesForAction(rules, "x", "write", "/other")).toBeNull();
    expect(isElementGated(rules, "x", "/wall")).toBe(true);
    expect(isElementGated(rules, "x", "/other")).toBe(false);
  });
});

describe("evaluateGatedWrite", () => {
  const adminPk = "pk_" + "aa".repeat(65);
  const alicePk = "pk_" + "bb".repeat(65);
  const bobPk = "pk_" + "cc".repeat(65);
  const roles = { admin: [adminPk] };

  it("allows write-gated replacement only for the required role", () => {
    const rules: PermissionRule[] = [{ match: "title", write: "admin" }];
    const allowed = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "title",
      pid: adminPk,
      currentData: { text: "old" },
      incomingData: { text: "new" },
    });
    expect(allowed).toEqual({ ok: true, data: { text: "new" } });

    const denied = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "title",
      pid: alicePk,
      currentData: { text: "old" },
      incomingData: { text: "new" },
    });
    expect(denied.ok).toBe(false);
  });

  it("denies unverified principals for verified-gated writes", () => {
    const rules: PermissionRule[] = [{ match: "board", write: "verified" }];
    const denied = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "board",
      pid: undefined,
      currentData: {},
      incomingData: { a: 1 },
    });
    expect(denied.ok).toBe(false);
  });

  it("stamps createdBy on entry creates and pins it on updates", () => {
    const rules: PermissionRule[] = [
      { match: "notes", create: "verified", update: "creator", delete: "creator" },
    ];
    const created = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: alicePk,
      currentData: {},
      incomingData: { n1: { text: "hi", createdBy: "pk_forged" } },
    });
    expect(created.ok).toBe(true);
    expect((created as any).data.n1.createdBy).toBe(alicePk);

    // Alice updates her own entry — allowed, ownership preserved
    const updated = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: alicePk,
      currentData: { n1: { text: "hi", createdBy: alicePk } },
      incomingData: { n1: { text: "edited", createdBy: bobPk } },
    });
    expect(updated.ok).toBe(true);
    expect((updated as any).data.n1.createdBy).toBe(alicePk);

    // Bob can't update Alice's entry
    const denied = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: bobPk,
      currentData: { n1: { text: "hi", createdBy: alicePk } },
      incomingData: { n1: { text: "vandalized", createdBy: alicePk } },
    });
    expect(denied.ok).toBe(false);

    // Bob can't delete Alice's entry either
    const deleteDenied = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: bobPk,
      currentData: { n1: { text: "hi", createdBy: alicePk } },
      incomingData: {},
    });
    expect(deleteDenied.ok).toBe(false);

    // Alice deletes her own entry
    const deleted = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: alicePk,
      currentData: { n1: { text: "hi", createdBy: alicePk } },
      incomingData: {},
    });
    expect(deleted.ok).toBe(true);
  });

  it("lets an element-level write role override entry checks (admin path)", () => {
    const rules: PermissionRule[] = [
      { match: "notes", write: "admin", update: "creator" },
    ];
    const verdict = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: adminPk,
      currentData: { n1: { text: "hi", createdBy: alicePk } },
      incomingData: {},
    });
    expect(verdict.ok).toBe(true);
  });

  it("rejects non-keyed-map data under entry-level rules", () => {
    const rules: PermissionRule[] = [{ match: "notes", update: "creator" }];
    const verdict = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: alicePk,
      currentData: {},
      incomingData: [1, 2, 3],
    });
    expect(verdict.ok).toBe(false);
  });
});

describe("collectChangedElementIds", () => {
  it("extracts element ids from deep play-map events", () => {
    const doc = new Y.Doc();
    const play = doc.getMap("play");
    const collected: Array<Set<string> | null> = [];
    play.observeDeep((events) => {
      collected.push(collectChangedElementIds(events as any));
    });

    // Change at tag-map level (path length 1): keys are element ids
    doc.transact(() => {
      const tagMap = new Y.Map();
      play.set("can-play", tagMap);
    });
    // play-level change → null ("anything")
    expect(collected[0]).toBeNull();

    doc.transact(() => {
      (play.get("can-play") as Y.Map<any>).set("guestbook", new Y.Map());
    });
    expect(Array.from(collected[1]!)).toEqual(["guestbook"]);

    doc.transact(() => {
      const el = (play.get("can-play") as Y.Map<any>).get("guestbook") as Y.Map<any>;
      el.set("text", "deep change");
    });
    expect(Array.from(collected[2]!)).toEqual(["guestbook"]);
  });
});
