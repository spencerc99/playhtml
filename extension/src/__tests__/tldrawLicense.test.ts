// ABOUTME: Tests reading the tldraw license key's expiry and deciding whether the tldraw editor can run.
// ABOUTME: Trial keys stop at the start of the day after their date, with no grace period.

import { describe, expect, it } from "vitest";
import {
  licenseExpiryDate,
  licenseStatus,
} from "../entrypoints/scraps/tldraw/tldrawLicense";

function keyFor(expiry: string): string {
  const payload = btoa(JSON.stringify(["id", ["*"], 16, expiry])).replace(/=+$/, "");
  return `tldraw-${expiry}/${payload}.signature`;
}

describe("tldraw license", () => {
  it("reads the expiry date from the key's payload", () => {
    expect(licenseExpiryDate(keyFor("2026-10-09"))).toBe("2026-10-09");
  });

  it("works through the whole expiry day and stops the moment after, in UTC", () => {
    const key = keyFor("2026-10-09");
    expect(licenseStatus(key, Date.UTC(2026, 9, 9, 23, 59, 59))).toMatchObject({
      usable: true,
      expiresOn: "2026-10-09",
    });
    expect(licenseStatus(key, Date.UTC(2026, 9, 10))).toMatchObject({
      usable: false,
      reason: "expired",
    });
  });

  it("says plainly when the build has no key or an unreadable one", () => {
    expect(licenseStatus("")).toMatchObject({ usable: false, reason: "missing" });
    expect(licenseStatus("not-a-key")).toMatchObject({ usable: false, reason: "unreadable" });
    expect(licenseStatus("tldraw-x/bm90IGpzb24.sig")).toMatchObject({
      usable: false,
      reason: "unreadable",
    });
  });
});
