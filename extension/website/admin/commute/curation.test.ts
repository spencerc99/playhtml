// ABOUTME: Tests normalization, queue updates, storage recovery, and curation export.
// ABOUTME: Keeps the local admin artifact stable enough to hand back to Codex.

import { describe, expect, it } from "vitest";
import {
  canPrefillSuggestion,
  createCuratedPlace,
  getDecisionForReviewItem,
  getDecisionToReplace,
  getNarrowerRuleThatWins,
  getPageRuleToClear,
  getDecisionsForReviewItem,
  getDefaultPatternTarget,
  getQueueGroup,
  getDefaultPathTarget,
  getReviewTarget,
  getScopedPlace,
  mergeCatalogEvidence,
  needsHumanReview,
  normalizePlace,
  parseCommuteReviewResponse,
  parseStoredCuration,
  serializeCurationArtifact,
  upsertCuratedPlace,
} from "./curation";

const FEATURED = createCuratedPlace({
  id: "one",
  input: "https://www.example.com/an-essay?view=full#notes",
  scope: "page",
  placement: "featured",
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
    const replacement = { ...FEATURED, placement: "hidden" as const };
    expect(upsertCuratedPlace([FEATURED], replacement)).toEqual([replacement]);
  });

  it("recovers valid entries from storage and ignores corrupt data", () => {
    expect(parseStoredCuration(JSON.stringify([FEATURED, { id: 4 }]))).toEqual([
      FEATURED,
    ]);
    expect(parseStoredCuration("not json")).toEqual([]);
  });

  it("preserves prior prototype decisions as hostname decisions", () => {
    const oldPlace = Object.fromEntries(
      Object.entries(FEATURED).filter(([key]) => key !== "scope"),
    );
    expect(parseStoredCuration(JSON.stringify([oldPlace]))[0]).toMatchObject({
      place: "example.com",
      domain: "example.com",
      scope: "hostname",
    });
  });

  it("maps prior verdicts into the five placement levels", () => {
    const priorDecision = {
      ...FEATURED,
      placement: undefined,
      verdict: "promoted",
    };
    expect(parseStoredCuration(JSON.stringify([priorDecision]))[0]).toMatchObject({
      placement: "featured",
    });
  });

  it("stores a note without inventing a placement", () => {
    const note = createCuratedPlace({
      id: "note",
      input: "example.com",
      scope: "hostname",
      comment: "Needs a broader policy discussion.",
      updatedAt: "2026-08-12T12:00:00.000Z",
    });

    expect(note.placement).toBeUndefined();
    expect(parseStoredCuration(JSON.stringify([note]))).toEqual([note]);
  });
});

describe("suggestion prefill", () => {
  it("fills only the still-selected untouched candidate without human policy", () => {
    expect(canPrefillSuggestion({
      hasDecision: false,
      formEdited: false,
      selectedItemId: "one",
      suggestionItemId: "one",
    })).toBe(true);
    expect(canPrefillSuggestion({
      hasDecision: true,
      formEdited: false,
      selectedItemId: "one",
      suggestionItemId: "one",
    })).toBe(false);
    expect(canPrefillSuggestion({
      hasDecision: false,
      formEdited: true,
      selectedItemId: "one",
      suggestionItemId: "one",
    })).toBe(false);
    expect(canPrefillSuggestion({
      hasDecision: false,
      formEdited: false,
      selectedItemId: "two",
      suggestionItemId: "one",
    })).toBe(false);
  });
});

describe("parseCommuteReviewResponse", () => {
  it("keeps only pages that need a human in the default queue", () => {
    const { items } = parseCommuteReviewResponse({
      generatedAt: 1,
      destinations: [
        { domain: "a.example", url: "https://a.example/", review: { need: "unsure", visits: 4, clef: { placement: "regular", confidence: 0.5 } } },
        { domain: "b.example", url: "https://b.example/", review: { need: null, visits: 9 } },
      ],
      scenery: [{ domain: "mail.example" }],
    });
    expect(items.filter(needsHumanReview).map((item) => item.domain)).toEqual(["a.example"]);
    expect(items[0]).toMatchObject({ need: "unsure", visits: 4, clef: { placement: "regular" } });
  });

  it("reads Clef's call on scenery names", () => {
    const { items } = parseCommuteReviewResponse({
      generatedAt: 1,
      destinations: [],
      scenery: [
        { domain: "x.com", review: { need: null, visits: 1, clef: { placement: "scenery", confidence: 0.9 } } },
        { domain: "mail.example", review: { need: "hidden", visits: 1, clef: { placement: "hidden", confidence: 0.8 } } },
      ],
    });
    expect(items.filter(needsHumanReview).map((item) => item.domain)).toEqual(["mail.example"]);
    expect(items[0]).toMatchObject({ need: null, clef: { placement: "scenery" } });
  });

  it("keeps every page when the Worker does not annotate needs", () => {
    const { items } = parseCommuteReviewResponse({
      generatedAt: 1,
      destinations: [{ domain: "a.example", url: "https://a.example/" }],
      scenery: [{ domain: "mail.example" }],
    });
    expect(items.filter(needsHumanReview)).toHaveLength(2);
  });

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

describe("mergeCatalogEvidence", () => {
  it("attaches audit evidence without converting its suggestion into a placement", () => {
    const items = mergeCatalogEvidence([], [
      {
        url: "https://example.com/essay",
        domain: "example.com",
        title: "An essay",
        provenance: "commute-history-audit/v2:redacted",
        generatedAt: "2026-08-16T00:00:00.000Z",
        evidence: {
          category: { value: "Arts & culture", confidence: 0.8, source: "url-rule", reasons: [] },
          pageType: { value: "Article or essay", confidence: 0.8, source: "url-rule", reasons: [] },
          exposure: { value: "Public", confidence: 0.92, source: "commute-policy", reasons: [] },
          character: { value: "Human-made", confidence: 0.7, source: "url-rule", reasons: [] },
          observation: {
            visits: 5,
            participants: 2,
            sessions: 3,
            screenTimeMs: 60_000,
            firstSeen: "2026-08-01T00:00:00.000Z",
            lastSeen: "2026-08-02T00:00:00.000Z",
            domainParticipants: 4,
            domainVisits: 10,
            domainScreenTimeMs: 120_000,
          },
          lanes: ["Independent convergence"],
          components: { humanConfidence: 0.7 },
          scores: { humanWeb: 82 },
          initialJudgment: { value: "Promote", confidence: 0.8, source: "initial-judgment", reasons: [] },
          reasons: ["2 people"],
        },
      },
    ]);

    expect(items).toEqual([
      expect.objectContaining({
        url: "https://example.com/essay",
        currentDisposition: "stop",
        evidence: expect.objectContaining({
          initialJudgment: expect.objectContaining({ value: "Promote" }),
          scores: { humanWeb: 82 },
        }),
      }),
    ]);
    expect(items[0]).not.toHaveProperty("placement");
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
      placement: "hidden",
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

  it("sorts rows into waiting, Clef decided and you decided", () => {
    const item = {
      id: "a",
      domain: "a.example",
      currentDisposition: "stop" as const,
    };
    expect(getQueueGroup({ ...item, need: "unsure" }, false)).toBe("waiting");
    expect(getQueueGroup({ ...item, need: null }, false)).toBe("clef");
    expect(getQueueGroup({ ...item, need: "unsure" }, true)).toBe("decided");
  });

  it("keeps a site rule when a page under it gets its own rule", () => {
    const site = createCuratedPlace({
      id: "site",
      input: "etsy.com",
      scope: "site",
      placement: "regular",
      comment: "",
      updatedAt: "2026-10-13T12:00:00.000Z",
    });
    const page = createCuratedPlace({
      id: "page",
      input: "https://www.etsy.com/your/purchases",
      scope: "page",
      placement: "hidden",
      comment: "",
      updatedAt: "2026-10-13T12:01:00.000Z",
    });
    const item = {
      id: "purchases",
      domain: "www.etsy.com",
      url: "https://www.etsy.com/your/purchases",
      currentDisposition: "stop" as const,
    };
    expect(getDecisionToReplace([site], item, "page")).toBeUndefined();
    expect(getDecisionToReplace([site], item, "site")).toEqual(site);
    expect(getDecisionsForReviewItem([site, page], item)).toEqual([page, site]);
    expect(getDecisionForReviewItem([site, page], item)).toEqual(page);
  });

  it("finds a path decision for pages beneath it and defaults paths to the first segment", () => {
    const decision = createCuratedPlace({
      id: "path",
      input: "github.com/settings",
      scope: "path",
      placement: "scenery",
      comment: "",
      updatedAt: "2026-10-10T12:00:00.000Z",
    });
    const item = {
      id: "profile",
      domain: "github.com",
      url: "https://github.com/settings/profile",
      currentDisposition: "stop" as const,
    };
    expect(decision.place).toBe("github.com/settings");
    expect(getDecisionForReviewItem([decision], item)).toEqual(decision);
    expect(getDefaultPathTarget(item)).toBe("github.com/settings");
    expect(getDefaultPathTarget({ ...item, url: "https://github.com/" })).toBeNull();
  });

  it("lets a domain-only row take a homepage page rule", () => {
    const item = {
      id: "canva.com",
      domain: "canva.com",
      currentDisposition: "scenery" as const,
    };
    expect(getReviewTarget(item, "page")).toBe("https://canva.com/");
    const homepage = createCuratedPlace({
      id: "home",
      input: getReviewTarget(item, "page"),
      scope: "page",
      placement: "hidden",
      comment: "",
      updatedAt: "2026-10-16T12:00:00.000Z",
    });
    const deepPage = createCuratedPlace({
      id: "deep",
      input: "https://canva.com/design/abc",
      scope: "page",
      placement: "hidden",
      comment: "",
      updatedAt: "2026-10-16T12:00:00.000Z",
    });
    expect(getDecisionForReviewItem([deepPage, homepage], item)).toEqual(homepage);
    expect(getDecisionToReplace([homepage], item, "page")).toEqual(homepage);
    expect(getDecisionToReplace([homepage], item, "hostname")).toBeUndefined();
  });
});

describe("serializeCurationArtifact", () => {
  it("groups decisions predictably and omits empty comments", () => {
    const blocked = createCuratedPlace({
      id: "two",
      input: "login.example.net/account",
      scope: "hostname",
      placement: "hidden",
      reason: "authentication-required",
      comment: " ",
      updatedAt: "2026-08-12T12:01:00.000Z",
    });
    const artifact = JSON.parse(
      serializeCurationArtifact(
        [blocked, FEATURED],
        "2026-08-12T13:00:00.000Z",
      ),
    );

    expect(artifact).toEqual({
      format: "internet-commute-curation/v4",
      generatedAt: "2026-08-12T13:00:00.000Z",
      decisions: [
        {
          place: "login.example.net",
          scope: "hostname",
          placement: "hidden",
          reason: "authentication-required",
        },
        {
          place: "https://example.com/an-essay?view=full",
          scope: "page",
          placement: "featured",
          comment: "A public essay.",
        },
      ],
    });
  });

  it("exports note-only entries without a placement", () => {
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

describe("pattern rules", () => {
  const item = {
    id: "naomi",
    domain: "letterboxd.com",
    url: "https://letterboxd.com/nylonsmile/tag/naomi/films",
    currentDisposition: "stop" as const,
  };
  const seen = ["a/tag/b", "c/tag/d", "e/tag/f"].map(
    (path) => `https://letterboxd.com/${path}/films`,
  );

  it("defaults to the inferred pattern, or the path with its last segment open", () => {
    expect(getDefaultPatternTarget(item, seen)).toBe(
      "letterboxd.com/*/tag/*/films",
    );
    expect(getDefaultPatternTarget(item)).toBe(
      "letterboxd.com/nylonsmile/tag/naomi/*",
    );
  });

  it("lists a covering pattern between the page and the site rule", () => {
    const rule = (id: string, input: string, scope: "pattern" | "site" | "page") =>
      createCuratedPlace({
        id,
        input,
        scope,
        placement: "regular",
        comment: "",
        updatedAt: FEATURED.updatedAt,
      });
    const places = [
      rule("site", "letterboxd.com", "site"),
      rule("pattern", "letterboxd.com/*/tag/*/films", "pattern"),
      rule("other", "letterboxd.com/*/films", "pattern"),
      rule("page", item.url, "page"),
    ];
    expect(getDecisionsForReviewItem(places, item).map((place) => place.id)).toEqual(
      ["page", "pattern", "site"],
    );
  });
});

describe("wider decisions over an older page rule", () => {
  const rule = (id: string, input: string, scope: "page" | "path" | "hostname" | "site", placement: "regular" | "featured" | "hidden") =>
    createCuratedPlace({ id, input, scope, placement, comment: "", updatedAt: "2026-10-19T00:00:00.000Z" });
  const item = {
    id: "https://neocities.org/",
    domain: "neocities.org",
    url: "https://neocities.org/",
    currentDisposition: "stop" as const,
  };

  it("clears only this page's own rule when saving wider", () => {
    const page = rule("page", "https://neocities.org/", "page", "regular");
    const other = rule("other", "https://neocities.org/browse", "page", "hidden");
    expect(getPageRuleToClear([page, other], item, "hostname", "neocities.org")).toEqual(page);
    expect(getPageRuleToClear([page, other], item, "page", "https://neocities.org/")).toBeUndefined();
    expect(getPageRuleToClear([other], item, "site", "neocities.org")).toBeUndefined();
  });

  it("keeps the page rule when a typed path or pattern points elsewhere", () => {
    const page = rule("page", "https://neocities.org/browse/art", "page", "regular");
    const browse = { ...item, id: page.place, url: "https://neocities.org/browse/art" };
    expect(getPageRuleToClear([page], browse, "path", "neocities.org/browse")).toEqual(page);
    expect(getPageRuleToClear([page], browse, "path", "neocities.org/news")).toBeUndefined();
    expect(getPageRuleToClear([page], browse, "path", "other.example/browse")).toBeUndefined();
    expect(getPageRuleToClear([page], browse, "pattern", "neocities.org/*/art")).toEqual(page);
    expect(getPageRuleToClear([page], browse, "pattern", "neocities.org/*")).toBeUndefined();
    expect(getPageRuleToClear([page], browse, "pattern", "not a url")).toBeUndefined();
  });

  it("names a narrower rule that would still win", () => {
    const hostname = rule("host", "neocities.org", "hostname", "featured");
    expect(getNarrowerRuleThatWins([hostname], item, "site")).toEqual(hostname);
    expect(getNarrowerRuleThatWins([hostname], item, "hostname")).toBeUndefined();
    expect(getNarrowerRuleThatWins([hostname], item, "page")).toBeUndefined();
  });
});
