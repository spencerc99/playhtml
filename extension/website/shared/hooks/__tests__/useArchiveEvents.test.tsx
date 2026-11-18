// ABOUTME: Verifies archive event loading recovers from failed requests without a reload.
// ABOUTME: Covers a failed event type being fetched again and a broken response body being retried.
// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useArchiveEvents, type ArchiveEventsState } from "../useArchiveEvents";
import type { CollectionEvent } from "../../types";

const VISUALIZATIONS = ["trails", "typing"];

function event(id: string, type: CollectionEvent["type"]): CollectionEvent {
  return {
    id,
    ts: 100,
    type,
    data: {},
    meta: { pid: "p", sid: "s", url: "https://a.test/", vw: 1, vh: 1, tz: "UTC" },
  } as CollectionEvent;
}

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

let latest: ArchiveEventsState | null = null;
const Probe = () => {
  latest = useArchiveEvents({
    selectedDays: null,
    timeOfDay: null,
    serverDomain: "",
    activeVisualizations: VISUALIZATIONS,
  });
  return null;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  latest = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function typeOf(url: string): string | null {
  return new URL(url).searchParams.get("type");
}

it("fetches an event type again after every attempt for it failed", async () => {
  let keyboardCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const type = typeOf(url);
      if (type === "cursor") return okResponse([event("c1", "cursor")]);
      if (type === "keyboard") {
        keyboardCalls++;
        if (keyboardCalls <= 3) return { ok: false, status: 503, json: async () => [] };
        return okResponse([event("k1", "keyboard")]);
      }
      return okResponse([]);
    }),
  );

  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400 + 1200);
  });
  expect(latest!.events.map((e) => e.id)).toEqual(["c1"]);
  expect(console.warn).toHaveBeenCalledWith(
    "Failed to fetch keyboard events:",
    expect.any(Error),
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(latest!.events.map((e) => e.id).sort()).toEqual(["c1", "k1"]);
  expect(latest!.error).toBeNull();
  await act(async () => root.unmount());
});

it("retries a response whose body fails to parse", async () => {
  let cursorCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const type = typeOf(url);
      if (type === "cursor") {
        cursorCalls++;
        if (cursorCalls === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => {
              throw new SyntaxError("Unexpected end of JSON input");
            },
          };
        }
        return okResponse([event("c1", "cursor")]);
      }
      if (type === "keyboard") return okResponse([event("k1", "keyboard")]);
      return okResponse([]);
    }),
  );

  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(cursorCalls).toBe(2);
  expect(latest!.events.map((e) => e.id).sort()).toEqual(["c1", "k1"]);
  expect(console.warn).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
