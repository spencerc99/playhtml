// ABOUTME: Tests normalization, queue updates, storage recovery, and curation export.
// ABOUTME: Keeps the local admin artifact stable enough to hand back to Codex.

import { describe, expect, it } from "vitest";
import {
  createCuratedPlace,
  getDecisionForReviewItem,
  getReviewTarget,
  getScopedPlace,
  normalizePlace,
  parseCommuteReviewResponse,
  parseStoredCuration,
  serializeCurationArtifact,
  upsertCuratedPlace,
} from "./curation";

const PROMOTED = createCuratedPlace({
  id: "one",
  input: "https://www.example.com/an-essay?view=full#notes",
  scope: "page",
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

describe("decision scope", () => {
  it("separates a page, hostname, and registrable site", () => {
    const input = "https://notes.example.co.uk/an-essay";
    expect(getScopedPlace(input, "page").place).toBe(
      "https://notes.example.co.uk/an-essay",
    );
    expect(getScopedPlace(input, "hostname").place).toBe(
      "notes.example.co.uk",
    );
    expect(getScopedPlace(input, "site").place).toBe("example.co.uk");
  });

  it("treats private hosting suffixes as site boundaries", () => {
    expect(
      getScopedPlace("bright-tanuki.netlify.app", "site").place,
    ).toBe("bright-tanuki.netlify.app");
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

  it("preserves prior prototype decisions as hostname decisions", () => {
    const oldPlace = Object.fromEntries(
      Object.entries(PROMOTED).filter(([key]) => key !== "scope"),
    );
    expect(parseStoredCuration(JSON.stringify([oldPlace]))[0]).toMatchObject({
      place: "example.com",
      domain: "example.com",
      scope: "hostname",
    });
  });

  it("stores a note without inventing a verdict", () => {
    const note = createCuratedPlace({
      id: "note",
      input: "example.com",
      scope: "hostname",
      comment: "Needs a broader policy discussion.",
      updatedAt: "2026-08-12T12:00:00.000Z",
    });

    expect(note.verdict).toBeUndefined();
    expect(parseStoredCuration(JSON.stringify([note]))).toEqual([note]);
  });
});

describe("parseCommuteReviewResponse", () => {
  it("accepts a sanitized live review queue", () => {
    expect(
      parseCommuteReviewResponse({
        generatedAt: 1_000,
        activePeople: 0,
        destinations: [
          {
            id: "https://example.com/essay",
            domain: "example.com",
            url: "https://example.com/essay",
            title: "An essay",
          },
        ],
        scenery: [{ id: "elsewhere.example", domain: "elsewhere.example" }],
      }),
    ).toEqual({
      generatedAt: 1_000,
      items: [
        {
          id: "https://example.com/essay",
          domain: "example.com",
          url: "https://example.com/essay",
          title: "An essay",
          currentDisposition: "stop",
        },
        {
          id: "elsewhere.example",
          domain: "elsewhere.example",
          currentDisposition: "scenery",
        },
      ],
    });
  });

  it("rejects a queue containing raw or malformed items", () => {
    expect(() =>
      parseCommuteReviewResponse({
        generatedAt: 1_000,
        destinations: [{ id: "private-event", domain: "example.com" }],
        scenery: [],
      }),
    ).toThrow("invalid place");
  });
});

describe("getReviewTarget", () => {
  it("uses the same normalized identity as stored decisions", () => {
    expect(
      getReviewTarget(
        {
          id: "https://www.example.com/essay",
          domain: "example.com",
          url: "https://www.example.com/essay",
          currentDisposition: "stop",
        },
        "page",
      ),
    ).toBe("https://example.com/essay");
  });

  it("finds a site-wide decision for a subdomain candidate", () => {
    const decision = createCuratedPlace({
      id: "site",
      input: "example.com",
      scope: "site",
      verdict: "blocked",
      comment: "",
      updatedAt: "2026-08-12T12:00:00.000Z",
    });
    expect(
      getDecisionForReviewItem([decision], {
        id: "notes.example.com",
        domain: "notes.example.com",
        currentDisposition: "scenery",
      }),
    ).toEqual(decision);
  });
});

describe("serializeCurationArtifact", () => {
  it("groups decisions predictably and omits empty comments", () => {
    const blocked = createCuratedPlace({
      id: "two",
      input: "login.example.net/account",
      scope: "hostname",
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
      format: "internet-commute-curation/v3",
      generatedAt: "2026-08-12T13:00:00.000Z",
      decisions: [
        {
          place: "https://example.com/an-essay?view=full",
          scope: "page",
          verdict: "promoted",
          comment: "A public essay.",
        },
        {
          place: "login.example.net",
          scope: "hostname",
          verdict: "blocked",
        },
      ],
    });
  });

  it("exports note-only entries without a verdict", () => {
    const note = createCuratedPlace({
      id: "note",
      input: "notes.example.com",
      scope: "hostname",
      comment: "Review this family of pages later.",
      updatedAt: "2026-08-12T12:00:00.000Z",
    });
    const artifact = JSON.parse(
      serializeCurationArtifact([note], "2026-08-12T13:00:00.000Z"),
    );

    expect(artifact.decisions[0]).toEqual({
      place: "notes.example.com",
      scope: "hostname",
      comment: "Review this family of pages later.",
    });
  });
});
