// ABOUTME: Tests when a shared collage link is made, updated in place, retried and unshared.
// ABOUTME: Drives the link's state machine by events alone, with no timers and no browser.

import { describe, expect, it } from "vitest";
import {
  LINK_SETTLE_MS,
  LINK_UPDATE_GAP_MS,
  checkLink,
  createShareLinkState,
  linkStatus,
  stepShareLink,
  type ShareLinkEvent,
  type ShareLinkState,
} from "../entrypoints/scraps/shareLinkState";

function run(state: ShareLinkState, events: ShareLinkEvent[]): ShareLinkState {
  return events.reduce(stepShareLink, state);
}

const shared = run(createShareLinkState(), [
  { kind: "shareStarted" },
  { kind: "shareSucceeded", at: 1_000, copied: true },
]);

describe("making a link", () => {
  it("is busy while sharing, then copies and goes idle", () => {
    const sharing = stepShareLink(createShareLinkState(), {
      kind: "shareStarted",
    });
    expect(sharing.work).toBe("sharing");
    expect(shared).toMatchObject({
      work: "idle",
      copied: true,
      lastUpdateAt: 1_000,
    });
    expect(linkStatus(shared)).toBe("upToDate");
  });

  it("goes back to idle when sharing fails", () => {
    const state = run(createShareLinkState(), [
      { kind: "shareStarted" },
      { kind: "shareFailed" },
    ]);
    expect(state.work).toBe("idle");
    expect(state.copied).toBe(false);
  });

  it("clears an old copied note when sharing again", () => {
    const state = stepShareLink(
      { ...shared, copied: true },
      { kind: "shareStarted" },
    );
    expect(state.copied).toBe(false);
  });

  it("ignores a second request while one is in flight", () => {
    const sharing = stepShareLink(createShareLinkState(), {
      kind: "shareStarted",
    });
    expect(stepShareLink(sharing, { kind: "unshareStarted" })).toBe(sharing);
    expect(stepShareLink(sharing, { kind: "updateStarted", at: 5 })).toBe(
      sharing,
    );
  });
});

describe("following the collage", () => {
  it("says up to date and schedules nothing while the link matches", () => {
    const { state, updateInMs } = checkLink(shared, {
      key: "a",
      publishedKey: "a",
      now: 2_000,
    });
    expect(state).toBe(shared);
    expect(updateInMs).toBeNull();
  });

  it("is never stale when it should not follow the collage", () => {
    const { state, updateInMs } = checkLink(
      { ...shared, stale: true },
      { key: null, publishedKey: "a", now: 2_000 },
    );
    expect(state.stale).toBe(false);
    expect(updateInMs).toBeNull();
  });

  it("waits for the collage to settle before updating", () => {
    const { state, updateInMs } = checkLink(shared, {
      key: "b",
      publishedKey: "a",
      now: 100_000,
    });
    expect(state.stale).toBe(true);
    expect(linkStatus(state)).toBe("pending");
    expect(updateInMs).toBe(LINK_SETTLE_MS);
  });

  it("keeps updates apart to stay inside the server's limit", () => {
    const { updateInMs } = checkLink(shared, {
      key: "b",
      publishedKey: "a",
      now: 1_000 + 1_000,
    });
    expect(updateInMs).toBe(LINK_UPDATE_GAP_MS - 1_000);
  });

  it("does not schedule an update while another request runs", () => {
    const updating = stepShareLink(shared, {
      kind: "updateStarted",
      at: 50_000,
    });
    const { state, updateInMs } = checkLink(updating, {
      key: "b",
      publishedKey: "a",
      now: 60_000,
    });
    expect(updateInMs).toBeNull();
    expect(linkStatus(state)).toBe("updating");
  });

  it("records the update time so the next one waits the gap", () => {
    const state = run(shared, [
      { kind: "updateStarted", at: 50_000 },
      { kind: "updateSucceeded" },
    ]);
    expect(state.lastUpdateAt).toBe(50_000);
    expect(state.work).toBe("idle");
  });
});

describe("a failed update", () => {
  const failed = run(shared, [
    { kind: "checked", key: "b", publishedKey: "a", now: 50_000 },
    { kind: "updateStarted", at: 50_000 },
    { kind: "updateFailed", key: "b" },
  ]);

  it("says so and does not retry the same content", () => {
    expect(linkStatus(failed)).toBe("notUpdated");
    const { updateInMs } = checkLink(failed, {
      key: "b",
      publishedKey: "a",
      now: 90_000,
    });
    expect(updateInMs).toBeNull();
  });

  it("clears on the next edit, then retries on the following check", () => {
    const edited = stepShareLink(failed, {
      kind: "checked",
      key: "c",
      publishedKey: "a",
      now: 90_000,
    });
    expect(edited.failedKey).toBeNull();
    expect(linkStatus(edited)).toBe("pending");
    const { updateInMs } = checkLink(edited, {
      key: "c",
      publishedKey: "a",
      now: 90_000,
    });
    expect(updateInMs).toBe(LINK_SETTLE_MS);
  });

  it("is cleared by a later successful update", () => {
    const state = run(failed, [
      { kind: "checked", key: "c", publishedKey: "a", now: 90_000 },
      { kind: "updateStarted", at: 94_000 },
      { kind: "updateSucceeded" },
      { kind: "checked", key: "c", publishedKey: "c", now: 95_000 },
    ]);
    expect(state.failedKey).toBeNull();
    expect(linkStatus(state)).toBe("upToDate");
  });

  it("retries after settling when it failed before the content was known", () => {
    const state = run(shared, [
      { kind: "updateStarted", at: 50_000 },
      { kind: "updateFailed", key: null },
    ]);
    const { updateInMs } = checkLink(state, {
      key: "b",
      publishedKey: "a",
      now: 90_000,
    });
    expect(updateInMs).toBe(LINK_SETTLE_MS);
  });
});

describe("unsharing", () => {
  it("is busy until it finishes, whether it worked or not", () => {
    const unsharing = stepShareLink(shared, { kind: "unshareStarted" });
    expect(unsharing.work).toBe("unsharing");
    expect(stepShareLink(unsharing, { kind: "unshareFinished" }).work).toBe(
      "idle",
    );
  });

  it("ignores a stray finish from another request", () => {
    const updating = stepShareLink(shared, { kind: "updateStarted", at: 5 });
    expect(stepShareLink(updating, { kind: "unshareFinished" })).toBe(updating);
  });
});

describe("copying", () => {
  it("shows the copied note only when the copy worked", () => {
    expect(
      stepShareLink(createShareLinkState(), { kind: "copied", ok: true })
        .copied,
    ).toBe(true);
    expect(stepShareLink(shared, { kind: "copied", ok: false }).copied).toBe(
      false,
    );
  });
});
