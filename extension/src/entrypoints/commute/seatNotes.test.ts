// ABOUTME: Covers under-seat note ordering, render caps, and text normalization.
// ABOUTME: Keeps a crowded seat legible and the shared document bounded.

import { describe, expect, it } from "vitest";
import {
  SEAT_NOTE_MAX_LENGTH,
  getNoteAgeLabel,
  getOverflowNoteIds,
  getSeatNotes,
  normalizeSeatNoteText,
  type SeatNote,
  type SeatNoteStack,
} from "./seatNotes";

const NOW = 1_700_000_000_000;

function note(id: string, ageMs: number): SeatNote {
  return { id, color: "#c4724e", text: id, leftAt: NOW - ageMs };
}

function stack(...notes: SeatNote[]): SeatNoteStack {
  return Object.fromEntries(notes.map((entry) => [entry.id, entry]));
}

describe("getSeatNotes", () => {
  it("returns nothing for a seat nobody has used", () => {
    expect(getSeatNotes(undefined)).toEqual([]);
  });

  it("returns the most recent notes first", () => {
    const notes = getSeatNotes(
      stack(note("old", 90_000), note("new", 100), note("mid", 5_000)),
    );
    expect(notes.map((entry) => entry.id)).toEqual(["new", "mid", "old"]);
  });

  it("caps how many notes a crowded seat renders", () => {
    const notes = Array.from({ length: 40 }, (_, index) =>
      note(`n${index}`, index * 1_000),
    );
    expect(getSeatNotes(stack(...notes), 20)).toHaveLength(20);
  });
});

describe("getOverflowNoteIds", () => {
  it("keeps everything under the limit", () => {
    expect(getOverflowNoteIds(stack(note("a", 0)), 5)).toEqual([]);
  });

  it("sheds the oldest notes past the limit", () => {
    const notes = Array.from({ length: 5 }, (_, index) =>
      note(`n${index}`, index * 1_000),
    );
    expect(getOverflowNoteIds(stack(...notes), 3)).toEqual(["n4", "n3"]);
  });
});

describe("normalizeSeatNoteText", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeSeatNoteText("  hey\n\n  there  ")).toBe("hey there");
  });

  it("truncates a very long note", () => {
    expect(normalizeSeatNoteText("x".repeat(400))).toHaveLength(
      SEAT_NOTE_MAX_LENGTH,
    );
  });
});

describe("getNoteAgeLabel", () => {
  it("describes fresh, hourly, and daily notes", () => {
    expect(getNoteAgeLabel(NOW, NOW)).toBe("just now");
    expect(getNoteAgeLabel(NOW - 5 * 60_000, NOW)).toBe("5m ago");
    expect(getNoteAgeLabel(NOW - 3 * 3_600_000, NOW)).toBe("3h ago");
    expect(getNoteAgeLabel(NOW - 4 * 86_400_000, NOW)).toBe("4d ago");
  });
});
