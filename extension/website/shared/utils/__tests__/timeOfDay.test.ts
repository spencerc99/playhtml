// ABOUTME: Verifies local-day keys and recurring time-of-day windows, including ones that wrap past midnight.
// ABOUTME: Builds timestamps from local date parts so the checks hold in any viewer time zone.
import { describe, expect, it } from "vitest";
import {
  formatTimeOfDay,
  hhmmToMinutes,
  localDayKey,
  minutesToHHMM,
  timeOfDayMatches,
} from "../timeOfDay";

const at = (hour: number, minute: number, day = 3) =>
  new Date(2026, 8, day, hour, minute).getTime();

describe("localDayKey", () => {
  it("names the viewer's local calendar day, even a minute either side of midnight", () => {
    expect(localDayKey(at(0, 0))).toBe("2026-09-03");
    expect(localDayKey(at(23, 59))).toBe("2026-09-03");
    expect(localDayKey(at(0, 1, 4))).toBe("2026-09-04");
  });
});

describe("timeOfDayMatches", () => {
  const morning = { centerMinutes: 9 * 60, radiusMinutes: 180 };

  it("matches inside the window with inclusive edges", () => {
    expect(timeOfDayMatches(at(6, 0), morning)).toBe(true);
    expect(timeOfDayMatches(at(10, 30), morning)).toBe(true);
    expect(timeOfDayMatches(at(12, 0), morning)).toBe(true);
    expect(timeOfDayMatches(at(12, 1), morning)).toBe(false);
    expect(timeOfDayMatches(at(5, 59), morning)).toBe(false);
  });

  it("wraps a window centred near midnight across both days", () => {
    const lateNight = { centerMinutes: 0, radiusMinutes: 60 };
    expect(timeOfDayMatches(at(23, 10), lateNight)).toBe(true);
    expect(timeOfDayMatches(at(0, 50), lateNight)).toBe(true);
    expect(timeOfDayMatches(at(22, 59), lateNight)).toBe(false);
    expect(timeOfDayMatches(at(1, 1), lateNight)).toBe(false);

    const pastMidnight = { centerMinutes: 23 * 60, radiusMinutes: 120 };
    expect(timeOfDayMatches(at(0, 45), pastMidnight)).toBe(true);
    expect(timeOfDayMatches(at(21, 0), pastMidnight)).toBe(true);
    expect(timeOfDayMatches(at(1, 30), pastMidnight)).toBe(false);
  });

  it("ignores which day the moment fell on", () => {
    expect(timeOfDayMatches(at(9, 0, 1), morning)).toBe(true);
    expect(timeOfDayMatches(at(9, 0, 20), morning)).toBe(true);
  });
});

describe("time-of-day formatting", () => {
  it("round-trips HH:MM and wraps the window's edges past midnight", () => {
    expect(minutesToHHMM(0)).toBe("00:00");
    expect(minutesToHHMM(-30)).toBe("23:30");
    expect(hhmmToMinutes("07:05")).toBe(425);
    expect(hhmmToMinutes("24:00")).toBeNull();
    expect(formatTimeOfDay({ centerMinutes: 23 * 60, radiusMinutes: 120 })).toBe(
      "21:00–01:00",
    );
  });
});
