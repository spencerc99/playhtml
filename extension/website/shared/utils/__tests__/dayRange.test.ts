// ABOUTME: Verifies day spans: ordering picks, whole months, recent-day presets, labels, and URL round trips.
// ABOUTME: Uses local "YYYY-MM-DD" keys only, so the checks hold in any viewer time zone.
import { describe, expect, it } from "vitest";
import {
  dayRangeContains,
  dayRangeLength,
  eachDay,
  formatDayRange,
  isWholeMonth,
  monthOf,
  parseDayRange,
  recentDays,
  serializeDayRange,
  spanBetween,
} from "../dayRange";

describe("day ranges", () => {
  it("orders two picked days whichever comes first", () => {
    expect(spanBetween("2026-10-11", "2026-10-03")).toEqual({
      start: "2026-10-03",
      end: "2026-10-11",
    });
  });

  it("includes both ends and counts calendar days", () => {
    const range = { start: "2026-10-03", end: "2026-10-11" };
    expect(dayRangeContains(range, "2026-10-03")).toBe(true);
    expect(dayRangeContains(range, "2026-10-11")).toBe(true);
    expect(dayRangeContains(range, "2026-10-12")).toBe(false);
    expect(dayRangeLength(range)).toBe(9);
  });

  it("counts days across a daylight-saving change", () => {
    expect(dayRangeLength({ start: "2026-10-30", end: "2026-11-03" })).toBe(5);
  });

  it("lists every day of a span, across a month and a clock change", () => {
    expect(eachDay({ start: "2026-10-30", end: "2026-11-02" })).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });

  it("covers a whole month, including February", () => {
    expect(monthOf("2026-09-17")).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(monthOf("2028-02-10").end).toBe("2028-02-29");
    expect(isWholeMonth(monthOf("2026-09-17"))).toBe(true);
    expect(isWholeMonth({ start: "2026-09-01", end: "2026-09-29" })).toBe(
      false,
    );
  });

  it("reaches back a set number of days, across a month", () => {
    expect(recentDays("2026-10-03", 7)).toEqual({
      start: "2026-09-27",
      end: "2026-10-03",
    });
  });

  it("labels days, spans, months, and year crossings", () => {
    expect(formatDayRange({ start: "2026-10-03", end: "2026-10-03" })).toBe(
      "Oct 3",
    );
    expect(formatDayRange({ start: "2026-10-03", end: "2026-10-11" })).toBe(
      "Oct 3 – 11",
    );
    expect(
      formatDayRange({ start: "2026-09-28", end: "2026-10-04" }, true),
    ).toBe("Sep 28 – Oct 4, 2026");
    expect(formatDayRange(monthOf("2026-09-17"))).toBe("September 2026");
    expect(formatDayRange({ start: "2026-12-30", end: "2027-01-02" })).toBe(
      "Dec 30, 2026 – Jan 2, 2027",
    );
  });

  it("round-trips through the URL and rejects anything else", () => {
    expect(parseDayRange("2026-10-03")).toEqual({
      start: "2026-10-03",
      end: "2026-10-03",
    });
    const range = { start: "2026-10-03", end: "2026-10-11" };
    expect(parseDayRange(serializeDayRange(range))).toEqual(range);
    expect(serializeDayRange({ start: "2026-10-03", end: "2026-10-03" })).toBe(
      "2026-10-03",
    );
    expect(parseDayRange("2026-10-03..soon")).toBeUndefined();
    expect(parseDayRange("yesterday")).toBeUndefined();
  });
});
