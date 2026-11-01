// ABOUTME: Verifies the archive's fixed fetch covers local days, one request per day across a span.
// ABOUTME: Builds expected instants from local dates, so the checks hold in any viewer time zone.
import { describe, expect, it } from "vitest";
import { archiveSpanRequests } from "../useArchiveEvents";

const localIso = (day: string, time: string) =>
  new Date(`${day}T${time}`).toISOString();

describe("archiveSpanRequests", () => {
  it("bounds a single day by its local midnights", () => {
    expect(
      archiveSpanRequests({ start: "2026-10-03", end: "2026-10-03" }, null),
    ).toEqual([
      {
        from: localIso("2026-10-03", "00:00:00"),
        to: localIso("2026-10-03", "23:59:59.999"),
        limit: "5000",
      },
    ]);
  });

  it("asks for every day of a span, sharing the budget", () => {
    const requests = archiveSpanRequests(
      { start: "2026-10-01", end: "2026-10-31" },
      null,
    );
    expect(requests).toHaveLength(31);
    expect(requests[0].from).toBe(localIso("2026-10-01", "00:00:00"));
    expect(requests[30].to).toBe(localIso("2026-10-31", "23:59:59.999"));
    expect(new Set(requests.map((request) => request.limit))).toEqual(
      new Set(["646"]),
    );
  });

  it("keeps the whole last evening of a span with a time of day", () => {
    const evenings = { centerMinutes: 1260, radiusMinutes: 180 };
    const requests = archiveSpanRequests(
      { start: "2026-10-30", end: "2026-10-31" },
      evenings,
    );
    expect(requests.map(({ from, to }) => ({ from, to }))).toEqual([
      {
        from: localIso("2026-10-30", "17:59:00"),
        to: new Date(
          new Date("2026-10-30T00:00:00").getTime() + 1441 * 60_000,
        ).toISOString(),
      },
      {
        from: localIso("2026-10-31", "17:59:00"),
        to: new Date(
          new Date("2026-10-31T00:00:00").getTime() + 1441 * 60_000,
        ).toISOString(),
      },
    ]);
  });

  it("never asks a long span's days for fewer than a floor of events", () => {
    const requests = archiveSpanRequests(
      { start: "2026-01-01", end: "2026-12-31" },
      null,
    );
    expect(requests).toHaveLength(365);
    expect(requests[0].limit).toBe("250");
  });
});
