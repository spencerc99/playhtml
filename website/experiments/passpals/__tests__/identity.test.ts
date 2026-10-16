// ABOUTME: Verifies that passpals rooms are derived from passwords without leaking them.
// ABOUTME: Covers normalization, room derivation, visitor salting, handles, and colors.
import { describe, expect, it } from "vitest";
import {
  colorForHandle,
  generateHandle,
  HANDLE_COLORS,
  isUsablePassword,
  MAX_HANDLE_LENGTH,
  normalizePassword,
  roomIdForPassword,
  sanitizeHandle,
  visitorIdForRoom,
} from "../identity";

function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

describe("password normalization", () => {
  it("puts the same password typed differently in the same bucket", () => {
    expect(normalizePassword("  Password1 ")).toBe("password1");
    expect(normalizePassword("PASSWORD1")).toBe(normalizePassword("password1"));
  });

  it("rejects an empty password", () => {
    expect(isUsablePassword("   ")).toBe(false);
    expect(isUsablePassword("hunter2")).toBe(true);
  });
});

describe("room derivation", () => {
  it("never contains the password itself", async () => {
    const room = await roomIdForPassword("letmein123");
    expect(room).not.toContain("letmein");
    expect(room).toMatch(/^passpals-[0-9a-f]{12}$/);
  });

  it("sends everyone with the same password to the same room", async () => {
    expect(await roomIdForPassword("Hunter2")).toBe(
      await roomIdForPassword("hunter2 "),
    );
  });

  it("sends different passwords to different rooms", async () => {
    expect(await roomIdForPassword("hunter2")).not.toBe(
      await roomIdForPassword("hunter3"),
    );
  });
});

describe("visitor ids", () => {
  it("is stable for one browser in one room", async () => {
    expect(await visitorIdForRoom("secret", "passpals-abc")).toBe(
      await visitorIdForRoom("secret", "passpals-abc"),
    );
  });

  it("is unlinkable across rooms for the same browser", async () => {
    expect(await visitorIdForRoom("secret", "passpals-abc")).not.toBe(
      await visitorIdForRoom("secret", "passpals-def"),
    );
  });
});

describe("handles", () => {
  it("generates a lowercase two-word handle with a suffix", () => {
    const handle = generateHandle(sequence([0, 0, 0.42]));
    expect(handle).toBe("dialup_modem42");
  });

  it("stays within the handle length limit when the list ends", () => {
    const handle = generateHandle(sequence([0.999999, 0.999999, 0.999999]));
    expect(handle.length).toBeLessThanOrEqual(MAX_HANDLE_LENGTH + 2);
  });

  it("strips control characters and collapses whitespace", () => {
    expect(sanitizeHandle("cool \t guy")).toBe("cool_guy");
    expect(sanitizeHandle(`bad${String.fromCharCode(7)}name`)).toBe("badname");
  });

  it("truncates an overlong handle", () => {
    expect(sanitizeHandle("a".repeat(60))).toHaveLength(MAX_HANDLE_LENGTH);
  });
});

describe("handle colors", () => {
  it("gives one handle the same color every time", () => {
    expect(colorForHandle("dialup_moth07")).toBe(colorForHandle("dialup_moth07"));
  });

  it("only uses colors from the palette", () => {
    for (const handle of ["a", "bb", "ccc", "dddd", "eeeee", "ffffff"]) {
      expect(HANDLE_COLORS).toContain(colorForHandle(handle));
    }
  });
});
