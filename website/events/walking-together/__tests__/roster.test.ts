// ABOUTME: Tests roster upsert — unique pids, last-write-wins, self-healing dupes.

import { describe, it, expect } from "vitest";
import { upsertRoster, rosterIsCurrent, type RosterEntry } from "../roster";

const e = (pid: string, name = "n", color = "#000"): RosterEntry => ({
  pid,
  name,
  color,
});

describe("upsertRoster", () => {
  it("adds a new participant", () => {
    expect(upsertRoster([], e("pk_a"))).toEqual([e("pk_a")]);
  });

  it("never duplicates an existing pid — updates in place", () => {
    const next = upsertRoster([e("pk_a", "old", "#111")], e("pk_a", "new", "#222"));
    expect(next).toEqual([e("pk_a", "new", "#222")]);
    expect(next.filter((x) => x.pid === "pk_a")).toHaveLength(1);
  });

  it("keeps distinct pids and dedupes to one entry each", () => {
    const next = upsertRoster([e("pk_a"), e("pk_b")], e("pk_c"));
    expect(next.map((x) => x.pid).sort()).toEqual(["pk_a", "pk_b", "pk_c"]);
  });

  it("self-heals a roster that already contains duplicate pids", () => {
    // Simulates the bug's accumulated state: same pid written many times.
    const dupes = [e("pk_a", "a1"), e("pk_a", "a2"), e("pk_a", "a3"), e("pk_b")];
    const next = upsertRoster(dupes, e("pk_a", "latest"));
    expect(next).toHaveLength(2);
    expect(next.find((x) => x.pid === "pk_a")).toEqual(e("pk_a", "latest"));
    expect(next.find((x) => x.pid === "pk_b")).toEqual(e("pk_b"));
  });
});

describe("rosterIsCurrent", () => {
  it("is true when the entry already matches and there are no dupes", () => {
    expect(rosterIsCurrent([e("pk_a", "n", "#000")], e("pk_a", "n", "#000"))).toBe(
      true,
    );
  });

  it("is false when the entry is missing", () => {
    expect(rosterIsCurrent([e("pk_b")], e("pk_a"))).toBe(false);
  });

  it("is false when name or color differs", () => {
    expect(rosterIsCurrent([e("pk_a", "old")], e("pk_a", "new"))).toBe(false);
  });

  it("is false when duplicates exist (forces a healing write)", () => {
    expect(
      rosterIsCurrent([e("pk_a"), e("pk_a")], e("pk_a")),
    ).toBe(false);
  });
});
