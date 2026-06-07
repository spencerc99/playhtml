// ABOUTME: Tests the keyed-map roster helpers — pids, entries, current-check.

import { describe, it, expect } from "vitest";
import {
  rosterPids,
  rosterEntries,
  rosterEntryIsCurrent,
  type Roster,
  type RosterEntry,
} from "../roster";

const e = (pid: string, name = "n", color = "#000"): RosterEntry => ({
  pid,
  name,
  color,
});

describe("roster (keyed map)", () => {
  it("rosterPids returns the distinct pids", () => {
    const r: Roster = { pk_a: e("pk_a"), pk_b: e("pk_b") };
    expect(rosterPids(r).sort()).toEqual(["pk_a", "pk_b"]);
  });

  it("rosterPids is empty for an empty roster", () => {
    expect(rosterPids({})).toEqual([]);
  });

  it("rosterEntries returns the entry values", () => {
    const r: Roster = { pk_a: e("pk_a", "alice") };
    expect(rosterEntries(r)).toEqual([e("pk_a", "alice")]);
  });

  it("rosterEntryIsCurrent is true when the entry already matches", () => {
    const r: Roster = { pk_a: e("pk_a", "alice", "#111") };
    expect(rosterEntryIsCurrent(r, e("pk_a", "alice", "#111"))).toBe(true);
  });

  it("rosterEntryIsCurrent is false when missing", () => {
    expect(rosterEntryIsCurrent({}, e("pk_a"))).toBe(false);
  });

  it("rosterEntryIsCurrent is false when name or color differs", () => {
    const r: Roster = { pk_a: e("pk_a", "old") };
    expect(rosterEntryIsCurrent(r, e("pk_a", "new"))).toBe(false);
  });

  it("tolerates a legacy array-shaped roster (re-keys by pid)", () => {
    // A room persisted under the old array shape should still read correctly.
    const legacy = [e("pk_a", "alice"), e("pk_b", "bob")] as unknown as Roster;
    expect(rosterPids(legacy).sort()).toEqual(["pk_a", "pk_b"]);
    expect(rosterEntries(legacy)).toEqual([e("pk_a", "alice"), e("pk_b", "bob")]);
  });

  it("treats undefined/empty roster as empty", () => {
    expect(rosterPids(undefined)).toEqual([]);
    expect(rosterEntries(undefined)).toEqual([]);
  });

  it("rosterEntryIsCurrent is false (not a throw) when the roster is undefined", () => {
    // A room persisted before the `participants` field existed loads with
    // participants === undefined; the current-check must be null-safe.
    expect(rosterEntryIsCurrent(undefined, e("pk_a"))).toBe(false);
  });
});
