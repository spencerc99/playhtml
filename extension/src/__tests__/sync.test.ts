// ABOUTME: Tests that event upload strips hash fragments from meta.url and navigation URLs
// ABOUTME: before events leave the device, without touching the caller's objects.

import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadEvents } from "../storage/sync";
import type { CollectionEvent } from "../collectors/types";

function makeEvent(url: string): CollectionEvent {
  return {
    id: "01TESTULID",
    type: "cursor",
    ts: Date.now(),
    data: { x: 0.5, y: 0.5 },
    meta: {
      pid: "pk_test",
      sid: "sid_test",
      url,
      vw: 1024,
      vh: 768,
      tz: "UTC",
    },
  } as CollectionEvent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("uploadEvents", () => {
  it("strips the hash but keeps the query string in meta.url for every event type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ inserted: 1, duplicates: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const event = makeEvent("https://www.youtube.com/watch?v=dQw4w9WgXcQ#access_token=abc123");
    await uploadEvents([event]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.events[0].meta.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  });

  it("does not mutate the original event object passed in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ inserted: 1, duplicates: 0 }), { status: 200 }))
    );

    const event = makeEvent("https://example.com/page#token=secret");
    await uploadEvents([event]);

    expect(event.meta.url).toBe("https://example.com/page#token=secret");
  });

  it("strips the hash from navigation data.url and data.from_url", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ inserted: 2, duplicates: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const popstate = {
      ...makeEvent("https://example.com/a?q=1#token=x"),
      type: "navigation",
      data: { event: "popstate", url: "https://example.com/b?q=2#access_token=y" },
    } as CollectionEvent;
    const unload = {
      ...makeEvent("https://example.com/a?q=1#token=x"),
      type: "navigation",
      data: { event: "beforeunload", from_url: "https://example.com/c?v=3#secret" },
    } as CollectionEvent;
    await uploadEvents([popstate, unload]);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.events[0].data.url).toBe("https://example.com/b?q=2");
    expect(body.events[1].data.from_url).toBe("https://example.com/c?v=3");
    expect((popstate.data as { url: string }).url).toBe("https://example.com/b?q=2#access_token=y");
  });
});
