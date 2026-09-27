// ABOUTME: Tests which single floating panel the collage studio shows at a time.
// ABOUTME: A running tool must never be covered by the piece strip or the stack menu.

import { describe, expect, it } from "vitest";
import {
  PANEL_GAP,
  ROTATE_HANDLE_REACH,
  placeBesidePiece,
  toolSessionActive,
  visiblePanel,
  type PanelState,
} from "../entrypoints/scraps/studioPanels";

const RESTING: PanelState = {
  turnedOver: false,
  cropping: false,
  transforming: false,
  cuttingOut: false,
  piecesHereOpen: false,
  gestureRunning: false,
  peekHeld: false,
  hasSelection: true,
};

describe("which panel is showing", () => {
  it("shows the piece strip for a selection at rest", () => {
    expect(visiblePanel(RESTING)).toBe("pieceActions");
  });

  it("shows nothing with nothing selected", () => {
    expect(visiblePanel({ ...RESTING, hasSelection: false })).toBe("none");
  });

  it("gives the cutout's edge control the space over the strip", () => {
    expect(visiblePanel({ ...RESTING, cuttingOut: true })).toBe("cutout");
  });

  it("keeps the edge control up over a stack menu", () => {
    expect(
      visiblePanel({ ...RESTING, cuttingOut: true, piecesHereOpen: true }),
    ).toBe("cutout");
  });

  it("gives a crop the space over everything else", () => {
    expect(
      visiblePanel({
        ...RESTING,
        cropping: true,
        cuttingOut: true,
        piecesHereOpen: true,
      }),
    ).toBe("crop");
  });

  it("shows the stack menu instead of the strip once it is asked for", () => {
    expect(visiblePanel({ ...RESTING, piecesHereOpen: true })).toBe(
      "piecesHere",
    );
  });

  it("puts the strip away while a piece is moving or the tags are up", () => {
    expect(visiblePanel({ ...RESTING, gestureRunning: true })).toBe("none");
    expect(visiblePanel({ ...RESTING, peekHeld: true })).toBe("none");
  });

  it("shows nothing over a modal transform", () => {
    expect(visiblePanel({ ...RESTING, transforming: true })).toBe("none");
  });

  it("shows nothing on the back of the collage", () => {
    expect(
      visiblePanel({ ...RESTING, turnedOver: true, cuttingOut: true }),
    ).toBe("none");
  });

  it("returns the strip when the tool is done", () => {
    const during = { ...RESTING, cuttingOut: true };
    expect(visiblePanel(during)).toBe("cutout");
    expect(visiblePanel({ ...during, cuttingOut: false })).toBe("pieceActions");
  });
});

describe("whether a tool holds the collage", () => {
  it("counts a crop, a transform and a cutout", () => {
    expect(toolSessionActive({ ...RESTING, cropping: true })).toBe(true);
    expect(toolSessionActive({ ...RESTING, transforming: true })).toBe(true);
    expect(toolSessionActive({ ...RESTING, cuttingOut: true })).toBe(true);
  });

  it("does not count a menu, a drag or a plain selection", () => {
    expect(toolSessionActive({ ...RESTING, piecesHereOpen: true })).toBe(false);
    expect(toolSessionActive({ ...RESTING, gestureRunning: true })).toBe(false);
    expect(toolSessionActive(RESTING)).toBe(false);
  });
});

describe("placing a panel beside a piece", () => {
  const frame = { width: 1000, height: 800 };
  const panel = { width: 200, height: 30 };

  it("sits centered above the piece, clear of the rotate knob", () => {
    const piece = { x: 400, y: 300, width: 200, height: 100 };
    const placed = placeBesidePiece(piece, panel, 1, frame);
    expect(placed).toEqual({
      left: 400,
      top: 300 - ROTATE_HANDLE_REACH - PANEL_GAP - 30,
    });
    // The panel's bottom edge stays above the knob's top.
    expect(placed.top + 30).toBeLessThan(300 - ROTATE_HANDLE_REACH);
  });

  it("drops below the piece when there is no room above", () => {
    const piece = { x: 400, y: 10, width: 200, height: 100 };
    expect(placeBesidePiece(piece, panel, 1, frame).top).toBe(
      10 + 100 + PANEL_GAP,
    );
  });

  it("stays inside the frame at the edges", () => {
    const piece = { x: -50, y: 300, width: 100, height: 100 };
    expect(placeBesidePiece(piece, panel, 1, frame).left).toBe(0);
    const right = { x: 950, y: 300, width: 100, height: 100 };
    expect(placeBesidePiece(right, panel, 1, frame).left).toBe(800);
  });

  it("converts its on-screen size through the zoom", () => {
    const piece = { x: 400, y: 300, width: 200, height: 100 };
    // At half zoom the panel covers twice as many frame units.
    expect(placeBesidePiece(piece, panel, 0.5, frame)).toEqual({
      left: 300,
      top: 300 - ROTATE_HANDLE_REACH - PANEL_GAP * 2 - 60,
    });
  });
});
