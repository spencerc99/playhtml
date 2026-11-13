// ABOUTME: Verifies the persistent player identity survives blocked localStorage.
// ABOUTME: Sandboxed iframes and some private modes throw on every storage access.
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("generatePersistentPlayerIdentity with blocked storage", () => {
  it("returns a stable generated identity and warns instead of throwing", async () => {
    const blocked = () => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    };
    vi.stubGlobal("localStorage", {
      getItem: blocked,
      setItem: blocked,
      removeItem: blocked,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.resetModules();
    const { generatePersistentPlayerIdentity } =
      await import("../cursor-types");

    const identity = generatePersistentPlayerIdentity();

    expect(identity.publicKey).toEqual(expect.any(String));
    expect(identity.playerStyle.colorPalette.length).toBeGreaterThan(0);
    expect(generatePersistentPlayerIdentity()).toBe(identity);
    expect(warn).toHaveBeenCalledWith(
      "Failed to read player identity from localStorage:",
      expect.any(DOMException),
    );
    expect(warn).toHaveBeenCalledWith(
      "Failed to save player identity to localStorage:",
      expect.any(DOMException),
    );
  });
});
