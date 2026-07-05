// ABOUTME: Verifies the client auth handshake protocol surface: verify() promise
// ABOUTME: resolution, session-token resume, and gated-write denial events.
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  bindHandshake,
  unbindHandshake,
  handleAuthMessage,
  requestVerification,
  sendGatedWrite,
} from "../auth/handshake";
import {
  getMe,
  setIdentity,
  PERMISSION_DENIED_EVENT,
  __resetPermissionsForTests,
} from "../auth/permissions";

const PK = "pk_" + "ab".repeat(65);
const OTHER_PK = "pk_" + "cd".repeat(65);

function bind(sent: string[]): void {
  bindHandshake({
    send: (m) => sent.push(m),
    getPid: () => PK,
    roomId: "example.com-%2Fwall",
  });
}

beforeEach(() => {
  __resetPermissionsForTests();
  unbindHandshake();
  sessionStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("verify()", () => {
  it("resolves true on auth_ok and marks me verified", async () => {
    const sent: string[] = [];
    bind(sent);

    const result = requestVerification();
    expect(JSON.parse(sent.at(-1)!)).toEqual({ type: "auth_request" });

    handleAuthMessage({
      type: "auth_ok",
      pid: PK,
      token: "tok",
      expiresAt: Date.now() + 1000,
    });
    await expect(result).resolves.toBe(true);
    expect(getMe().verified).toBe(true);
  });

  it("resolves false on a terminal auth_error", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sent: string[] = [];
    bind(sent);

    const result = requestVerification();
    handleAuthMessage({ type: "auth_error", reason: "origin_mismatch" });
    await expect(result).resolves.toBe(false);
    expect(getMe().verified).toBe(false);
    warn.mockRestore();
  });

  it("keeps waiting through invalid_token (server re-challenges)", async () => {
    const sent: string[] = [];
    bind(sent);

    const result = requestVerification();
    handleAuthMessage({ type: "auth_error", reason: "invalid_token" });
    handleAuthMessage({
      type: "auth_ok",
      pid: PK,
      token: "tok2",
      expiresAt: Date.now() + 1000,
    });
    await expect(result).resolves.toBe(true);
  });

  it("resolves false without a bound connection", async () => {
    await expect(requestVerification()).resolves.toBe(false);
  });

  it("clears the stored room token before requesting verification", async () => {
    const sent: string[] = [];
    sessionStorage.setItem("playhtml_auth_token_example.com-%2Fwall", "tok");
    bind(sent);

    const result = requestVerification();

    expect(sessionStorage.getItem("playhtml_auth_token_example.com-%2Fwall")).toBeNull();
    handleAuthMessage({ type: "auth_error", reason: "origin_mismatch" });
    await expect(result).resolves.toBe(false);
  });

  it("rejects auth_ok for a different current pid", async () => {
    const sent: string[] = [];
    bind(sent);

    const result = requestVerification();
    handleAuthMessage({
      type: "auth_ok",
      pid: OTHER_PK,
      token: "tok-other",
      expiresAt: Date.now() + 1000,
    });

    await expect(result).resolves.toBe(false);
    expect(getMe().verified).toBe(false);
    expect(sessionStorage.getItem("playhtml_auth_token_example.com-%2Fwall")).toBeNull();
  });
});

describe("session resume", () => {
  it("answers the first challenge with a stored token instead of a signature", () => {
    const sent: string[] = [];
    // A previous session stored a token for this room.
    sessionStorage.setItem("playhtml_auth_token_example.com-%2Fwall", "tok");
    bind(sent);

    handleAuthMessage({
      type: "auth_challenge",
      nonce: "n",
      roomId: "example.com-%2Fwall",
      ts: Date.now(),
    });
    expect(JSON.parse(sent.at(-1)!)).toEqual({ type: "auth_resume", token: "tok" });
  });
});

describe("gated writes", () => {
  it("fires permissiondenied on the element when the server rejects", () => {
    const sent: string[] = [];
    bind(sent);
    setIdentity({
      publicKey: PK,
      playerStyle: { colorPalette: ["red"] },
      source: "local",
    });

    const element = document.createElement("div");
    element.id = "title";
    document.body.appendChild(element);
    const denied = vi.fn();
    element.addEventListener(PERMISSION_DENIED_EVENT, denied);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    sendGatedWrite({ element, tag: "can-play", elementId: "title", data: { a: 1 } });
    const message = JSON.parse(sent.at(-1)!);
    expect(message.type).toBe("gated_write");

    handleAuthMessage({
      type: "gated_write_result",
      opId: message.opId,
      ok: false,
      reason: "missing required role for write",
    });
    expect(denied).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("fires permissiondenied when the server never answers", () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    bind(sent);

    const element = document.createElement("div");
    element.id = "title";
    document.body.appendChild(element);
    const denied = vi.fn();
    element.addEventListener(PERMISSION_DENIED_EVENT, denied);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    sendGatedWrite({ element, tag: "can-play", elementId: "title", data: { a: 1 } });
    expect(JSON.parse(sent.at(-1)!).type).toBe("gated_write");

    vi.advanceTimersByTime(10_000);

    expect(denied).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
