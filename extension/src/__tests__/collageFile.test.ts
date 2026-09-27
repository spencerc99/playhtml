// ABOUTME: Tests writing a collage to a file and reading it back as a separate collage.
// ABOUTME: Covers the envelope round trip, every way a file is refused, and import identity.

import { describe, expect, it } from "vitest";
import { Blob as NodeBlob } from "node:buffer";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import {
  CollageFileError,
  collageFileName,
  encodeCollageFile,
  importCollageFile,
  readCollageFile,
} from "../entrypoints/scraps/collageFile";
import type {
  CollagePiece,
  CollageRecord,
} from "../entrypoints/scraps/collageRecord";

/** Every byte value, so an encoding that mangles any of them is caught. */
const PREVIEW_BYTES = Uint8Array.from({ length: 512 }, (_, at) => at % 256);

function scrap(): ScrapItem {
  return {
    id: "scrap_1",
    key: "image:one",
    kind: "image",
    src: "https://example.test/one.png",
    naturalWidth: 100,
    naturalHeight: 80,
    pageTitle: "A page",
    domain: "example.test",
    pageUrl: "https://example.test/a",
    ts: 1_000,
  } as ScrapItem;
}

function piece(overrides: Partial<CollagePiece> = {}): CollagePiece {
  return {
    id: "piece_1",
    scrapId: "scrap_1",
    scrap: scrap(),
    x: 10,
    y: 20,
    width: 100,
    height: 80,
    rotation: 12,
    z: 0,
    crop: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    flipX: true,
    flipY: false,
    ...overrides,
  };
}

function record(overrides: Partial<CollageRecord> = {}): CollageRecord {
  return {
    id: "collage_1",
    title: "a collage",
    createdAt: 5_000,
    updatedAt: 6_000,
    frame: { width: 1500, height: 1000 },
    format: "postcard",
    paper: { color: "#fffdf9", grain: true },
    pieces: [piece(), piece({ id: "piece_2", x: 300, z: 1 })],
    preview: {
      drawn: true,
      image: new NodeBlob([PREVIEW_BYTES], {
        type: "image/png",
      }) as unknown as Blob,
    },
    ...overrides,
  };
}

/** Reads a Blob's bytes through FileReader, which jsdom's Blob supports. */
function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function envelopeFor(
  collage: CollageRecord = record(),
): Promise<Record<string, unknown>> {
  return JSON.parse(await encodeCollageFile(collage, 9_000)) as Record<
    string,
    unknown
  >;
}

function expectRefusal(text: string, reason: RegExp): void {
  let caught: unknown;
  try {
    readCollageFile(text);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CollageFileError);
  expect((caught as Error).message).toMatch(reason);
}

describe("encodeCollageFile", () => {
  it("wraps the collage in a versioned envelope", async () => {
    const envelope = await envelopeFor();
    expect(envelope.format).toBe("wwo-collage");
    expect(envelope.version).toBe(1);
    expect(envelope.exportedAt).toBe(9_000);
    const collage = envelope.collage as Record<string, unknown>;
    expect(collage.preview).toEqual({
      drawn: true,
      image: {
        mediaType: "image/png",
        base64: Buffer.from(PREVIEW_BYTES).toString("base64"),
      },
    });
  });

  it("names the file after the collage, or as untitled", () => {
    expect(collageFileName("  a walk  ")).toBe("a walk.collage.json");
    expect(collageFileName("   ")).toBe("untitled collage.collage.json");
  });
});

describe("readCollageFile", () => {
  it("round-trips the collage with its preview bytes and media type", async () => {
    const original = record();
    const read = readCollageFile(await encodeCollageFile(original));
    const { preview: readPreview, ...readRest } = read;
    const { preview: originalPreview, ...originalRest } = original;
    expect(readRest).toEqual(originalRest);
    expect(readPreview.drawn).toBe(true);
    expect(originalPreview.drawn).toBe(true);
    if (!readPreview.drawn) throw new Error("preview should be drawn");
    expect(readPreview.image.type).toBe("image/png");
    expect(await bytesOf(readPreview.image)).toEqual(PREVIEW_BYTES);
  });

  it("round-trips a collage whose picture never drew", async () => {
    const read = readCollageFile(
      await encodeCollageFile(
        record({ preview: { drawn: false, reason: "a photo was missing" } }),
      ),
    );
    expect(read.preview).toEqual({
      drawn: false,
      reason: "a photo was missing",
    });
  });

  it("refuses text that is not JSON", () => {
    expectRefusal("not json {", /not a JSON file/);
  });

  it("refuses a file of another format", async () => {
    const envelope = await envelopeFor();
    expectRefusal(
      JSON.stringify({ ...envelope, format: "wwo-events" }),
      /not a collage file/,
    );
  });

  it("refuses an unknown version", async () => {
    const envelope = await envelopeFor();
    expectRefusal(
      JSON.stringify({ ...envelope, version: 2 }),
      /version 2 collage file/,
    );
  });

  it("refuses an envelope with no collage", async () => {
    const envelope = await envelopeFor();
    expectRefusal(
      JSON.stringify({ ...envelope, collage: null }),
      /holds no collage/,
    );
  });

  it("refuses a collage that fails to parse", async () => {
    const envelope = await envelopeFor();
    const collage = envelope.collage as Record<string, unknown>;
    expectRefusal(
      JSON.stringify({
        ...envelope,
        collage: { ...collage, pieces: [{ ...piece(), x: "left" }] },
      }),
      /could not be read: Collage piece is missing a numeric x/,
    );
  });

  it("refuses a collage with an unknown format name", async () => {
    const envelope = await envelopeFor();
    const collage = envelope.collage as Record<string, unknown>;
    expectRefusal(
      JSON.stringify({ ...envelope, collage: { ...collage, format: "mural" } }),
      /unknown format: mural/,
    );
  });

  it("refuses a preview with a non-image media type", async () => {
    const envelope = await envelopeFor();
    const collage = envelope.collage as Record<string, unknown>;
    expectRefusal(
      JSON.stringify({
        ...envelope,
        collage: {
          ...collage,
          preview: {
            drawn: true,
            image: { mediaType: "text/html", base64: "AAAA" },
          },
        },
      }),
      /unknown media type: text\/html/,
    );
  });

  it("refuses a preview that is not valid base64", async () => {
    const envelope = await envelopeFor();
    const collage = envelope.collage as Record<string, unknown>;
    expectRefusal(
      JSON.stringify({
        ...envelope,
        collage: {
          ...collage,
          preview: {
            drawn: true,
            image: { mediaType: "image/png", base64: "!!not base64!!" },
          },
        },
      }),
      /not valid base64/,
    );
  });

  it("refuses a preview that claims to be drawn but carries no picture", async () => {
    const envelope = await envelopeFor();
    const collage = envelope.collage as Record<string, unknown>;
    expectRefusal(
      JSON.stringify({
        ...envelope,
        collage: { ...collage, preview: { drawn: true } },
      }),
      /has no preview/,
    );
  });

  it("runs the store's upgrades, so a collage saved before grain still opens", async () => {
    const envelope = await envelopeFor();
    const collage = envelope.collage as Record<string, unknown>;
    const read = readCollageFile(
      JSON.stringify({
        ...envelope,
        collage: { ...collage, paper: { color: "#fffdf9" } },
      }),
    );
    expect(read.paper).toEqual({ color: "#fffdf9", grain: false });
  });
});

describe("importCollageFile", () => {
  it("gives the collage and every piece a fresh id", async () => {
    const original = record();
    const text = await encodeCollageFile(original);
    const first = importCollageFile(text);
    const second = importCollageFile(text);
    expect(first.id).not.toBe(original.id);
    expect(second.id).not.toBe(first.id);
    const originalPieceIds = original.pieces.map((p) => p.id);
    for (const imported of [first, second]) {
      for (const importedPiece of imported.pieces) {
        expect(originalPieceIds).not.toContain(importedPiece.id);
      }
    }
    expect(first.pieces.map((p) => p.id)).not.toEqual(
      second.pieces.map((p) => p.id),
    );
    expect(first.pieces.map(({ id: _id, ...rest }) => rest)).toEqual(
      original.pieces.map(({ id: _id, ...rest }) => rest),
    );
  });

  it("keeps the title and the dates the collage was made and changed", async () => {
    const imported = importCollageFile(
      await encodeCollageFile(record(), 99_000),
    );
    expect(imported.title).toBe("a collage");
    expect(imported.createdAt).toBe(5_000);
    expect(imported.updatedAt).toBe(6_000);
  });
});
