// ABOUTME: Verifies the keypresses loader shows only the latest domain's events.
// ABOUTME: Holds responses open so a domain change can land while the first request is still in flight.
// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useKeypressEvents, type KeypressEvents } from "../useKeypressEvents";
import type { CollectionEvent } from "../../shared/types";

function keyEvent(id: string, domain: string): CollectionEvent {
  return {
    id,
    ts: 100,
    type: "keyboard",
    domain,
    data: {},
    meta: { pid: "p", sid: "s", url: `https://${domain}/`, vw: 1, vh: 1, tz: "UTC" },
  } as CollectionEvent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("ignores a slower response for a domain that was replaced", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const pending = new Map<string, (events: CollectionEvent[]) => void>();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const domain = new URL(url).searchParams.get("domain") ?? "";
      return new Promise((resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
        pending.set(domain, (events) =>
          resolve({ ok: true, status: 200, json: async () => events }),
        );
      });
    }),
  );

  let latest: KeypressEvents | null = null;
  const Probe = ({ domain }: { domain: string }) => {
    latest = useKeypressEvents("https://api.test/events", 10, domain);
    return null;
  };
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe domain="a.com" />));
  await act(async () => root.render(<Probe domain="b.com" />));

  await act(async () => pending.get("b.com")!([keyEvent("b1", "b.com")]));
  await act(async () => pending.get("a.com")!([keyEvent("a1", "a.com")]));

  expect(latest!.events.map((e) => e.id)).toEqual(["b1"]);
  expect(latest!.loading).toBe(false);
  expect(latest!.error).toBeNull();
  await act(async () => root.unmount());
});

it("loads the new domain even while the previous domain is still loading", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      requested.push(new URL(url).searchParams.get("domain") ?? "");
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }),
  );

  let latest: KeypressEvents | null = null;
  const Probe = ({ domain }: { domain: string }) => {
    latest = useKeypressEvents("https://api.test/events", 10, domain);
    return null;
  };
  const root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe domain="a.com" />));
  await act(async () => root.render(<Probe domain="b.com" />));

  expect(requested).toEqual(["a.com", "b.com"]);
  expect(latest!.loading).toBe(true);
  expect(latest!.error).toBeNull();
  await act(async () => root.unmount());
});
