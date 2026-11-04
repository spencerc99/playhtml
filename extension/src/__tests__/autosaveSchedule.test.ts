// ABOUTME: Tests when a collage's arrangement is written and when it is re-baked.
// ABOUTME: Drives the schedule by events alone, with no timers and no browser.

import { describe, expect, it } from "vitest";
import {
  createAutosaveState,
  hasUnwrittenWork,
  stepAutosave,
  type AutosaveEvent,
  type AutosaveState,
} from "../entrypoints/scraps/autosaveSchedule";

/** Runs a run of events, returning the state and every action along the way. */
function run(
  state: AutosaveState,
  events: AutosaveEvent[],
): { state: AutosaveState; actions: ReturnType<typeof stepAutosave>["action"][] } {
  const actions: ReturnType<typeof stepAutosave>["action"][] = [];
  let current = state;
  for (const event of events) {
    const next = stepAutosave(current, event);
    current = next.state;
    actions.push(next.action);
  }
  return { state: current, actions };
}

const changed: AutosaveEvent = { kind: "changed", hasContent: true };

describe("an untouched new collage", () => {
  it("writes nothing while it has no content", () => {
    const start = createAutosaveState(false);
    const { state, actions } = run(start, [
      { kind: "changed", hasContent: false },
      { kind: "flush" },
    ]);
    expect(actions[0]).toEqual({});
    expect(actions[1].write).toBeUndefined();
    expect(state.standing).toEqual({ kind: "untouched" });
    expect(hasUnwrittenWork(state)).toBe(false);
  });

  it("starts saving once it has something in it", () => {
    const { actions } = run(createAutosaveState(false), [changed]);
    expect(actions[0].scheduleSettle).toBe(true);
  });
});

describe("settling", () => {
  it("writes the arrangement once the change settles", () => {
    const { state, actions } = run(createAutosaveState(false), [
      changed,
      { kind: "arrangementSettled" },
    ]);
    expect(actions[1].write).toEqual({ revision: 1, needsPreview: true });
    expect(state.writing).toBe(true);
    expect(state.standing).toEqual({ kind: "saving" });
  });

  it("treats a burst of changes as one write", () => {
    const { actions } = run(createAutosaveState(false), [
      changed,
      changed,
      changed,
      { kind: "arrangementSettled" },
    ]);
    const writes = actions.filter((action) => action.write);
    expect(writes).toHaveLength(1);
    expect(writes[0].write).toEqual({ revision: 3, needsPreview: true });
  });

  it("needs no preview once the collage has been stored before", () => {
    const { actions } = run(createAutosaveState(true), [
      changed,
      { kind: "arrangementSettled" },
    ]);
    expect(actions[1].write).toEqual({ revision: 1, needsPreview: false });
  });

  it("does nothing on a flush with nothing pending", () => {
    const { state, actions } = run(createAutosaveState(true), [
      { kind: "flush" },
    ]);
    expect(actions[0].write).toBeUndefined();
    expect(state.revision).toBe(0);
    expect(state.standing).toEqual({ kind: "saved" });
  });

  it("writes immediately on a flush before the settle fires", () => {
    const { actions } = run(createAutosaveState(true), [
      changed,
      { kind: "flush" },
    ]);
    expect(actions[1].write).toEqual({ revision: 1, needsPreview: false });
  });
});

describe("after the arrangement is written", () => {
  it("bakes the preview once the arrangement has caught up", () => {
    const { state, actions } = run(createAutosaveState(true), [
      changed,
      { kind: "arrangementSettled" },
      { kind: "writeSucceeded", revision: 1 },
    ]);
    expect(actions[2].bake).toEqual({ token: 1 });
    expect(state.writing).toBe(false);
    expect(state.storedRevision).toBe(1);
  });

  it("settles again when more changes arrived during the write", () => {
    const { actions } = run(createAutosaveState(true), [
      changed,
      { kind: "arrangementSettled" },
      changed,
      { kind: "writeSucceeded", revision: 1 },
    ]);
    expect(actions[3].bake).toBeUndefined();
    expect(actions[3].scheduleSettle).toBe(true);
  });

  it("reports saved once the bake lands", () => {
    const { state } = run(createAutosaveState(true), [
      changed,
      { kind: "arrangementSettled" },
      { kind: "writeSucceeded", revision: 1 },
      { kind: "bakeSucceeded", token: 1 },
    ]);
    expect(state.standing).toEqual({ kind: "saved" });
    expect(state.previewStale).toBe(false);
    expect(hasUnwrittenWork(state)).toBe(false);
  });
});

describe("a bake that is overtaken", () => {
  it("discards a result for an arrangement that has moved on", () => {
    const { state } = run(createAutosaveState(true), [
      changed,
      { kind: "arrangementSettled" },
      { kind: "writeSucceeded", revision: 1 },
      changed,
      // The older bake finishes after the newer change.
      { kind: "bakeSucceeded", token: 1 },
    ]);
    expect(state.previewStale).toBe(true);
    expect(state.standing).not.toEqual({ kind: "saved" });
  });

  it("discards a failure for a superseded bake too", () => {
    const { state } = run(createAutosaveState(true), [
      changed,
      { kind: "arrangementSettled" },
      { kind: "writeSucceeded", revision: 1 },
      changed,
      { kind: "bakeFailed", token: 1, reason: "a picture would not load" },
    ]);
    expect(state.previewProblem).toBeNull();
  });
});

describe("when a bake fails", () => {
  const failed = run(createAutosaveState(true), [
    changed,
    { kind: "arrangementSettled" },
    { kind: "writeSucceeded", revision: 1 },
    { kind: "bakeFailed", token: 1, reason: "these could not be drawn: a photo" },
  ]).state;

  it("keeps the arrangement saved and says the preview is behind", () => {
    expect(failed.storedRevision).toBe(1);
    expect(failed.standing).toEqual({
      kind: "previewBehind",
      reason: "these could not be drawn: a photo",
    });
  });

  it("is not unwritten work, because the arrangement did land", () => {
    expect(hasUnwrittenWork(failed)).toBe(false);
  });

  it("retries on the next settle", () => {
    const { actions } = run(failed, [
      changed,
      { kind: "arrangementSettled" },
      { kind: "writeSucceeded", revision: 2 },
    ]);
    expect(actions[2].bake).toEqual({ token: 2 });
  });
});

describe("when the write itself fails", () => {
  const broken = run(createAutosaveState(true), [
    changed,
    { kind: "arrangementSettled" },
    { kind: "writeFailed", reason: "the collage drawer would not open" },
  ]).state;

  it("says so loudly", () => {
    expect(broken.standing).toEqual({
      kind: "failed",
      reason: "the collage drawer would not open",
    });
  });

  it("counts as work that leaving would lose", () => {
    expect(hasUnwrittenWork(broken)).toBe(true);
  });
});

describe("unwritten work", () => {
  it("counts a change that has not settled", () => {
    const { state } = run(createAutosaveState(true), [changed]);
    expect(hasUnwrittenWork(state)).toBe(true);
  });

  it("counts a write still in flight", () => {
    const { state } = run(createAutosaveState(true), [
      changed,
      { kind: "arrangementSettled" },
    ]);
    expect(hasUnwrittenWork(state)).toBe(true);
  });

  it("does not count a collage that has never had content", () => {
    expect(hasUnwrittenWork(createAutosaveState(false))).toBe(false);
  });
});
