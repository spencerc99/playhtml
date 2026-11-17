// ABOUTME: Tests md5Hex against RFC 1321 vectors, UTF-8 text, and Node's md5.
// ABOUTME: The page lookup only works if this matches what Postgres md5(url) computes.

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { md5Hex } from "../utils/md5";

const nodeMd5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");

describe("md5Hex", () => {
  it.each([
    ["", "d41d8cd98f00b204e9800998ecf8427e"],
    ["a", "0cc175b9c0f1b6a831c399e269772661"],
    ["abc", "900150983cd24fb0d6963f7d28e17f72"],
    ["message digest", "f96b697d7cb7938d525a2f31aaf161d0"],
    ["abcdefghijklmnopqrstuvwxyz", "c3fcd3d76192e4007dfb496cca67e13b"],
    [
      "12345678901234567890123456789012345678901234567890123456789012345678901234567890",
      "57edf4a22be3c955ac49da2e2107b67a",
    ],
  ])("hashes %j to the RFC 1321 value", (text, expected) => {
    expect(md5Hex(text)).toBe(expected);
  });

  it("hashes a long string across many blocks", () => {
    const long = "https://example.com/".repeat(5000);
    expect(md5Hex(long)).toBe(nodeMd5(long));
  });

  it("hashes the UTF-8 bytes of non-ASCII text", () => {
    for (const text of ["https://ja.wikipedia.org/wiki/猫", "café", "emoji \u{1F408} cat", "\u0000ÿĀ"]) {
      expect(md5Hex(text)).toBe(nodeMd5(text));
    }
  });

  it("matches Node's md5 at every padding boundary and on random strings", () => {
    for (let length = 0; length <= 130; length++) {
      const text = "x".repeat(length);
      expect(md5Hex(text)).toBe(nodeMd5(text));
    }
    for (let i = 0; i < 200; i++) {
      const length = Math.floor(Math.random() * 300);
      const text = Array.from({ length }, () =>
        String.fromCodePoint(Math.floor(Math.random() * 0x2fff) + 0x20),
      ).join("");
      expect(md5Hex(text)).toBe(nodeMd5(text));
    }
  });
});
