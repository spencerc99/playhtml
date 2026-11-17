// ABOUTME: Verifies page metadata lookups use the cached host and fall back to the Worker's own address.
// ABOUTME: Covers a network failure on the cached host and an HTTP error that must not be retried.
// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { PAGE_META_FALLBACK_URL, PAGE_META_URL } from "../../config";
import { usePageMetaFallback } from "../usePageMetaFallback";

afterEach(() => {
  vi.unstubAllGlobals();
});

async function lookUp(pageUrl: string) {
  let latest = new Map<string, { title?: string; favicon?: string }>();
  const Probe = () => {
    latest = usePageMetaFallback([pageUrl]);
    return null;
  };
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(<Probe />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { root, read: () => latest };
}

it("reads from the Worker's own address when the cached host cannot be reached", async () => {
  expect(PAGE_META_FALLBACK_URL).not.toBe(PAGE_META_URL);
  const fetchMock = vi.fn(async (input: string) => {
    if (input.startsWith(PAGE_META_URL)) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify({ title: "A page" }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);

  const pageUrl = "https://example.com/unreachable-cached-host";
  const { root, read } = await lookUp(pageUrl);

  const query = `?url=${encodeURIComponent(pageUrl)}`;
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    `${PAGE_META_URL}${query}`,
    `${PAGE_META_FALLBACK_URL}${query}`,
  ]);
  expect(read().get(pageUrl)?.title).toBe("A page");
  act(() => root.unmount());
});

it("does not retry elsewhere when the cached host answers with an error", async () => {
  const fetchMock = vi.fn(async () => new Response("no", { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);

  const pageUrl = "https://example.com/cached-host-error";
  const { root, read } = await lookUp(pageUrl);

  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(read().has(pageUrl)).toBe(false);
  act(() => root.unmount());
});
