// ABOUTME: Tests how a share's signature is made from the maker's identity and the popover's choice.
// ABOUTME: Covers a named maker, a typed name, the colour-only seal, unsigned shares, and stored hsl colours.

import { describe, expect, it } from "vitest";
import {
  signatureFor,
  signatureName,
  signerIdentity,
} from "../entrypoints/scraps/collageSignature";
import { cssColorToHex } from "../utils/color";

describe("signerIdentity", () => {
  it("reads the cursor colour as hex and keeps a real name", () => {
    expect(
      signerIdentity({
        name: " spencer ",
        playerStyle: { colorPalette: ["#FFAE00"] },
      }),
    ).toEqual({ color: "#ffae00", name: "spencer" });
    expect(
      signerIdentity({ playerStyle: { colorPalette: ["hsl(0, 100%, 50%)"] } }),
    ).toEqual({ color: "#ff0000" });
  });

  it("has no signer without a usable colour", () => {
    expect(signerIdentity(null)).toBeNull();
    expect(signerIdentity({ playerStyle: { colorPalette: [] } })).toBeNull();
    expect(
      signerIdentity({ playerStyle: { colorPalette: ["papayawhip"] } }),
    ).toBeNull();
  });
});

describe("signatureFor", () => {
  const named = { color: "#ffae00", name: "spencer" };
  const nameless = { color: "#4f8cff" };

  it("signs with the maker's own name", () => {
    expect(signatureFor(named, { signing: true, name: "" })).toEqual(named);
    expect(signatureFor(named, { signing: true, name: "other" })).toEqual(
      named,
    );
  });

  it("signs a nameless maker with a typed name, or the colour alone", () => {
    expect(signatureFor(nameless, { signing: true, name: " mira " })).toEqual({
      color: "#4f8cff",
      name: "mira",
    });
    expect(signatureFor(nameless, { signing: true, name: "   " })).toEqual({
      color: "#4f8cff",
    });
  });

  it("leaves the share unsigned when signing is off or no one is known", () => {
    expect(signatureFor(named, { signing: false, name: "" })).toBeUndefined();
    expect(signatureFor(null, { signing: true, name: "mira" })).toBeUndefined();
  });

  it("trims a typed name to what a signature carries", () => {
    expect(signatureName("a\u0007b")).toBe("ab");
    expect(signatureName("ari\u202Ekcis\u200B")).toBe("arikcis");
    expect(signatureName("x".repeat(80))).toHaveLength(60);
  });
});

describe("cssColorToHex", () => {
  it("reads hex and hsl cursor colours", () => {
    expect(cssColorToHex("#ABC")).toBe("#aabbcc");
    expect(cssColorToHex("#ffae00")).toBe("#ffae00");
    expect(cssColorToHex("hsl(0, 100%, 50%)")).toBe("#ff0000");
    expect(cssColorToHex("hsl(120 100% 25%)")).toBe("#008000");
    expect(cssColorToHex("rgb(1, 2, 3)")).toBeNull();
  });
});
