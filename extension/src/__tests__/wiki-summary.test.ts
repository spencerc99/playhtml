// ABOUTME: Tests for the Wikipedia summary fetch/cache module.
// ABOUTME: Verifies caching, in-flight dedupe, and graceful failure handling.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  fetchWikiSummary,
  getCachedSummary,
  wikipediaUrlForTitle,
  titleToPath,
  _clearSummaryCacheForTest,
} from "../features/wiki-summary";

function okResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as Response;
}

describe("wiki-summary", () => {
  beforeEach(() => {
    _clearSummaryCacheForTest();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("titleToPath turns spaces into underscores and encodes", () => {
    expect(titleToPath("Pyotr Stolypin")).toBe("Pyotr_Stolypin");
    expect(titleToPath("C++")).toBe("C%2B%2B");
  });

  it("wikipediaUrlForTitle builds an en.wikipedia.org article URL", () => {
    expect(wikipediaUrlForTitle("Octopus")).toBe("https://en.wikipedia.org/wiki/Octopus");
  });

  it("fetches and normalizes a summary", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      okResponse({
        title: "Octopus",
        description: "eight-limbed mollusc",
        extract: "The octopus is a soft-bodied mollusc.",
        thumbnail: { source: "https://img/oct.jpg", width: 320, height: 200 },
        content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Octopus" } },
      }),
    ) as typeof fetch;

    const s = await fetchWikiSummary("Octopus");
    expect(s).not.toBeNull();
    expect(s!.title).toBe("Octopus");
    expect(s!.description).toBe("eight-limbed mollusc");
    expect(s!.extract).toContain("soft-bodied");
    expect(s!.thumbnail?.source).toBe("https://img/oct.jpg");
    expect(s!.url).toBe("https://en.wikipedia.org/wiki/Octopus");
  });

  it("caches the result so a second call does not refetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse({ title: "Octopus", extract: "x" }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    await fetchWikiSummary("Octopus");
    await fetchWikiSummary("Octopus");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getCachedSummary("Octopus")).not.toBeNull();
  });

  it("dedupes concurrent in-flight requests for the same title", async () => {
    let resolveFetch: (r: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((res) => {
        resolveFetch = res;
      }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const p1 = fetchWikiSummary("Octopus");
    const p2 = fetchWikiSummary("Octopus");
    resolveFetch(okResponse({ title: "Octopus", extract: "x" }));
    await Promise.all([p1, p2]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null and caches null on a non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response) as typeof fetch;
    const s = await fetchWikiSummary("Nonexistent");
    expect(s).toBeNull();
    expect(getCachedSummary("Nonexistent")).toBeNull();
  });

  it("returns null on a fetch rejection (network error)", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as typeof fetch;
    const s = await fetchWikiSummary("Octopus");
    expect(s).toBeNull();
  });

  it("returns null when the payload has no usable extract", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      okResponse({ title: "Disambig", extract: "" }),
    ) as typeof fetch;
    expect(await fetchWikiSummary("Disambig")).toBeNull();
  });
});
