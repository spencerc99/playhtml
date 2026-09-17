// ABOUTME: Tests that event upload strips query strings/fragments from meta.url
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
  it("strips query string and hash from meta.url for every event type, not just navigation", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ inserted: 1, duplicates: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const event = makeEvent("https://example.com/search?q=sensitive+query&session=abc123#results");
    await uploadEvents([event]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.events[0].meta.url).toBe("https://example.com/search");
  });

  it("does not mutate the original event object passed in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ inserted: 1, duplicates: 0 }), { status: 200 }))
    );

    const event = makeEvent("https://example.com/page?token=secret");
    await uploadEvents([event]);

    expect(event.meta.url).toBe("https://example.com/page?token=secret");
  });
});
