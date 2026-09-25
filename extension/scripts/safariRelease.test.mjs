// ABOUTME: Verifies Safari App Store version selection against Apple's release states.
// ABOUTME: Keeps uploads on editable versions and blocks uploads while review is active.

import { expect, test } from "vitest";
import { selectSafariVersion } from "./safariRelease.mjs";

function version(number, state) {
  return { id: number, attributes: { platform: "MAC_OS", versionString: number, appVersionState: state } };
}

test("uses an editable version after the prior version is released", () => {
  expect(selectSafariVersion([
    version("1.1", "READY_FOR_DISTRIBUTION"),
    version("1.2", "PREPARE_FOR_SUBMISSION"),
  ])).toEqual({ version: "1.2", id: "1.2" });
});

test("increments the App Store version after a release", () => {
  expect(selectSafariVersion([version("1.2", "READY_FOR_DISTRIBUTION")]))
    .toEqual({ version: "1.3", id: null });
});

test("waits while the latest Safari version is in review", () => {
  expect(() => selectSafariVersion([
    version("1.2", "WAITING_FOR_REVIEW"),
    version("1.1", "READY_FOR_DISTRIBUTION"),
  ])).toThrow("Safari 1.2 is WAITING_FOR_REVIEW");
});

test("compares numeric version components", () => {
  expect(selectSafariVersion([
    version("1.9", "REPLACED_WITH_NEW_VERSION"),
    version("1.10", "READY_FOR_DISTRIBUTION"),
  ])).toEqual({ version: "1.11", id: null });
});

test("requires an existing macOS App Store record", () => {
  expect(() => selectSafariVersion([])).toThrow("No macOS App Store version exists");
});
