// ABOUTME: Verifies background-owned browser-session coordination and fallbacks.
// ABOUTME: Covers shared session IDs, runtime requests, and Web Crypto gaps.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalCrypto = globalThis.crypto;

function installCryptoWithoutRandomUuid(): void {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues: (bytes: Uint8Array) => {
        for (let i = 0; i < bytes.length; i++) {
          bytes[i] = (i * 17 + 11) % 256;
        }
        return bytes;
      },
    } as Pick<Crypto, "getRandomValues">,
  });
}

function installSequentialCrypto(): void {
  let nextId = 0;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: () => `00000000-0000-4000-8000-${String(++nextId).padStart(12, "0")}`,
    } as Pick<Crypto, "randomUUID">,
  });
}

function installBrowser(options: {
  sessionStorage?: Record<string, unknown> | null;
  sendMessage?: ReturnType<typeof vi.fn>;
} = {}) {
  const sessionStorage = options.sessionStorage === undefined ? {} : options.sessionStorage;
  const get = vi.fn(async (keys: string[]) => {
    const result: Record<string, unknown> = {};
    for (const key of keys) {
      if (sessionStorage && key in sessionStorage) {
        result[key] = sessionStorage[key];
      }
    }
    return result;
  });
  const set = vi.fn(async (items: Record<string, unknown>) => {
    if (sessionStorage) Object.assign(sessionStorage, items);
  });
  const sendMessage = options.sendMessage ?? vi.fn().mockResolvedValue("sid_background");

  vi.doMock("webextension-polyfill", () => ({
    default: {
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
        },
        ...(sessionStorage ? { session: { get, set } } : {}),
      },
      runtime: {
        sendMessage,
      },
    },
  }));

  return { get, set, sendMessage };
}

describe("participant storage fallbacks", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: originalCrypto,
    });
  });

  it("returns the stored browser session id", async () => {
    const storage = { collection_session_id: "sid_existing" };
    const { set } = installBrowser({ sessionStorage: storage });

    const { getSessionId } = await import("../storage/participant");

    expect(await getSessionId()).toBe("sid_existing");
    expect(set).not.toHaveBeenCalled();
  });

  it("shares one created id across concurrent requests", async () => {
    installSequentialCrypto();
    const storage: Record<string, unknown> = {};
    const { get, set } = installBrowser({ sessionStorage: storage });

    const { getSessionId } = await import("../storage/participant");
    const [first, second] = await Promise.all([getSessionId(), getSessionId()]);

    expect(first).toBe(second);
    expect(storage.collection_session_id).toBe(first);
    expect(get).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledOnce();
  });

  it("requests the coordinated session id from the background", async () => {
    const sendMessage = vi.fn().mockResolvedValue("sid_background");
    installBrowser({ sendMessage });

    const { requestSessionId } = await import("../storage/participant");

    expect(await requestSessionId()).toBe("sid_background");
    expect(sendMessage).toHaveBeenCalledWith({ type: "GET_SESSION_ID" });
  });

  it("keeps one background fallback when privileged session storage fails", async () => {
    installCryptoWithoutRandomUuid();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    installBrowser({ sessionStorage: null });

    const { getSessionId } = await import("../storage/participant");
    const first = await getSessionId();
    const second = await getSessionId();

    expect(first.startsWith("sid_")).toBe(true);
    expect(first).toBe(second);
    expect(error).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      "[Participant] Failed to access browser session storage:",
      expect.any(Error),
    );
  });

});
