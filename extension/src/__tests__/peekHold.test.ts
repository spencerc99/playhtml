// ABOUTME: Tests the held key that shows where each collage piece came from.
// ABOUTME: Drives the hold as pure logic, so nothing can strand the tags on screen.

import { describe, expect, it } from "vitest";
import {
  PEEK_KEY,
  createPeekState,
  stepPeek,
  type PeekEvent,
  type PeekState,
} from "../entrypoints/scraps/peekHold";
import {
  RESERVED_ACCELERATORS,
  studioCommandFor,
} from "../entrypoints/scraps/studioKeymap";

const down = (over: Partial<Extract<PeekEvent, { kind: "keyDown" }>> = {}) =>
  ({
    kind: "keyDown",
    key: PEEK_KEY,
    repeat: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    typing: false,
    modeActive: false,
    ...over,
  }) satisfies PeekEvent;

function run(events: PeekEvent[]): PeekState {
  return events.reduce(stepPeek, createPeekState());
}

describe("holding the peek key", () => {
  it("shows the tags while the key is down", () => {
    expect(run([down()]).held).toBe(true);
  });

  it("puts them away on release", () => {
    expect(run([down(), { kind: "keyUp", key: PEEK_KEY }]).held).toBe(false);
  });

  it("ignores the auto-repeat of a key already down", () => {
    const held = run([down()]);
    const repeated = stepPeek(held, down({ repeat: true }));
    // Nothing changes, so the tags never flicker under a held key.
    expect(repeated).toBe(held);
  });

  it("leaves another key alone", () => {
    expect(run([down({ key: "r" })]).held).toBe(false);
    const held = run([down()]);
    expect(stepPeek(held, { kind: "keyUp", key: "r" }).held).toBe(true);
  });
});

describe("when the peek cannot apply", () => {
  it("is inert while typing", () => {
    expect(run([down({ typing: true })]).held).toBe(false);
  });

  it("is inert during a crop or a modal transform", () => {
    expect(run([down({ modeActive: true })]).held).toBe(false);
  });

  it("leaves accelerators to whoever owns them", () => {
    expect(run([down({ metaKey: true })]).held).toBe(false);
    expect(run([down({ ctrlKey: true })]).held).toBe(false);
    expect(run([down({ altKey: true })]).held).toBe(false);
  });
});

describe("a hold that could otherwise stick", () => {
  it("ends when the window loses focus", () => {
    expect(run([down(), { kind: "windowBlur" }]).held).toBe(false);
  });

  it("ends when the page goes away", () => {
    expect(run([down(), { kind: "pageHidden" }]).held).toBe(false);
  });

  it("stays down when nothing was held", () => {
    const idle = createPeekState();
    expect(stepPeek(idle, { kind: "windowBlur" })).toBe(idle);
  });
});

describe("the peek key alongside the rest of the studio", () => {
  it("is not an accelerator a browser keeps for itself", () => {
    expect(RESERVED_ACCELERATORS).not.toContain(PEEK_KEY);
    expect(RESERVED_ACCELERATORS).not.toContain(`accel+${PEEK_KEY}`);
  });

  it("invokes no command, so the hold is the only thing it does", () => {
    for (const hasSelection of [true, false]) {
      expect(
        studioCommandFor(
          {
            key: PEEK_KEY,
            metaKey: false,
            ctrlKey: false,
            shiftKey: false,
            altKey: false,
          },
          { mode: "idle", hasSelection, hasClipboard: false },
        ),
      ).toBeNull();
    }
  });
});
