// ABOUTME: Tests compact time-span formatting for the developer playback console.
// ABOUTME: Keeps long archive ranges from crowding the top instrumentation bar.

import { describe, expect, it } from "vitest";
import { formatCompactTimeSpan } from "../../utils/timeFormat";

describe("formatCompactTimeSpan", () => {
  it("keeps minute, hour, and day spans compact", () => {
    const start = 1_700_000_000_000;

    expect(formatCompactTimeSpan(start, start + 30_000)).toBe("<1m");
    expect(formatCompactTimeSpan(start, start + 12 * 60_000)).toBe("12m");
    expect(formatCompactTimeSpan(start, start + 90 * 60_000)).toBe("1.5h");
    expect(formatCompactTimeSpan(start, start + 36 * 60 * 60_000)).toBe("1.5d");
  });

  it("omits empty and reversed ranges", () => {
    expect(formatCompactTimeSpan(0, 0)).toBe("—");
    expect(formatCompactTimeSpan(200, 100)).toBe("—");
  });
});
