// ABOUTME: Verifies session identity fallbacks for Firefox API gaps.
// ABOUTME: Covers missing crypto.randomUUID and missing browser.storage.session.

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

  it("uses a stable in-memory sid when browser.storage.session is unavailable", async () => {
    installCryptoWithoutRandomUuid();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.doMock("webextension-polyfill", () => ({
      default: {
        storage: {
          local: {
            get: vi.fn().mockResolvedValue({}),
          },
        },
      },
    }));

    const { getSessionId } = await import("../storage/participant");
    const first = await getSessionId();
    const second = await getSessionId();

    expect(first.startsWith("sid_")).toBe(true);
    expect(first).toBe(second);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "[Participant] browser.storage.session unavailable; using in-memory session id",
    );
  });

});
