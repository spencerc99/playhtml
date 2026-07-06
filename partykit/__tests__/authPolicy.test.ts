// ABOUTME: Verifies server auth policy: room-name parsing, challenge verification,
// ABOUTME: session pruning, well-known config sanitization, and gated-write evaluation.
import { describe, expect, it, spyOn } from "bun:test";
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
  planGatedReverts,
  removeElementDataFromPlayDoc,
  AUTH_CHALLENGE_TTL_MS,
  type GatedSnapshots,
} from "../auth";
import {
  buildAuthChallengePayload,
  parseAuthChallengePayload,
  exportPublicKeyHex,
  sanitizeWellKnownConfig,
  satisfiesRole,
  signAuthPayload,
  matchesRulePattern,
  normalizeElementRules,
  pathSpecificity,
  ruleAppliesToPath,
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

  it("parses canonical challenge payloads by field name", () => {
    const payload = buildAuthChallengePayload({
      nonce: "nonce",
      roomId,
      origin: "https://example.com",
      ts: 1234,
    });

    expect(parseAuthChallengePayload(payload)).toEqual({
      protocol: "playhtml-auth-v1",
      nonce: "nonce",
      roomId,
      origin: "https://example.com",
      ts: 1234,
    });
    expect(() => parseAuthChallengePayload("bad|payload")).toThrow();
  });

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

  it("returns null when there are no usable rules or roles", () => {
    expect(sanitizeWellKnownConfig({ roles: {} })).toBeNull();
    expect(sanitizeWellKnownConfig("nope")).toBeNull();
  });

  it("keeps roles-only configs (UI role gating without gated elements)", () => {
    const config = sanitizeWellKnownConfig({ roles: { admin: [validPk] } });
    expect(config).not.toBeNull();
    expect(config!.roles).toEqual({ admin: [validPk] });
    expect(config!.rules).toEqual([]);
  });

  it("validates pk format strictly", () => {
    expect(isVerifiablePublicKey(validPk)).toBe(true);
    expect(isVerifiablePublicKey("pk_zz")).toBe(false);
    expect(isVerifiablePublicKey("ab".repeat(65))).toBe(false);
  });

  it("accepts the ergonomic elements map with string specs", () => {
    const config = sanitizeWellKnownConfig({
      elements: {
        "site-title": `write:${validPk}`,
        "notes": { create: "verified", update: "creator" },
      },
    });
    expect(config).not.toBeNull();
    expect(config!.rules).toHaveLength(2);
    expect(config!.rules![0]).toEqual({ match: "site-title", write: validPk });
    expect(config!.rules![1].update).toBe("creator");
  });

  it("accepts path-keyed elements and drops invalid path keys", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const config = sanitizeWellKnownConfig({
      elements: {
        "/*": { "site-title": "write:admin" },
        "/wall": { guestbook: "create:verified" },
        "/bad/*/path": { broken: "write:admin" },
        "/bad**": { alsoBroken: "write:admin" },
      },
    });

    expect(config).not.toBeNull();
    expect(config!.rules).toEqual([
      { match: "site-title", path: "/*", write: "admin" },
      { match: "guestbook", path: "/wall", create: "verified" },
    ]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("drops CSS-selector patterns (never matchable server-side)", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const config = sanitizeWellKnownConfig({
      elements: { "[data-note]": "write:admin", "real-id": "write:admin" },
      rules: [{ match: ".note", write: "admin" }],
    });
    expect(config).not.toBeNull();
    expect(config!.rules!.map((r) => r.match)).toEqual(["real-id"]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe("raw pk_… role refs", () => {
  const ownerPk = "pk_" + "cd".repeat(65);

  it("matches exactly that pid with no roles config", () => {
    expect(
      satisfiesRole(ownerPk, { pid: ownerPk, verified: true }, {}, {
        requireVerifiedForKeyRoles: true,
      })
    ).toBe(true);
    expect(
      satisfiesRole(ownerPk, { pid: "pk_" + "ee".repeat(65), verified: true }, {})
    ).toBe(false);
    // server-side: an unverified claim of the pid doesn't count
    expect(
      satisfiesRole(ownerPk, { pid: ownerPk, verified: false }, {}, {
        requireVerifiedForKeyRoles: true,
      })
    ).toBe(false);
  });
});

describe("rule matching", () => {
  it("matches exact ids, #-prefixed patterns, and trailing globs", () => {
    expect(matchesRulePattern("site-title", "site-title")).toBe(true);
    expect(matchesRulePattern("#site-title", "site-title")).toBe(true);
    expect(matchesRulePattern("note-*", "note-42")).toBe(true);
    expect(matchesRulePattern("note-*", "other")).toBe(false);
  });

  it("normalizes flat and path-keyed element maps", () => {
    expect(
      normalizeElementRules({
        "site-title": "write:admin",
        "note-*": { update: "creator" },
      })
    ).toEqual([
      { match: "site-title", write: "admin" },
      { match: "note-*", update: "creator" },
    ]);

    expect(
      normalizeElementRules({
        "/*": { "site-title": "write:admin" },
        "/blog/*": { "comment-*": "write:verified" },
      })
    ).toEqual([
      { path: "/*", match: "site-title", write: "admin" },
      { path: "/blog/*", match: "comment-*", write: "verified" },
    ]);
  });

  it("warns and falls back to flat normalization for mixed element maps", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    const rules = normalizeElementRules({
      "/*": { "site-title": "write:admin" },
      guestbook: "create:verified",
    });

    expect(rules).toEqual([{ match: "guestbook", create: "verified" }]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0]).toLowerCase()).toContain("mixed");
    warn.mockRestore();
  });

  it("matches rule paths by exact value, trailing glob, /*, and omitted path", () => {
    expect(ruleAppliesToPath({}, undefined)).toBe(true);
    expect(ruleAppliesToPath({ path: "/*" }, undefined)).toBe(true);
    expect(ruleAppliesToPath({ path: "/*" }, "/wall")).toBe(true);
    expect(ruleAppliesToPath({ path: "/wall" }, "/wall")).toBe(true);
    expect(ruleAppliesToPath({ path: "/wall" }, "/wall/post")).toBe(false);
    expect(ruleAppliesToPath({ path: "/blog/*" }, "/blog")).toBe(true);
    expect(ruleAppliesToPath({ path: "/blog/*" }, "/blog/post-1")).toBe(true);
    expect(ruleAppliesToPath({ path: "/blog/*" }, "/blogroll")).toBe(false);
  });

  it("ranks path specificity with exact over longer glob over catch-all", () => {
    expect(pathSpecificity("/blog/post-1", "/blog/post-1")).toBeGreaterThan(
      pathSpecificity("/blog/*", "/blog/post-1")
    );
    expect(pathSpecificity("/blog/deep/*", "/blog/deep/post-1")).toBeGreaterThan(
      pathSpecificity("/blog/*", "/blog/deep/post-1")
    );
    expect(pathSpecificity("/*", "/blog/post-1")).toBe(
      pathSpecificity(undefined, "/blog/post-1")
    );
  });

  it("falls back from entry actions to the write requirement", () => {
    const rules: PermissionRule[] = [{ match: "x", write: "admin" }];
    expect(requiredRolesForAction(rules, "x", "delete")).toBe("admin");
    expect(requiredRolesForAction(rules, "y", "write")).toBeNull();
  });

  it("uses an exact element id before a glob at the same path", () => {
    const rules: PermissionRule[] = [
      { match: "note-*", write: "admin" },
      { match: "note-public", write: "anyone" },
    ];

    expect(requiredRolesForAction(rules, "note-public", "write")).toBe("anyone");
  });

  it("uses the longer matching glob before a shorter glob at the same path", () => {
    const rules: PermissionRule[] = [
      { match: "note-*", write: "admin" },
      { match: "note-public-*", write: "anyone" },
    ];

    expect(requiredRolesForAction(rules, "note-public-1", "write")).toBe("anyone");
  });

  it("keeps path specificity above element-match specificity", () => {
    const rules: PermissionRule[] = [
      { match: "note-public", path: "/*", write: "anyone" },
      { match: "note-*", path: "/wall", write: "admin" },
    ];

    expect(requiredRolesForAction(rules, "note-public", "write", "/wall")).toBe(
      "admin"
    );
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

  it("recognizes page-data channel names as gated ids", () => {
    const rules: PermissionRule[] = [{ match: "my-channel", write: "admin" }];

    expect(isElementGated(rules, "my-channel", undefined)).toBe(true);
  });

  it("uses the most specific matching path per element id without merging actions", () => {
    const rules: PermissionRule[] = [
      { match: "comment-1", path: "/*", write: "admin", delete: "admin" },
      { match: "comment-1", path: "/blog/*", write: "verified" },
      { match: "comment-1", path: "/blog/post-1", update: "creator" },
    ];

    expect(
      requiredRolesForAction(rules, "comment-1", "write", "/blog/post-1")
    ).toBeNull();
    expect(requiredRolesForAction(rules, "comment-1", "update", "/blog/post-1")).toBe(
      "creator"
    );
    expect(
      requiredRolesForAction(rules, "comment-1", "delete", "/blog/post-1")
    ).toBeNull();
    expect(
      requiredRolesForAction(rules, "comment-1", "delete", "/blog/post-2")
    ).toBe("verified");
    expect(
      requiredRolesForAction(rules, "comment-1", "delete", "/other")
    ).toBe("admin");
  });

  it("keeps the first rule when matching paths tie", () => {
    const rules: PermissionRule[] = [
      { match: "x", path: "/wall", write: "admin" },
      { match: "x", path: "/wall", write: "verified" },
    ];

    expect(requiredRolesForAction(rules, "x", "write", "/wall")).toBe("admin");
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
      ops: [{ op: "replace", key: "", value: { text: "new" } }],
    });
    expect(allowed).toEqual({
      ok: true,
      ops: [{ op: "replace", key: "", value: { text: "new" } }],
    });

    const denied = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "title",
      pid: alicePk,
      currentData: { text: "old" },
      ops: [{ op: "replace", key: "", value: { text: "new" } }],
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
      ops: [{ op: "replace", key: "", value: { a: 1 } }],
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
      ops: [
        { op: "create", key: "n1", value: { text: "hi", createdBy: "pk_forged" } },
      ],
    });
    expect(created.ok).toBe(true);
    expect((created as any).ops[0].value.createdBy).toBe(alicePk);

    // Alice updates her own entry — allowed, ownership preserved
    const updated = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: alicePk,
      currentData: { n1: { text: "hi", createdBy: alicePk } },
      ops: [
        {
          op: "update",
          key: "n1",
          value: { text: "edited", createdBy: bobPk },
        },
      ],
    });
    expect(updated.ok).toBe(true);
    expect((updated as any).ops[0].value.createdBy).toBe(alicePk);

    // Bob can't update Alice's entry
    const denied = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: bobPk,
      currentData: { n1: { text: "hi", createdBy: alicePk } },
      ops: [
        {
          op: "update",
          key: "n1",
          value: { text: "vandalized", createdBy: alicePk },
        },
      ],
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
      ops: [{ op: "delete", key: "n1" }],
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
      ops: [{ op: "delete", key: "n1" }],
    });
    expect(deleted.ok).toBe(true);
  });

  it("uses element-level write as fallback for unspecified entry actions", () => {
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
      ops: [{ op: "delete", key: "n1" }],
    });
    expect(verdict.ok).toBe(true);
  });

  it("rejects whole-element replace under entry-level rules without write", () => {
    const rules: PermissionRule[] = [{ match: "notes", update: "creator" }];
    const verdict = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: alicePk,
      currentData: {},
      ops: [{ op: "replace", key: "", value: [1, 2, 3] }],
    });
    expect(verdict.ok).toBe(false);
  });

  it("rejects an update op for a missing key", () => {
    const rules: PermissionRule[] = [{ match: "notes", update: "creator" }];
    const verdict = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: alicePk,
      currentData: {},
      ops: [{ op: "update", key: "missing", value: { text: "nope" } }],
    });

    expect(verdict.ok).toBe(false);
  });

  it("does not treat absent keys as deletes when evaluating a create op", () => {
    const rules: PermissionRule[] = [
      { match: "notes", create: "verified", delete: "creator" },
    ];

    const verdict = evaluateGatedWrite({
      rules,
      roles,
      roomPath: undefined,
      elementId: "notes",
      pid: bobPk,
      currentData: { a: { text: "A", createdBy: alicePk } },
      ops: [{ op: "create", key: "b", value: { text: "B" } }],
    });

    expect(verdict.ok).toBe(true);
    expect((verdict as any).ops).toEqual([
      { op: "create", key: "b", value: { text: "B", createdBy: bobPk } },
    ]);
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

  it("maps page-data channel changes to the channel name", () => {
    const doc = new Y.Doc();
    const play = doc.getMap("play");
    const collected: Array<Set<string> | null> = [];
    play.observeDeep((events) => {
      collected.push(collectChangedElementIds(events as any));
    });

    doc.transact(() => {
      const page = new Y.Map();
      play.set("__page__", page);
    });
    expect(collected[0]).toBeNull();

    doc.transact(() => {
      const page = play.get("__page__") as Y.Map<any>;
      const channel = new Y.Map();
      page.set("my-channel", channel);
    });
    expect(Array.from(collected[1]!)).toEqual(["my-channel"]);

    doc.transact(() => {
      const page = play.get("__page__") as Y.Map<any>;
      const channel = page.get("my-channel") as Y.Map<any>;
      channel.set("count", 1);
    });
    expect(Array.from(collected[2]!)).toEqual(["my-channel"]);
  });

  it("removes ambient element data when no gated snapshot exists", () => {
    const doc = new Y.Doc();
    const play = doc.getMap("play");
    const firstTag = new Y.Map();
    const firstData = new Y.Map();
    firstData.set("text", "ambient");
    firstTag.set("title", firstData);
    play.set("can-play", firstTag);
    const secondTag = new Y.Map();
    const secondData = new Y.Map();
    secondData.set("x", 1);
    secondTag.set("title", secondData);
    play.set("can-move", secondTag);

    expect(removeElementDataFromPlayDoc(doc, "title")).toBe(true);

    expect(firstTag.has("title")).toBe(false);
    expect(secondTag.has("title")).toBe(false);
  });
});

describe("planGatedReverts (backstop decision)", () => {
  const rules: PermissionRule[] = [{ match: "guestbook", write: "admin" }];
  const snapshot = { tag: "can-play", data: { entries: {} } };

  it("restores a gated element that has a stored snapshot", () => {
    const snapshots: GatedSnapshots = { guestbook: snapshot };
    const reverts = planGatedReverts(
      new Set(["guestbook"]),
      rules,
      undefined,
      snapshots,
    );
    expect(reverts).toEqual([
      { elementId: "guestbook", action: "restore", snapshot },
    ]);
  });

  it("removes (never adopts) a gated element with no snapshot", () => {
    const reverts = planGatedReverts(
      new Set(["guestbook"]),
      rules,
      undefined,
      {},
    );
    expect(reverts).toEqual([{ elementId: "guestbook", action: "remove" }]);
  });

  it("ignores changes to elements that aren't gated", () => {
    const reverts = planGatedReverts(
      new Set(["free-canvas"]),
      rules,
      undefined,
      {},
    );
    expect(reverts).toEqual([]);
  });

  it("checks every known gated snapshot when the change set is unknown (null)", () => {
    // collectChangedElementIds returns null when whole tags were replaced —
    // the backstop must then re-check every element it has a snapshot for.
    const snapshots: GatedSnapshots = { guestbook: snapshot };
    const reverts = planGatedReverts(null, rules, undefined, snapshots);
    expect(reverts).toEqual([
      { elementId: "guestbook", action: "restore", snapshot },
    ]);
  });

  it("respects path scope: a rule scoped to /wall doesn't gate elements on other paths", () => {
    const scoped: PermissionRule[] = [
      { path: "/wall", match: "guestbook", write: "admin" },
    ];
    expect(
      planGatedReverts(new Set(["guestbook"]), scoped, "/wall", {}),
    ).toEqual([{ elementId: "guestbook", action: "remove" }]);
    expect(
      planGatedReverts(new Set(["guestbook"]), scoped, "/other", {}),
    ).toEqual([]);
  });
});
