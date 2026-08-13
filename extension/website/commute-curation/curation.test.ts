// ABOUTME: Tests normalization, queue updates, storage recovery, and curation export.
// ABOUTME: Keeps the local admin artifact stable enough to hand back to Codex.

import { describe, expect, it } from "vitest";
import {
  createCuratedPlace,
  normalizePlace,
  parseStoredCuration,
  serializeCurationArtifact,
  upsertCuratedPlace,
} from "./curation";

const PROMOTED = createCuratedPlace({
  id: "one",
  input: "https://www.example.com/an-essay?view=full#notes",
  verdict: "promoted",
  comment: "A public essay.",
  updatedAt: "2026-08-12T12:00:00.000Z",
});

describe("normalizePlace", () => {
  it("normalizes bare domains and removes www", () => {
    expect(normalizePlace("  www.Example.com  ")).toEqual({
      place: "example.com",
      domain: "example.com",
    });
  });

  it("keeps page paths and queries while removing fragments", () => {
    expect(
      normalizePlace("https://www.example.com/post?id=4#comments"),
    ).toEqual({
      place: "https://example.com/post?id=4",
      domain: "example.com",
    });
  });

  it("rejects non-web URLs", () => {
    expect(() => normalizePlace("file:///private/note.html")).toThrow(
      "Only HTTP and HTTPS places can be reviewed.",
    );
  });
});

describe("curation queue", () => {
  it("updates an existing place instead of duplicating it", () => {
    const replacement = { ...PROMOTED, verdict: "blocked" as const };
    expect(upsertCuratedPlace([PROMOTED], replacement)).toEqual([replacement]);
  });

  it("recovers valid entries from storage and ignores corrupt data", () => {
    expect(parseStoredCuration(JSON.stringify([PROMOTED, { id: 4 }]))).toEqual([
      PROMOTED,
    ]);
    expect(parseStoredCuration("not json")).toEqual([]);
  });
});

describe("serializeCurationArtifact", () => {
  it("groups decisions predictably and omits empty comments", () => {
    const blocked = createCuratedPlace({
      id: "two",
      input: "login.example.net/account",
      verdict: "blocked",
      comment: " ",
      updatedAt: "2026-08-12T12:01:00.000Z",
    });
    const artifact = JSON.parse(
      serializeCurationArtifact(
        [blocked, PROMOTED],
        "2026-08-12T13:00:00.000Z",
      ),
    );

    expect(artifact).toEqual({
      format: "internet-commute-curation/v1",
      generatedAt: "2026-08-12T13:00:00.000Z",
      decisions: [
        {
          place: "https://example.com/an-essay?view=full",
          verdict: "promoted",
          comment: "A public essay.",
        },
        {
          place: "https://login.example.net/account",
          verdict: "blocked",
        },
      ],
    });
  });
});
