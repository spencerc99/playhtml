// ABOUTME: Tests PostgreSQL COPY decoding for production navigation and metadata export rows.
// ABOUTME: Covers nulls, escaped text, JSON payloads, and timestamp conversion.

import { describe, expect, test } from "vitest";

import { appendCopyLine, decodeCopyField, joinCopyLine, parseMetadataRow, parseNavigationRow } from "./postgresCopy";

describe("decodeCopyField", () => {
  test("decodes COPY nulls and text escapes", () => {
    expect(decodeCopyField("\\N")).toBeNull();
    expect(decodeCopyField("line\\nnext\\tvalue\\\\tail")).toBe("line\nnext\tvalue\\tail");
  });
});

describe("appendCopyLine", () => {
  test("holds physical line fragments until a logical COPY record has every field", () => {
    const firstLine = "id\tref\turl\ttitle";
    expect(appendCopyLine(null, firstLine, 9)).toBe(firstLine);
    expect(appendCopyLine(firstLine, "continued\tfavicon\thash\tfrom\t\\N\tcreated", 9)).toBeNull();
  });

  test("preserves JSON string newlines through COPY decoding", () => {
    const firstLine = ["id", "navigation", "2026-08-15 12:00:00+00", "person", "session", "https://example.com", "1280", "720", "UTC", '{"event":"focus","title":"first'].join("\t");
    const record = joinCopyLine(firstLine, 'second"}', "\\\\n");
    expect(parseNavigationRow(record)?.data).toEqual({ event: "focus", title: "first\nsecond" });
  });
});

describe("parseNavigationRow", () => {
  test("skips non-navigation rows", () => {
    expect(parseNavigationRow(["id", "cursor", "ts", "pid", "sid", "url", "0", "0", "tz", "{}"].join("\t"))).toBeNull();
  });

  test("creates the shared event shape", () => {
    const row = [
      "event-id",
      "navigation",
      "2026-08-15 12:00:00+00",
      "person",
      "session",
      "https://example.com/essay",
      "1280",
      "720",
      "America/Los_Angeles",
      '{"event":"focus","page_ref":"pr_123"}',
    ].join("\t");
    expect(parseNavigationRow(row)).toMatchObject({
      id: "event-id",
      ts: Date.parse("2026-08-15T12:00:00Z"),
      data: { event: "focus", page_ref: "pr_123" },
      meta: { pid: "person", sid: "session", url: "https://example.com/essay", vw: 1280, vh: 720 },
    });
  });
});

describe("parseMetadataRow", () => {
  test("decodes current page metadata", () => {
    const row = [
      "id",
      "pr_123",
      "https://example.com/essay",
      "An Essay",
      "https://example.com/favicon.ico",
      "mh_123",
      "2026-08-15 12:00:00+00",
      "\\N",
      "2026-08-15 12:00:01+00",
    ].join("\t");
    expect(parseMetadataRow(row)).toMatchObject({ pageRef: "pr_123", title: "An Essay", validTo: null });
  });

  test("accepts empty titles and favicons stored in non-null columns", () => {
    const row = [
      "id",
      "pr_123",
      "https://example.com/essay",
      "",
      "",
      "mh_123",
      "2026-08-15 12:00:00+00",
      "\\N",
      "2026-08-15 12:00:01+00",
    ].join("\t");
    expect(parseMetadataRow(row)).toMatchObject({ title: "", faviconUrl: "" });
  });
});
