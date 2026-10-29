import { describe, expect, it } from "vitest";
import {
  cleanName,
  isRememberMessage,
  isSetNameMessage,
  mergeSharedCollageEntry,
  parseSharedCollageEntry,
  SHARED_COLLAGE_SOURCE,
} from "../features/sharedCollages/sharedCollageEntry";
import {
  isSharedCollagePageUrl,
  isSessionScrapsPageUrl,
} from "../features/sessionScraps/sessionScrapsBridge";
import { selectLibraryScraps } from "../features/sessionScraps/sessionScraps";
import {
  mergeCollageCards,
  withLine,
} from "../entrypoints/scraps/SharedCollageCard";

const isPage = (url: string) => isSharedCollagePageUrl(url);

const ENTRY = {
  id: "abcdefghjk23",
  url: "https://wewere.online/together/?c=abcdefghjk23",
  title: "buttons",
  startedByMe: false,
  joinedAt: 5,
  updatedAt: 9,
  pieceCount: 2,
  people: [{ name: "mira", color: "#e0752d" }],
  cover: {
    width: 1500,
    height: 1000,
    pieces: [
      {
        src: "https://example.com/a.jpg",
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
        rotation: 3,
      },
    ],
  },
};

describe("shared collage pages", () => {
  it("only counts wewere.online/together, plus local dev pages when allowed", () => {
    expect(isSharedCollagePageUrl("https://wewere.online/together/?c=x")).toBe(
      true,
    );
    expect(isSharedCollagePageUrl("https://wewere.online/together")).toBe(true);
    expect(isSharedCollagePageUrl("https://wewere.online/together-evil/")).toBe(
      false,
    );
    expect(isSharedCollagePageUrl("https://wewere.online/collage/")).toBe(
      false,
    );
    expect(isSharedCollagePageUrl("https://evil.example/together/")).toBe(
      false,
    );
    expect(isSharedCollagePageUrl("http://localhost:5174/together/")).toBe(
      false,
    );
    expect(
      isSharedCollagePageUrl("http://localhost:5174/together/", true),
    ).toBe(true);
    // The page also gets the extension's identity and session scraps.
    expect(isSessionScrapsPageUrl("https://wewere.online/together/?c=x")).toBe(
      true,
    );
    expect(isSessionScrapsPageUrl("https://wewere.online/")).toBe(false);
  });
});

describe("parseSharedCollageEntry", () => {
  it("keeps a well-formed entry", () => {
    expect(parseSharedCollageEntry(ENTRY, isPage)).toEqual(ENTRY);
  });

  it("refuses entries that point anywhere but a shared collage page", () => {
    expect(
      parseSharedCollageEntry(
        { ...ENTRY, url: "https://evil.example/together/" },
        isPage,
      ),
    ).toBeNull();
    expect(
      parseSharedCollageEntry({ ...ENTRY, id: "../x" }, isPage),
    ).toBeNull();
  });

  it("drops cover pictures that are not web images and colors that are not colors", () => {
    const entry = parseSharedCollageEntry(
      {
        ...ENTRY,
        people: [{ name: "a", color: "url(x)" }, { color: "#fff" }],
        cover: {
          ...ENTRY.cover,
          pieces: [{ src: "javascript:alert(1)" }, ...ENTRY.cover.pieces],
        },
      },
      isPage,
    );
    expect(entry?.people).toEqual([{ color: "#fff" }]);
    expect(entry?.cover.pieces).toHaveLength(1);
  });

  it("remembers who started it and when it was first joined", () => {
    const first = { ...ENTRY, startedByMe: true, joinedAt: 1 };
    expect(
      mergeSharedCollageEntry(first, { ...ENTRY, joinedAt: 50 }),
    ).toMatchObject({
      startedByMe: true,
      joinedAt: 1,
      updatedAt: 9,
    });
  });
});

describe("page messages", () => {
  it("recognizes names and remembered collages", () => {
    expect(cleanName("  mira   c  ")).toBe("mira c");
    expect(cleanName("   ")).toBeNull();
    expect(cleanName("mi\u202Era\u200B")).toBe("mi ra");
    expect(
      isSetNameMessage({
        source: SHARED_COLLAGE_SOURCE,
        type: "set-name",
        name: "mira",
      }),
    ).toBe(true);
    expect(
      isSetNameMessage({
        source: SHARED_COLLAGE_SOURCE,
        type: "set-name",
        name: " ",
      }),
    ).toBe(false);
    expect(
      isRememberMessage({
        source: SHARED_COLLAGE_SOURCE,
        type: "remember",
        collage: ENTRY,
      }),
    ).toBe(true);
    expect(
      isRememberMessage({ source: "other", type: "remember", collage: ENTRY }),
    ).toBe(false);
  });
});

describe("selectLibraryScraps", () => {
  it("takes the newest web images from any time, once each, up to the limit", () => {
    const candidate = (
      id: string,
      ts: number,
      src = `https://example.com/${id}.jpg`,
    ) => ({
      id,
      src,
      pageUrl: "https://example.com/private/page?token=1",
      ts,
      naturalWidth: 10,
      naturalHeight: 10,
    });
    const answer = selectLibraryScraps(
      [
        candidate("a", 300),
        candidate("dup", 200, "https://example.com/a.jpg"),
        candidate("local", 150, "data:image/png;base64,xx"),
        candidate("b", 100),
        candidate("c", 1),
      ],
      2,
    );
    expect(answer.scraps.map((scrap) => scrap.id)).toEqual(["a", "b"]);
    expect(answer.scraps[0].pageUrl).toBe("https://example.com");
  });
});

describe("collage list cards", () => {
  it("files shared collages among the rest by when they last changed", () => {
    const own = [
      { id: "new", updatedAt: 20 },
      { id: "old", updatedAt: 1 },
    ] as never[];
    const cards = mergeCollageCards(own, [{ ...ENTRY, updatedAt: 9 }]);
    expect(cards.map((card) => `${card.kind}:${card.entry.id}`)).toEqual([
      "own:new",
      "shared:abcdefghjk23",
      "own:old",
    ]);
  });

  it("says who a collage is with", () => {
    expect(withLine([])).toBe("just you so far");
    expect(withLine([{ name: "mira", color: "#000" }])).toBe("with mira");
    expect(
      withLine([
        { name: "mira", color: "#000" },
        { name: "jun", color: "#000" },
      ]),
    ).toBe("with mira and jun");
    expect(
      withLine([
        { name: "mira", color: "#000" },
        { name: "jun", color: "#000" },
        { color: "#000" },
        { color: "#111" },
      ]),
    ).toBe("with mira, jun and 2 others");
    expect(withLine([{ color: "#000" }])).toBe("with 1 other");
  });
});
