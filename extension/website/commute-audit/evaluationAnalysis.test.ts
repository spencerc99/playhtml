// ABOUTME: Tests full-export evaluation reduction, privacy boundaries, metadata joins, and sample lanes.
// ABOUTME: Uses real commute policy and scoring logic with synthetic navigation lifecycles.

import { buildPageRef, canonicalizeUrl, type CollectionEvent } from "@playhtml/extension-types";
import { describe, expect, test } from "vitest";

import { CommuteEvaluationBuilder, type AttentionEventName } from "./evaluationAnalysis";

function navigation(
  id: string,
  ts: number,
  url: string,
  event: "focus" | "blur",
  pid: string,
  title = "",
): CollectionEvent {
  return {
    id,
    type: "navigation",
    ts,
    data: { event, ...(title ? { title } : {}) },
    meta: { pid, sid: `${pid}-session`, url, vw: 1280, vh: 720, tz: "UTC" },
  };
}

const scan = { collectionRows: 4, navigationRows: 4, metadataRows: 0, parseFailures: 0, failureExamples: [] };

describe("CommuteEvaluationBuilder", () => {
  test("pairs attention correctly after out-of-order records are sorted", () => {
    const attention: Array<{ sessionId: number; ts: number; eventName: AttentionEventName; pageId: number }> = [];
    const builder = new CommuteEvaluationBuilder((sessionId, ts, eventName, pageId) => attention.push({ sessionId, ts, eventName, pageId }));
    builder.addNavigation(navigation("2", 121_000, "https://example.com/essay", "blur", "person-a"));
    builder.addNavigation(navigation("1", 1_000, "https://example.com/essay", "focus", "person-a", "An art essay"));
    attention.sort((first, second) => first.sessionId - second.sessionId || first.ts - second.ts || first.eventName.localeCompare(second.eventName));
    for (const row of attention) builder.addOrderedAttention(row.sessionId, row.ts, row.eventName, row.pageId);

    const result = builder.finalize("archive.sql.zst", { ...scan, collectionRows: 2, navigationRows: 2 });
    expect(result.candidates.find((row) => row.url === "https://example.com/essay")?.observation.screenTimeMs).toBe(120_000);
    expect(result.summary.outOfOrderEvents).toBe(1);
  });

  test("keeps raw private URLs out of the evaluation artifact", () => {
    const builder = new CommuteEvaluationBuilder();
    builder.addNavigation(navigation("1", 1_000, "https://example.com/essay", "focus", "person-a", "An art essay"));
    builder.addNavigation(navigation("2", 121_000, "https://example.com/essay", "blur", "person-a"));
    builder.addNavigation(navigation("3", 130_000, "https://mail.google.com/mail/u/0/#inbox/private-message", "focus", "person-b", "Inbox"));
    builder.addNavigation(navigation("4", 150_000, "https://mail.google.com/mail/u/0/#inbox/private-message", "blur", "person-b"));

    const result = builder.finalize("archive.sql.zst", scan);
    expect(result.summary.publicVisits).toBe(1);
    expect(result.summary.privateVisits).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private-message");
  });

  test("withholds sanitized work pages whose titles still contain private context", () => {
    const builder = new CommuteEvaluationBuilder();
    builder.addNavigation(navigation("1", 1_000, "https://feather.computer/brief", "focus", "person-a", "Brief - private.person@example.com"));
    builder.addNavigation(navigation("2", 121_000, "https://feather.computer/brief", "blur", "person-a"));

    const result = builder.finalize("archive.sql.zst", { ...scan, collectionRows: 2, navigationRows: 2 });
    expect(result.summary.privateVisits).toBe(1);
    expect(JSON.stringify(result)).not.toContain("private.person@example.com");
  });

  test("withholds private Google app hosts behind the public registrable domain", () => {
    const builder = new CommuteEvaluationBuilder();
    builder.addNavigation(navigation("1", 1_000, "https://messages.google.com/web/conversations/123", "focus", "person-a", "Google Messages for web: Conversations"));
    builder.addNavigation(navigation("2", 121_000, "https://messages.google.com/web/conversations/123", "blur", "person-a"));

    const result = builder.finalize("archive.sql.zst", { ...scan, collectionRows: 2, navigationRows: 2 });
    expect(result.summary.privateVisits).toBe(1);
    expect(JSON.stringify(result)).not.toContain("Google Messages");
  });

  test("withholds application and payment workflow titles", () => {
    const builder = new CommuteEvaluationBuilder();
    builder.addNavigation(navigation("1", 1_000, "https://travel.example/booking/123", "focus", "person-a", "Flight Booking - Review and Pay"));
    builder.addNavigation(navigation("2", 121_000, "https://travel.example/booking/123", "blur", "person-a"));

    const result = builder.finalize("archive.sql.zst", { ...scan, collectionRows: 2, navigationRows: 2 });
    expect(result.summary.privateVisits).toBe(1);
    expect(JSON.stringify(result)).not.toContain("Review and Pay");
  });

  test("uses current metadata and selects convergence candidates", () => {
    const builder = new CommuteEvaluationBuilder();
    for (const [index, pid] of ["person-a", "person-b"].entries()) {
      builder.addNavigation(navigation(`${index}-1`, 1_000 + index * 200_000, "https://example.com/essay", "focus", pid));
      builder.addNavigation(navigation(`${index}-2`, 121_000 + index * 200_000, "https://example.com/essay", "blur", pid));
    }
    builder.addMetadata({
      pageRef: buildPageRef(canonicalizeUrl("https://example.com/essay")),
      canonicalUrl: "https://example.com/essay",
      title: "An artist writes about museum design",
      faviconUrl: "",
      validFrom: 1_000,
      validTo: null,
    });

    const result = builder.finalize("archive.sql.zst", scan);
    const candidate = result.candidates.find((row) => row.url === "https://example.com/essay");
    expect(candidate?.lanes).toContain("Independent convergence");
    expect(candidate?.category.value).toBe("Arts & culture");
    expect(candidate?.observation.participants).toBe(2);
  });
});
