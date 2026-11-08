// ABOUTME: Tests the collage studio's single editing session: crop, cutout, rotate, scale or back.
// ABOUTME: Only one can run at a time, and a late update from an ended session changes nothing.

import { describe, expect, it } from "vitest";
import {
  BACK_SESSION,
  cropOf,
  cutoutOf,
  endSession,
  IDLE_SESSION,
  studioModeOf,
  transformOf,
  turnedOver,
  updateSession,
  type ModalTransform,
  type StudioSession,
} from "../entrypoints/scraps/studioSession";

const FULL = { x: 0, y: 0, width: 1, height: 1 };
const CROP: StudioSession = {
  kind: "crop",
  crop: { pieceId: "a", crop: FULL, before: FULL },
};
const CUTOUT: StudioSession = {
  kind: "cutout",
  cutout: { pieceId: "a", before: undefined },
};
const ROTATE: ModalTransform = {
  kind: "rotate",
  before: [],
  center: { x: 0, y: 0 },
  anchor: { x: 1, y: 0 },
  readout: "0 deg",
};

describe("the studio session", () => {
  it("names the mode the keys read", () => {
    expect(studioModeOf(IDLE_SESSION)).toBe("idle");
    expect(studioModeOf(BACK_SESSION)).toBe("back");
    expect(studioModeOf(CROP)).toBe("crop");
    expect(studioModeOf(CUTOUT)).toBe("cutout");
    expect(studioModeOf({ kind: "transform", transform: ROTATE })).toBe(
      "rotate",
    );
    expect(
      studioModeOf({
        kind: "transform",
        transform: { ...ROTATE, kind: "scale" },
      }),
    ).toBe("scale");
  });

  it("exposes only the running session's own state", () => {
    expect(cropOf(CROP)).not.toBeNull();
    expect(cutoutOf(CROP)).toBeNull();
    expect(transformOf(CROP)).toBeNull();
    expect(cutoutOf(CUTOUT)?.pieceId).toBe("a");
    expect(cropOf(BACK_SESSION)).toBeNull();
  });

  it("leaves no cutout open once the collage is turned over mid-cutout", () => {
    const over = turnedOver(CUTOUT);
    expect(studioModeOf(over)).toBe("back");
    expect(cutoutOf(over)).toBeNull();
  });

  it("comes face up idle, with no session waiting behind the back", () => {
    for (const before of [CROP, CUTOUT, IDLE_SESSION]) {
      expect(turnedOver(turnedOver(before))).toEqual(IDLE_SESSION);
    }
  });

  it("ends a session only if it is still the one running", () => {
    expect(endSession(CROP, "crop")).toEqual(IDLE_SESSION);
    expect(endSession(BACK_SESSION, "crop")).toBe(BACK_SESSION);
    expect(endSession(CUTOUT, "transform")).toBe(CUTOUT);
  });

  it("ignores a late update from a session that has ended", () => {
    const moved: StudioSession = {
      kind: "crop",
      crop: {
        pieceId: "a",
        crop: { ...FULL, x: 0.5, width: 0.5 },
        before: FULL,
      },
    };
    expect(updateSession(CROP, moved)).toBe(moved);
    expect(updateSession(BACK_SESSION, moved)).toBe(BACK_SESSION);
    expect(
      updateSession(CUTOUT, { kind: "transform", transform: ROTATE }),
    ).toBe(CUTOUT);
  });
});
