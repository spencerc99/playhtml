// ABOUTME: Tests Discord release announcement helpers for extension releases.
// ABOUTME: Verifies changelog extraction and public changelog link payloads.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildExtensionReleasePayload,
  extractExtensionChangelogSection,
} from "./announce-extension-release.mjs";

describe("extractExtensionChangelogSection", () => {
  it("returns the matching version body without the release heading", () => {
    const changelog = `# @playhtml/extension

## 0.1.19 (2026-06-17)

- Added public release notes.
- Linked the popup.

## 0.1.18 (2026-06-16)

- Reduced background work.
`;

    assert.equal(
      extractExtensionChangelogSection(changelog, "0.1.19"),
      "- Added public release notes.\n- Linked the popup.",
    );
  });
});

describe("buildExtensionReleasePayload", () => {
  it("includes the version, release notes, and public changelog link", () => {
    const payload = buildExtensionReleasePayload({
      version: "0.1.19",
      body: "- Added public release notes.\n![Demo](/changelog/media/demo.png)",
      changelogUrl: "https://wewere.online/changelog/",
      releaseUrl:
        "https://github.com/spencerc99/playhtml/releases/tag/%40playhtml%2Fextension%400.1.19",
    });

    assert.equal(
      payload.content,
      "**we were online extension release** — `0.1.19`",
    );
    assert.equal(payload.allowed_mentions.parse.length, 0);
    assert.equal(payload.embeds[0].title, "@playhtml/extension@0.1.19");
    assert.equal(
      payload.embeds[0].description,
      "- Added public release notes.\n![Demo](https://wewere.online/changelog/media/demo.png)",
    );
    assert.equal(
      payload.embeds[0].fields[0].value,
      "[wewere.online/changelog](https://wewere.online/changelog/)",
    );
  });
});

describe("extension release workflow", () => {
  it("creates the GitHub release before announcing it", () => {
    const workflowPath = fileURLToPath(
      new URL("../workflows/extension-release.yml", import.meta.url),
    );
    const workflow = readFileSync(workflowPath, "utf8");
    const releaseStepIndex = workflow.indexOf("- name: Create GitHub release");
    const releaseCommandIndex = workflow.indexOf("gh release create");
    const announceStepIndex = workflow.indexOf("- name: Announce release on Discord");

    assert.notEqual(releaseStepIndex, -1);
    assert.notEqual(releaseCommandIndex, -1);
    assert.notEqual(announceStepIndex, -1);
    assert.ok(releaseStepIndex < announceStepIndex);
    assert.ok(releaseCommandIndex < announceStepIndex);
  });

  it("uses the extension release Discord webhook", () => {
    const workflowPath = fileURLToPath(
      new URL("../workflows/extension-release.yml", import.meta.url),
    );
    const workflow = readFileSync(workflowPath, "utf8");
    const announceStepIndex = workflow.indexOf("- name: Announce release on Discord");
    const nextStepIndex = workflow.indexOf("\n      - name:", announceStepIndex + 1);
    const announceStep = workflow.slice(announceStepIndex, nextStepIndex);

    assert.notEqual(announceStepIndex, -1);
    assert.match(announceStep, /secrets\.DISCORD_EXTENSION_RELEASE_WEBHOOK/);
    assert.doesNotMatch(announceStep, /secrets\.DISCORD_RELEASE_WEBHOOK/);
  });
});
