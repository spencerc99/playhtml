// ABOUTME: Tests event upload: hash fragments are stripped before events leave the device,
// ABOUTME: and the worker's permanent rejections settle a batch while transient failures retry.

import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKER_URL } from "@movement/config";
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
  vi.restoreAllMocks();
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

describe("uploadEvents failures", () => {
  function respond(status: number, body: string) {
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts to the configured worker", async () => {
    const fetchMock = respond(200, JSON.stringify({ inserted: 1, duplicates: 0 }));
    await uploadEvents([makeEvent("https://example.com/")]);
    expect(fetchMock.mock.calls[0][0]).toBe(`${WORKER_URL}/events`);
  });

  it.each([400, 413, 422])(
    "settles a batch the worker rejects with %i and warns once with the status and message",
    async (status) => {
      respond(status, "Invalid event: data.x must be a number");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await expect(uploadEvents([makeEvent("https://example.com/")])).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledTimes(1);
      const message = warn.mock.calls[0].map(String).join(" ");
      expect(message).toContain(String(status));
      expect(message).toContain("Invalid event: data.x must be a number");
    },
  );

  it.each([401, 403, 408, 429, 500, 503])(
    "throws on %i so the batch is retried",
    async (status) => {
      respond(status, "try again");
      await expect(uploadEvents([makeEvent("https://example.com/")])).rejects.toThrow(
        `Upload failed: ${status} try again`,
      );
    },
  );

  it("throws on a network failure so the batch is retried", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(uploadEvents([makeEvent("https://example.com/")])).rejects.toThrow("Failed to fetch");
    expect(error).toHaveBeenCalledTimes(1);
  });
});
