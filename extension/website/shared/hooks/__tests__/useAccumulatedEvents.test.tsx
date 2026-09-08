// ABOUTME: Exercises live trail retirement across React renders and incoming event windows.
// ABOUTME: Ensures unrelated renders cannot discard pending trail evictions.
// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useAccumulatedEvents } from "../useAccumulatedEvents";
import type { CollectionEvent } from "../../types";

it("retains pending evictions until an accumulation pass consumes them", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const container = document.createElement("div");
  const root = createRoot(container);
  const evictIdsRef = { current: new Set<string>() };
  const events = [
    {
      id: "a",
      ts: 100,
      type: "cursor",
      data: { event: "move", x: 0, y: 0 },
      meta: { pid: "p", sid: "s", url: "u", vw: 1000, vh: 800, tz: "UTC" },
    },
  ] as CollectionEvent[];
  let rendered: CollectionEvent[] = [];
  function Probe({ incoming }: { incoming: CollectionEvent[] }) {
    rendered = useAccumulatedEvents(incoming, { evictIdsRef });
    return null;
  }
  try {
    await act(async () => root.render(<Probe incoming={events} />));
    evictIdsRef.current.add("p|u");
    await act(async () => root.render(<Probe incoming={events} />));
    expect(evictIdsRef.current.has("p|u")).toBe(true);
    await act(async () => root.render(<Probe incoming={[...events]} />));
    expect(rendered).toEqual([]);
    expect(evictIdsRef.current.size).toBe(0);
    await act(async () => root.render(<Probe incoming={[...events]} />));
    expect(rendered).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});

it("does not replay density-evicted history when its participant moves again", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.createElement("div"));
  const event = (id: string, pid: string, ts: number): CollectionEvent => ({
    id,
    ts,
    type: "cursor",
    data: { event: "move", x: 0, y: 0 },
    meta: { pid, sid: "s", url: "u", vw: 1000, vh: 800, tz: "UTC" },
  });
  const history = [event("a", "p", 100), event("b", "p", 200)];
  let rendered: CollectionEvent[] = [];
  function Probe({ incoming }: { incoming: CollectionEvent[] }) {
    rendered = useAccumulatedEvents(incoming, { maxGroups: 1 });
    return null;
  }
  try {
    await act(async () => root.render(<Probe incoming={history} />));
    const crowded = [...history, event("c", "q", 300)];
    await act(async () => root.render(<Probe incoming={crowded} />));
    expect(rendered.map((item) => item.id)).toEqual(["c"]);
    const resumed = [...crowded, event("d", "p", 400)];
    await act(async () => root.render(<Probe incoming={resumed} />));
    expect(rendered.map((item) => item.id)).toEqual(["d"]);
  } finally {
    await act(async () => root.unmount());
    Reflect.deleteProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  }
});
