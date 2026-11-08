// ABOUTME: Verifies person colors convert to hex and new identities save hex colors.
// ABOUTME: Native color inputs only accept #rrggbb, so hsl/rgb colors must be normalized.
import { describe, expect, test } from "vitest";
import {
  generatePlayerIdentity,
  isValidPersonColor,
  normalizePersonName,
  playerIdentityToUser,
  toHexColor,
} from "../cursor-types";

describe("toHexColor", () => {
  test("keeps 6-digit hex and expands 3-digit hex, lowercased", () => {
    expect(toHexColor("#AbCdEf")).toBe("#abcdef");
    expect(toHexColor("#0f8")).toBe("#00ff88");
  });

  test("converts hsl in comma, space and alpha forms", () => {
    expect(toHexColor("hsl(0, 100%, 50%)")).toBe("#ff0000");
    expect(toHexColor("hsl(120 100% 25%)")).toBe("#008000");
    expect(toHexColor("hsla(240, 100%, 50%, 1)")).toBe("#0000ff");
    expect(toHexColor("hsl(200deg 70% 60%)")).toBe("#52b1e0");
    expect(toHexColor("hsl(-120, 100%, 50%)")).toBe("#0000ff");
    expect(toHexColor("hsl(210, 70%, 60%)")).toBe("#5299e0");
  });

  test("converts rgb and clamps out-of-range channels", () => {
    expect(toHexColor("rgb(255, 128, 0)")).toBe("#ff8000");
    expect(toHexColor("rgba(10 20 30 / 100%)")).toBe("#0a141e");
    expect(toHexColor("rgb(300, -1, 0)")).toBe("rgb(300, -1, 0)");
  });

  test("keeps alpha as #rrggbbaa when the color is see-through", () => {
    expect(toHexColor("hsla(240, 100%, 50%, 0.5)")).toBe("#0000ff80");
    expect(toHexColor("hsl(200deg 70% 60% / 50%)")).toBe("#52b1e080");
    expect(toHexColor("rgba(10 20 30 / 0.4)")).toBe("#0a141e66");
    expect(toHexColor("rgba(0, 0, 0, 0)")).toBe("#00000000");
    expect(toHexColor("#0F08")).toBe("#00ff0088");
    expect(toHexColor("#112233CC")).toBe("#112233cc");
    expect(toHexColor("#112233ff")).toBe("#112233");
  });

  test("returns other colors unchanged", () => {
    expect(toHexColor("red")).toBe("red");
    expect(toHexColor("")).toBe("");
  });
});

describe("generatePlayerIdentity", () => {
  test("saves every palette color as hex", () => {
    for (let i = 0; i < 20; i++) {
      const { colorPalette } = generatePlayerIdentity().playerStyle;
      expect(colorPalette).toHaveLength(3);
      for (const color of colorPalette) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("playerIdentityToUser", () => {
  test("reports an older hsl color as hex and keeps a missing color empty", () => {
    const user = playerIdentityToUser(
      { publicKey: "pk", playerStyle: { colorPalette: ["hsl(0, 100%, 50%)"] } },
      false,
    );
    expect(user.color).toBe("#ff0000");
    expect(
      playerIdentityToUser(
        { publicKey: "pk", playerStyle: { colorPalette: [] } },
        false,
      ).color,
    ).toBe("");
  });
});

describe("normalizePersonName", () => {
  test("trims, caps at 32 characters and clears blank names", () => {
    expect(normalizePersonName("  Ada  ")).toBe("Ada");
    expect(normalizePersonName("x".repeat(33))).toBe("x".repeat(32));
    expect(normalizePersonName("   ")).toBeUndefined();
    expect(normalizePersonName(undefined)).toBeUndefined();
    expect(normalizePersonName(42)).toBeUndefined();
  });

  test("doesn't split emoji at the cap", () => {
    const name = "\u{1F600}".repeat(40);
    expect(Array.from(normalizePersonName(name)!)).toHaveLength(32);
  });

  test("playerIdentityToUser caps remote names", () => {
    const user = playerIdentityToUser(
      {
        publicKey: "p",
        name: "n".repeat(40),
        playerStyle: { colorPalette: ["#fff"] },
      },
      false,
    );
    expect(user.name).toBe("n".repeat(32));
  });
});

describe("isValidPersonColor", () => {
  test("accepts hex, rgb and hsl, including see-through ones", () => {
    for (const color of [
      "#fff",
      "#ff000080",
      "rgb(1 2 3)",
      "rgba(1,2,3,0.5)",
      "hsl(200 70% 60%)",
      "hsla(0, 100%, 50%, 0.5)",
    ]) {
      expect(isValidPersonColor(color)).toBe(true);
    }
  });

  test("rejects empty, wide keywords and non-strings", () => {
    for (const color of [
      "",
      "  ",
      "inherit",
      "currentColor",
      "unset",
      "#ggg",
      "rgb(",
      null,
      3,
    ]) {
      expect(isValidPersonColor(color)).toBe(false);
    }
  });

  test("asks the browser about other colors when it can", () => {
    const original = (globalThis as { CSS?: unknown }).CSS;
    (globalThis as { CSS?: unknown }).CSS = {
      supports: (_property: string, value: string) => value === "tomato",
    };
    try {
      expect(isValidPersonColor("tomato")).toBe(true);
      expect(isValidPersonColor("banana")).toBe(false);
    } finally {
      (globalThis as { CSS?: unknown }).CSS = original;
    }
  });
});
