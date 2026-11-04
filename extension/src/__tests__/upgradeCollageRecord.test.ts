// ABOUTME: Tests recovering collages saved before formats, paper, flips and grain.
// ABOUTME: Each fixture is the exact shape a past version of the studio stored.

import { describe, expect, it } from "vitest";
import {
  isEarlierCollageShape,
  isUngrainedCollageShape,
  upgradeEarlierCollage,
  upgradeUngrainedCollage,
} from "../entrypoints/scraps/upgradeCollageRecord";

/**
 * A collage exactly as the first version of the studio saved it: a 1200x800
 * frame, pieces with no flips, and no format or paper on the record. It
 * carries one of every scrap kind, including a cropped and rotated piece and
 * one with a cutout.
 */
function earlierCollage(): Record<string, unknown> {
  return {
    id: "collage_earlier",
    title: "the one he cares about",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_900_000,
    frame: { width: 1200, height: 800 },
    pieces: [
      {
        id: "piece_image",
        scrapId: "scrap_image",
        scrap: {
          id: "scrap_image",
          key: "image:one",
          kind: "image",
          src: "https://example.test/one.png",
          naturalWidth: 600,
          naturalHeight: 400,
          pageTitle: "A page",
          domain: "example.test",
          pageUrl: "https://example.test/a",
          ts: 1_000,
        },
        x: 100,
        y: 80,
        width: 240,
        height: 160,
        rotation: 0,
        z: 0,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
      {
        id: "piece_cropped",
        scrapId: "scrap_photo",
        scrap: {
          id: "scrap_photo",
          key: "image:two",
          kind: "image",
          src: "https://example.test/two.png",
          naturalWidth: 800,
          naturalHeight: 600,
          pageTitle: "Another page",
          domain: "other.test",
          pageUrl: "https://other.test/b",
          ts: 2_000,
        },
        x: 500,
        y: 240,
        width: 200,
        height: 100,
        rotation: 37,
        z: 1,
        crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.4 },
        cutout: { method: "edge-color", tolerance: 0.18 },
      },
      {
        id: "piece_button",
        scrapId: "scrap_button",
        scrap: {
          id: "scrap_button",
          key: "button:buy",
          kind: "button",
          text: "Buy",
          styles: { backgroundColor: "rgb(196, 114, 78)" },
          pageTitle: "Shop",
          domain: "shop.test",
          pageUrl: "https://shop.test/c",
          ts: 3_000,
        },
        x: 820,
        y: 600,
        width: 160,
        height: 40,
        rotation: 0,
        z: 2,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
      {
        id: "piece_icon",
        scrapId: "scrap_icon",
        scrap: {
          id: "scrap_icon",
          key: "svg:check",
          kind: "svg-icon",
          markup: '<svg xmlns="http://www.w3.org/2000/svg"><g /></svg>',
          width: 48,
          height: 48,
          pageTitle: "Icons",
          domain: "icons.test",
          pageUrl: "https://icons.test/d",
          ts: 4_000,
        },
        x: 300,
        y: 500,
        width: 96,
        height: 96,
        rotation: 12,
        z: 3,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
      {
        id: "piece_cursor",
        scrapId: "scrap_cursor",
        scrap: {
          id: "scrap_cursor",
          key: "cursor:one",
          kind: "cursor",
          url: "https://example.test/cursor.svg",
          pageTitle: "Cursors",
          domain: "cursor.test",
          pageUrl: "https://cursor.test/e",
          ts: 5_000,
        },
        x: 1000,
        y: 100,
        width: 64,
        height: 64,
        rotation: 0,
        z: 4,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
    ],
    preview: new Blob(["the original thumbnail"], { type: "image/png" }),
  };
}

type UpgradedPiece = Record<string, unknown>;

function upgradedPieces(value: unknown): UpgradedPiece[] {
  return (value as Record<string, unknown>).pieces as UpgradedPiece[];
}

describe("isEarlierCollageShape", () => {
  it("recognizes a collage from before formats and flips", () => {
    expect(isEarlierCollageShape(earlierCollage())).toBe(true);
  });

  it("does not claim a collage already in the current shape", () => {
    const current = {
      ...earlierCollage(),
      frame: { width: 1500, height: 1000 },
      format: "postcard",
      paper: { color: "#faf9f6" },
    };
    expect(isEarlierCollageShape(current)).toBe(false);
  });

  it("does not claim a collage with an unfamiliar frame", () => {
    const odd = { ...earlierCollage(), frame: { width: 999, height: 111 } };
    expect(isEarlierCollageShape(odd)).toBe(false);
  });

  it("does not claim a row that is merely broken", () => {
    expect(isEarlierCollageShape({ id: "x", pieces: "not an array" })).toBe(
      false,
    );
    expect(isEarlierCollageShape(null)).toBe(false);
    expect(isEarlierCollageShape({})).toBe(false);
  });

  it("does not claim a half-upgraded record", () => {
    const half = { ...earlierCollage(), format: "postcard" };
    expect(isEarlierCollageShape(half)).toBe(false);
  });
});

describe("upgradeEarlierCollage", () => {
  const upgraded = upgradeEarlierCollage(earlierCollage()) as Record<
    string,
    unknown
  >;

  it("moves the collage onto the postcard at its true size", () => {
    expect(upgraded.format).toBe("postcard");
    expect(upgraded.frame).toEqual({ width: 1500, height: 1000 });
  });

  it("gives it the paper the bake always filled behind it", () => {
    expect(upgraded.paper).toEqual({ color: "#faf9f6" });
  });

  it("scales every placement by the one factor the shapes share", () => {
    const [first] = upgradedPieces(upgraded);
    expect(first.x).toBe(125);
    expect(first.y).toBe(100);
    expect(first.width).toBe(300);
    expect(first.height).toBe(200);
  });

  it("leaves the arrangement looking identical", () => {
    // A piece's center as a fraction of the frame must not move.
    const before = earlierCollage();
    const beforePieces = before.pieces as UpgradedPiece[];
    const after = upgradedPieces(upgraded);
    const frameBefore = before.frame as { width: number; height: number };
    const frameAfter = upgraded.frame as { width: number; height: number };
    after.forEach((piece, index) => {
      const was = beforePieces[index];
      expect(
        ((piece.x as number) + (piece.width as number) / 2) / frameAfter.width,
      ).toBeCloseTo(
        ((was.x as number) + (was.width as number) / 2) / frameBefore.width,
      );
      expect(
        ((piece.y as number) + (piece.height as number) / 2) /
          frameAfter.height,
      ).toBeCloseTo(
        ((was.y as number) + (was.height as number) / 2) / frameBefore.height,
      );
    });
  });

  it("gives every piece an unflipped state", () => {
    for (const piece of upgradedPieces(upgraded)) {
      expect(piece.flipX).toBe(false);
      expect(piece.flipY).toBe(false);
    }
  });

  it("carries rotation, stacking, crops and cutouts across untouched", () => {
    const cropped = upgradedPieces(upgraded)[1];
    expect(cropped.rotation).toBe(37);
    expect(cropped.z).toBe(1);
    expect(cropped.crop).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 });
    expect(cropped.cutout).toEqual({ method: "edge-color", tolerance: 0.18 });
  });

  it("keeps every scrap kind and its snapshot", () => {
    expect(
      upgradedPieces(upgraded).map(
        (piece) => (piece.scrap as Record<string, unknown>).kind,
      ),
    ).toEqual(["image", "image", "button", "svg-icon", "cursor"]);
  });

  it("keeps the collage's identity, dates and existing thumbnail", () => {
    const before = earlierCollage();
    expect(upgraded.id).toBe(before.id);
    expect(upgraded.title).toBe("the one he cares about");
    expect(upgraded.createdAt).toBe(before.createdAt);
    expect(upgraded.updatedAt).toBe(before.updatedAt);
    expect(upgraded.preview).toBeInstanceOf(Blob);
  });

  it("is idempotent, because the result is no longer the earlier shape", () => {
    const twice = upgradeEarlierCollage(upgraded);
    expect(twice).toBe(upgraded);
  });

  it("hands back anything it does not recognize, unchanged", () => {
    const broken = { id: "x", pieces: "not an array" };
    expect(upgradeEarlierCollage(broken)).toBe(broken);
  });
});

/**
 * A collage exactly as the studio saved it before paper could carry the page's
 * grain: the current shape in every other way, with a paper that names only a
 * tone.
 */
function ungrainedCollage(): Record<string, unknown> {
  return {
    id: "collage_ungrained",
    title: "made before grain",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    frame: { width: 1500, height: 1000 },
    format: "postcard",
    paper: { color: "#c9a678" },
    pieces: [{ id: "piece_1", x: 10, y: 20, width: 30, height: 40 }],
    preview: { drawn: false, reason: "not drawn yet" },
  };
}

describe("a collage saved before paper could be grained", () => {
  it("is recognized by its paper having no word on grain", () => {
    expect(isUngrainedCollageShape(ungrainedCollage())).toBe(true);
  });

  it("says out loud that it has none, so it keeps the look it was made with", () => {
    const upgraded = upgradeUngrainedCollage(ungrainedCollage()) as Record<
      string,
      unknown
    >;
    expect(upgraded.paper).toEqual({ color: "#c9a678", grain: false });
  });

  it("changes nothing else about the collage", () => {
    const before = ungrainedCollage();
    const upgraded = upgradeUngrainedCollage(before) as Record<string, unknown>;
    expect(upgraded.id).toBe(before.id);
    expect(upgraded.title).toBe(before.title);
    expect(upgraded.createdAt).toBe(before.createdAt);
    expect(upgraded.updatedAt).toBe(before.updatedAt);
    expect(upgraded.pieces).toEqual(before.pieces);
    expect(upgraded.format).toBe("postcard");
  });

  it("leaves a collage that already says so alone", () => {
    const grained = {
      ...ungrainedCollage(),
      paper: { color: "#c9a678", grain: true },
    };
    expect(isUngrainedCollageShape(grained)).toBe(false);
    expect(upgradeUngrainedCollage(grained)).toBe(grained);
  });

  it("is idempotent", () => {
    const once = upgradeUngrainedCollage(ungrainedCollage());
    expect(upgradeUngrainedCollage(once)).toBe(once);
  });

  it("hands back anything it does not recognize, unchanged", () => {
    const broken = { id: "x", pieces: "not an array" };
    expect(upgradeUngrainedCollage(broken)).toBe(broken);
  });
});
