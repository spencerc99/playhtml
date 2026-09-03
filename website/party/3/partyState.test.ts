// ABOUTME: Tests party state rules independently of the rendered pages.
// ABOUTME: Covers cake erosion, deterministic drift, timezone labels, and balloon geometry.

import { describe, expect, it } from "vitest";
import {
  BITE_REQUIREMENT,
  canBiteCakeCell,
  canPanPartyRoomWithPointer,
  createBalloonCreation,
  getBalloonKnots,
  getInflatedBalloonScale,
  getCakeBitePosition,
  getDogSegments,
  getDriftPosition,
  getFlowerSegments,
  getPlaceFromTimezone,
  shouldShowArrivalNametag,
  type CakeData,
} from "./partyState";

function finishedCell(index: number): CakeData["cellsByIndex"] {
  return {
    [index]: {
      bitesByParticipant: Object.fromEntries(
        Array.from({ length: BITE_REQUIREMENT }, (_, biteIndex) => [
          `person-${biteIndex}`,
          {
            pid: `person-${biteIndex}`,
            name: `person ${biteIndex}`,
            color: "#000",
            slot: biteIndex,
            x: "10%",
            y: "10%",
          },
        ]),
      ),
    },
  };
}

describe("cake erosion", () => {
  it("allows perimeter cells and blocks untouched interior cells", () => {
    expect(canBiteCakeCell({}, 0)).toBe(true);
    expect(canBiteCakeCell({}, 9)).toBe(true);
    expect(canBiteCakeCell({}, 50)).toBe(true);
    expect(canBiteCakeCell({}, 59)).toBe(true);
    expect(canBiteCakeCell({}, 22)).toBe(false);
  });

  it("opens an interior cell next to a finished square", () => {
    expect(canBiteCakeCell(finishedCell(21), 22)).toBe(true);
  });

  it("places the closest free bite slot on the exposed edge", () => {
    expect(getCakeBitePosition({}, 0, 0.5)).toEqual({
      slot: 1,
      x: "8%",
      y: "50%",
    });
  });
});

describe("party labels and drift", () => {
  it("shows the arrival nametag again when no name was saved", () => {
    expect(
      shouldShowArrivalNametag({
        hasArrivedBefore: true,
        name: undefined,
        skipEntry: false,
      }),
    ).toBe(true);
    expect(
      shouldShowArrivalNametag({
        hasArrivedBefore: true,
        name: "  ",
        skipEntry: false,
      }),
    ).toBe(true);
  });

  it("keeps the review shortcut and a completed nametag out of the way", () => {
    expect(
      shouldShowArrivalNametag({
        hasArrivedBefore: false,
        name: undefined,
        skipEntry: true,
      }),
    ).toBe(false);
    expect(
      shouldShowArrivalNametag({
        hasArrivedBefore: true,
        name: "Spencer",
        skipEntry: false,
      }),
    ).toBe(false);
  });

  it("reserves drag panning for touch input", () => {
    expect(canPanPartyRoomWithPointer("touch")).toBe(true);
    expect(canPanPartyRoomWithPointer("mouse")).toBe(false);
    expect(canPanPartyRoomWithPointer("pen")).toBe(false);
  });

  it("turns a timezone into the specified place label", () => {
    expect(getPlaceFromTimezone("America/Los_Angeles")).toBe("los angeles");
    expect(getPlaceFromTimezone("UTC")).toBe("utc");
  });

  it("returns the same drift position for the same saved inputs", () => {
    const args = [
      17,
      1_000,
      9_000,
      300,
      240,
      { width: 1_200, height: 900 },
    ] as const;
    expect(getDriftPosition(...args)).toEqual(getDriftPosition(...args));
  });
});

describe("balloon workshop geometry", () => {
  it("inflates at a steady rate while held still", () => {
    expect(getInflatedBalloonScale(0.6, 500)).toBeCloseTo(0.76);
    expect(getInflatedBalloonScale(0.6, 1_000)).toBeCloseTo(0.92);
    expect(getInflatedBalloonScale(1.7, 1_000)).toBe(1.8);
  });

  it("finds a knot between nearby segments", () => {
    const [segment] = getDogSegments();
    const segments = [segment, { ...segment, id: "nearby", x: segment.x + 10 }];
    expect(getBalloonKnots(segments)).toHaveLength(1);
  });

  it("keeps the worked examples", () => {
    expect(getFlowerSegments()).toHaveLength(9);
    expect(getDogSegments()).toHaveLength(6);
  });

  it("normalizes a released creation into its own bounds", () => {
    const creation = createBalloonCreation(
      getDogSegments(),
      { pid: "p1", name: "spencer", color: "#274b9e" },
      "dog",
      { x: 80, y: 250 },
      1_000,
      "creation-1",
      12,
    );
    expect(creation.parts.every((part) => part.x > 0 && part.y > 0)).toBe(true);
    expect(creation.width).toBeGreaterThan(0);
    expect(creation.height).toBeGreaterThan(0);
  });
});
