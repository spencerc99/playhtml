// ABOUTME: Tests the multi-PID portrait fetch — fan-out per pid/type, then merge.
// ABOUTME: Network is mocked; the fan-out and merge logic under test is real.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchPortraitEvents } from "../portraitData";

describe("fetchPortraitEvents", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty array for no pids without fetching", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const events = await fetchPortraitEvents([], ["trails"]);
    expect(events).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches once per (pid, type) and merges results", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        calls.push(url);
        const u = new URL(url);
        const pid = u.searchParams.get("pid")!;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([{ id: `${pid}-1`, type: "cursor", ts: 1, meta: { pid } }]),
        });
      }),
    );

    const events = await fetchPortraitEvents(["pk_a", "pk_b"], ["trails"]);
    // trails requires the "cursor" type → one fetch per pid.
    expect(calls.length).toBe(2);
    expect(calls.every((c) => c.includes("pid="))).toBe(true);
    expect(events.map((e) => e.id).sort()).toEqual(["pk_a-1", "pk_b-1"]);
  });

  it("tolerates a failing pid fetch and still returns the others", async () => {
    // The failing fetch is expected to log a warning — capture and assert it
    // so the error output is intentional and verified, not stray noise.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const pid = new URL(url).searchParams.get("pid")!;
        if (pid === "pk_bad") return Promise.resolve({ ok: false, status: 500 });
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([{ id: `${pid}-1`, type: "cursor", ts: 1, meta: { pid } }]),
        });
      }),
    );

    const events = await fetchPortraitEvents(["pk_good", "pk_bad"], ["trails"]);
    expect(events.map((e) => e.id)).toEqual(["pk_good-1"]);
    expect(warnSpy).toHaveBeenCalledWith(
      "[walking-together] portrait fetch failed",
      expect.objectContaining({ message: "fetch failed for pk_bad/cursor: 500" }),
    );
  });
});
