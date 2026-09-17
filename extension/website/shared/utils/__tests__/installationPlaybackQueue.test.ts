// ABOUTME: Tests continuous live-first admissions while archive playback remains available.
// ABOUTME: Covers exhaustion, active-window exclusion, growth, and fresh arrivals during playback.
import { describe, expect, it } from "vitest";
import { InstallationPlaybackQueue } from "../installationPlaybackQueue";

const item = (id: string, live = false) => ({ id, live, value: id });
describe("installation playback queue", () => {
  it("inserts fresh live work ahead of waiting archive without replaying active work", () => {
    const queue = new InstallationPlaybackQueue<string>();
    queue.update([item("a"), item("b"), item("c")]);
    expect(queue.take(new Set())).toBe("a");
    queue.update([item("a"), item("b"), item("c"), item("live", true)]);
    expect(queue.take(new Set(["a"]))).toBe("live");
    expect(queue.take(new Set(["a", "live"]))).toBe("b");
    expect(queue.take(new Set(["a", "live", "b"]))).toBe("c");
  });
  it("reuses the archive beside a live window without waiting for it to finish", () => {
    const queue = new InstallationPlaybackQueue<string>();
    queue.update([item("live", true), item("a"), item("b")]);
    expect(queue.take(new Set())).toBe("live");
    expect(queue.take(new Set(["live"]))).toBe("a");
    expect(queue.take(new Set(["live", "a"]))).toBe("b");
    expect(queue.take(new Set(["live", "b"]))).toBe("a");
  });
  it("does not duplicate active recordings or lose waiting work when full", () => {
    const queue = new InstallationPlaybackQueue<string>();
    queue.update([item("a")]);
    expect(queue.take(new Set())).toBe("a");
    expect(queue.take(new Set(["a"]))).toBeNull();
    expect(queue.take(new Set())).toBe("a");
    queue.update([]);
    expect(queue.take(new Set())).toBeNull();
  });
  it("does not promote an already played live recording on each update", () => {
    const queue = new InstallationPlaybackQueue<string>();
    queue.update([item("live", true), item("a")]);
    expect(queue.take(new Set())).toBe("live");
    queue.update([item("live", true), item("a"), item("fresh", true)]);
    expect(queue.take(new Set())).toBe("fresh");
    expect(queue.take(new Set())).toBe("a");
  });

  it("offers a live recording ahead of the archive again once it has grown", () => {
    const queue = new InstallationPlaybackQueue<string>();
    const live = (value: string, version: number) => ({
      id: "live",
      live: true,
      value,
      version,
    });
    queue.update([live("short", 1), item("a"), item("b")]);
    expect(queue.take(new Set())).toBe("short");
    // Same version — already played, so the archive gets its turn.
    queue.update([live("short", 1), item("a"), item("b")]);
    expect(queue.take(new Set())).toBe("a");
    // More footage arrived, so it jumps the archive again.
    queue.update([live("longer", 2), item("a"), item("b")]);
    expect(queue.take(new Set())).toBe("longer");
  });

  it("hands players the newest version of a recording they are showing", () => {
    const queue = new InstallationPlaybackQueue<string>();
    queue.update([{ id: "live", live: true, value: "short", version: 1 }]);
    expect(queue.current("live")?.value).toBe("short");
    queue.update([{ id: "live", live: true, value: "longer", version: 2 }]);
    expect(queue.current("live")?.value).toBe("longer");
    queue.update([]);
    expect(queue.current("live")).toBeNull();
  });
});
