// ABOUTME: Tests undo and redo over a collage arrangement.
// ABOUTME: Guards that a continuous run coalesces and history stays bounded.

import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  createHistory,
  endRun,
  recordArrangement,
  redo,
  undo,
} from "../entrypoints/scraps/arrangementHistory";
import type { CollagePiece } from "../entrypoints/scraps/collageRecord";

function arrangement(label: string): readonly CollagePiece[] {
  return [{ id: label } as unknown as CollagePiece];
}

describe("createHistory", () => {
  it("starts with nothing to undo or redo", () => {
    const history = createHistory(arrangement("a"));
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
  });
});

describe("recordArrangement", () => {
  it("adds a step per separate edit", () => {
    let history = createHistory(arrangement("a"));
    history = recordArrangement(history, arrangement("b"));
    history = recordArrangement(history, arrangement("c"));
    expect(history.past).toHaveLength(2);
  });

  it("ignores a record that did not change anything", () => {
    const start = arrangement("a");
    const history = recordArrangement(createHistory(start), start);
    expect(history.past).toHaveLength(0);
  });

  it("coalesces a continuous run into one step", () => {
    let history = createHistory(arrangement("start"));
    history = recordArrangement(history, arrangement("drag1"), "drag:piece_1");
    history = recordArrangement(history, arrangement("drag2"), "drag:piece_1");
    history = recordArrangement(history, arrangement("drag3"), "drag:piece_1");
    expect(history.past).toHaveLength(1);
    expect(undo(history).present).toEqual(arrangement("start"));
  });

  it("starts a new step when the run changes", () => {
    let history = createHistory(arrangement("start"));
    history = recordArrangement(history, arrangement("a1"), "drag:piece_1");
    history = recordArrangement(history, arrangement("b1"), "drag:piece_2");
    expect(history.past).toHaveLength(2);
  });

  it("starts a new step after a run is ended", () => {
    let history = createHistory(arrangement("start"));
    history = recordArrangement(history, arrangement("a1"), "drag:piece_1");
    history = endRun(history);
    history = recordArrangement(history, arrangement("a2"), "drag:piece_1");
    expect(history.past).toHaveLength(2);
  });

  it("drops the oldest step past the limit", () => {
    let history = createHistory(arrangement("0"));
    for (let step = 1; step <= HISTORY_LIMIT + 20; step += 1) {
      history = recordArrangement(history, arrangement(String(step)));
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });

  it("clears the redo trail once a new edit is made", () => {
    let history = createHistory(arrangement("a"));
    history = recordArrangement(history, arrangement("b"));
    history = undo(history);
    expect(canRedo(history)).toBe(true);
    history = recordArrangement(history, arrangement("c"));
    expect(canRedo(history)).toBe(false);
  });
});

describe("undo and redo", () => {
  it("walks back and forward through the steps", () => {
    let history = createHistory(arrangement("a"));
    history = recordArrangement(history, arrangement("b"));
    history = recordArrangement(history, arrangement("c"));

    history = undo(history);
    expect(history.present).toEqual(arrangement("b"));
    history = undo(history);
    expect(history.present).toEqual(arrangement("a"));
    expect(canUndo(history)).toBe(false);

    history = redo(history);
    expect(history.present).toEqual(arrangement("b"));
    history = redo(history);
    expect(history.present).toEqual(arrangement("c"));
    expect(canRedo(history)).toBe(false);
  });

  it("restores the very same arrangement object it started from", () => {
    // Identity matters: the studio compares against the last saved arrangement
    // to decide whether leaving would discard work.
    const saved = arrangement("saved");
    let history = createHistory(saved);
    history = recordArrangement(history, arrangement("edited"));
    expect(undo(history).present).toBe(saved);
  });

  it("does nothing at either end", () => {
    const history = createHistory(arrangement("a"));
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it("ends the run so the next edit is its own step", () => {
    let history = createHistory(arrangement("a"));
    history = recordArrangement(history, arrangement("b"), "drag:x");
    history = undo(history);
    expect(history.runLabel).toBeNull();
  });
});
