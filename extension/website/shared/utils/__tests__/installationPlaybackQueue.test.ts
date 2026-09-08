// ABOUTME: Tests continuous live-first admissions while archive playback remains available.
// ABOUTME: Covers exhaustion, active-window exclusion, and fresh arrivals during playback.
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
});
