// ABOUTME: Tests that archive filter changes ignore superseded event responses.
// ABOUTME: Exercises the archive component with deterministic out-of-order fetches.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollectionEvent } from "../../types";

vi.mock("../../components/MovementCanvas", () => ({
  MovementCanvas: ({
    events,
    loading,
    error,
    onSetFilters,
  }: {
    events: CollectionEvent[];
    loading: boolean;
    error: string | null;
    onSetFilters: (filters: { domain: string; path: string }[]) => void;
  }) => (
    <>
      <output data-testid="events">{events.map((event) => event.id).join(",")}</output>
      <output data-testid="loading">{String(loading)}</output>
      <output data-testid="error">{error ?? ""}</output>
      <button
        onClick={() => onSetFilters([{ domain: "new.example", path: "" }])}
      >
        use new filter
      </button>
    </>
  ),
}));

import { InternetMovement } from "../../../archive/archive";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

async function renderArchive() {
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root?.render(<InternetMovement />));
  return container;
}

function outputText(container: HTMLElement, testId: string) {
  return container.querySelector(`[data-testid="${testId}"]`)?.textContent;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function response(events: CollectionEvent[]) {
  return { ok: true, json: async () => events } as Response;
}

function event(id: string): CollectionEvent {
  return {
    id,
    type: "cursor",
    ts: 1,
    data: { x: 0.5, y: 0.5 },
    meta: {
      sid: "session",
      pid: "person",
      url: "https://example.com",
      vw: 1,
      vh: 1,
      tz: "UTC",
    },
  };
}

describe("archive filter requests", () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    window.history.replaceState({}, "", "/archive/");
    localStorage.clear();
  });

  it("keeps the later filter's results when the earlier request resolves last", async () => {
    const firstEvents = deferred<Response>();
    const secondEvents = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("daily-counts")) return Promise.resolve(response([]));
      return url.includes("domain=new.example") ? secondEvents.promise : firstEvents.promise;
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = await renderArchive();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    await act(async () => secondEvents.resolve(response([event("new")])));
    await vi.waitFor(() => expect(outputText(container, "events")).toBe("new"));
    expect(outputText(container, "loading")).toBe("false");

    await act(async () => firstEvents.resolve(response([event("stale")])));
    await vi.waitFor(() => expect(outputText(container, "loading")).toBe("false"));
    expect(outputText(container, "events")).toBe("new");
  });

  it("does not surface an error from a superseded request", async () => {
    window.history.replaceState({}, "", "/archive/?day=2026-01-01");
    const firstEvents = deferred<Response>();
    const secondEvents = deferred<Response>();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("daily-counts")) return Promise.resolve(response([]));
      return url.includes("domain=new.example") ? secondEvents.promise : firstEvents.promise;
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const container = await renderArchive();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    await act(async () => secondEvents.resolve(response([event("new")])));
    await vi.waitFor(() => expect(outputText(container, "events")).toBe("new"));

    await act(async () => firstEvents.reject(new Error("stale request failed")));
    await vi.waitFor(() => expect(outputText(container, "loading")).toBe("false"));
    expect(outputText(container, "events")).toBe("new");
    expect(outputText(container, "error")).toBe("");
  });
});
