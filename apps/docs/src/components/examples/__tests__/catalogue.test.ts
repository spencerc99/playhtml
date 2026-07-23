// ABOUTME: Verifies Are.na mapping, destination deduplication, and catalogue search.
// ABOUTME: Keeps malformed external blocks from breaking the examples index.

import { describe, expect, it } from "vitest";
import type { ExampleRecipeSummary } from "../../playground/recipes/types";
import {
  deduplicateSitesByUrl,
  filterExamples,
  filterSites,
  isArenaContentsResponse,
  isUsefulSiteDescription,
  mapArenaSites,
  type SiteSummary,
} from "../catalogue";

const EXAMPLE: ExampleRecipeSummary = {
  id: "shared-transport",
  title: "Synchronized sound",
  description: "Play a cue and keep a shared audio timeline in sync.",
  tags: ["audio", "events"],
  capabilities: ["can-play"],
  difficulty: "advanced",
  docsHref: "/docs/examples/shared-transport/",
};

describe("mapArenaSites", () => {
  it("maps public V3 Link blocks and prefers the small image rendition", () => {
    const sites = mapArenaSites({
      meta: { total_count: 1 },
      data: [
        {
          id: 42,
          type: "Link",
          visibility: "public",
          title: "Music Room by Casey",
          description: { plain: "Make a beat together." },
          source: {
            url: "https://music.example/room",
            title: "Music Room",
          },
          image: {
            alt_text: "A shared sequencer",
            src: "https://images.example/original.png",
            small: { src: "https://images.example/small.png" },
          },
        },
      ],
    });

    expect(sites).toEqual([
      {
        id: "arena-42",
        title: "Music Room",
        description: "Make a beat together.",
        href: "https://music.example/room",
        hostname: "music.example",
        imageUrl: "https://images.example/small.png",
        imageAlt: "A shared sequencer",
      },
    ]);
  });

  it("ignores non-links, private blocks, and invalid destinations", () => {
    expect(
      mapArenaSites({
        data: [
          { id: 1, type: "Text", visibility: "public" },
          {
            id: 2,
            type: "Link",
            visibility: "private",
            source: { url: "https://private.example" },
          },
          {
            id: 3,
            type: "Link",
            visibility: "public",
            source: { url: "javascript:alert(1)" },
          },
          { id: 4, type: "Link", visibility: "public" },
        ],
      }),
    ).toEqual([]);
  });

  it("returns an empty list for a malformed response", () => {
    expect(isArenaContentsResponse({ contents: [] })).toBe(false);
    expect(isArenaContentsResponse({ data: [] })).toBe(true);
    expect(mapArenaSites({ contents: [] })).toEqual([]);
    expect(mapArenaSites(null)).toEqual([]);
  });

  it("hides loading and punctuation placeholders from site descriptions", () => {
    expect(isUsefulSiteDescription("A collaborative music room.")).toBe(true);
    expect(isUsefulSiteDescription("connecting…")).toBe(false);
    expect(isUsefulSiteDescription("?")).toBe(false);
  });

  it("extracts an author marker from the first description line", () => {
    const [site] = mapArenaSites({
      data: [
        {
          id: 43,
          type: "Link",
          visibility: "public",
          title: "Casey",
          description: { plain: "By: Casey Example\n\nMake a beat together." },
          source: {
            url: "https://music.example/room",
            title: "Music Room",
          },
        },
      ],
    });

    expect(site.author).toBe("Casey Example");
    expect(site.description).toBe("Make a beat together.");
    expect(filterSites([site], "Casey Example")).toEqual([site]);
  });

  it("maps the author field from Are.na metadata", () => {
    const [site] = mapArenaSites({
      data: [
        {
          id: 44,
          type: "Link",
          visibility: "public",
          description: { plain: "A collaborative drawing surface." },
          metadata: { author: "João Bernardo Narciso" },
          source: {
            url: "https://drawing.example/",
            title: "Shared Drawing",
          },
        },
      ],
    });

    expect(site.author).toBe("João Bernardo Narciso");
    expect(filterSites([site], "João Bernardo Narciso")).toEqual([site]);
  });
});

describe("deduplicateSitesByUrl", () => {
  it("keeps the newest channel entry for equivalent destination URLs", () => {
    const newest: SiteSummary = {
      id: "arena-9",
      title: "Current listing",
      description: "",
      href: "https://example.com/project/#about",
      hostname: "example.com",
    };
    const older: SiteSummary = {
      id: "arena-4",
      title: "Earlier listing",
      description: "",
      href: "https://example.com/project",
      hostname: "example.com",
    };
    const other: SiteSummary = {
      id: "arena-3",
      title: "Another site",
      description: "",
      href: "https://another.example/",
      hostname: "another.example",
    };

    expect(deduplicateSitesByUrl([newest, older, other])).toEqual([
      newest,
      other,
    ]);
  });
});

describe("catalogue filtering", () => {
  const site: SiteSummary = {
    id: "arena-8",
    title: "Cinderblock Yard",
    description: "A collaborative physics playground.",
    href: "https://yard.example/",
    hostname: "yard.example",
  };

  it("searches example metadata and capability names", () => {
    expect(filterExamples([EXAMPLE], "CAN-PLAY")).toEqual([EXAMPLE]);
    expect(filterExamples([EXAMPLE], "audio")).toEqual([EXAMPLE]);
    expect(filterExamples([EXAMPLE], "drawing")).toEqual([]);
  });

  it("searches site titles, descriptions, and hostnames", () => {
    expect(filterSites([site], "physics")).toEqual([site]);
    expect(filterSites([site], "yard.example")).toEqual([site]);
    expect(filterSites([site], "sound")).toEqual([]);
  });
});
