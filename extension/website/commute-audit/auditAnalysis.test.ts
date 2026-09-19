// ABOUTME: Tests commute audit categorization, privacy boundaries, and aggregate scoring.
// ABOUTME: Uses real reduction logic with synthetic navigation lifecycle events.

import type { CollectionEvent } from "@playhtml/extension-types";
import { describe, expect, test } from "vitest";

import { categorizePage, HistoryAuditBuilder } from "./auditAnalysis";

function navigation(
  id: string,
  ts: number,
  url: string,
  event: "focus" | "blur",
  pid = "person-a",
  title = "",
): CollectionEvent {
  return {
    id,
    type: "navigation",
    ts,
    data: { event, title },
    meta: { pid, sid: `${pid}-session`, url, vw: 1280, vh: 720, tz: "UTC" },
  };
}

describe("categorizePage", () => {
  test("uses domain and page context for deterministic categories", () => {
    expect(categorizePage("https://en.wikipedia.org/wiki/Train", "Train")).toBe("Learning & reference");
    expect(categorizePage("https://example.com/story", "A museum archive")).toBe("Arts & culture");
    expect(categorizePage("https://unfamiliar.example/path", "Unlabeled page")).toBe("Other");
  });
});

describe("HistoryAuditBuilder", () => {
  test("keeps private URLs out of output and pairs screen time", () => {
    const builder = new HistoryAuditBuilder();
    builder.addEvents([
      navigation("1", 1_000, "https://en.wikipedia.org/wiki/Train?tracking=secret", "focus", "person-a", "Train"),
      navigation("2", 61_000, "https://en.wikipedia.org/wiki/Train?tracking=secret", "blur"),
      navigation("3", 70_000, "https://mail.google.com/mail/u/0/#inbox/private", "focus", "person-b", "Inbox"),
      navigation("4", 100_000, "https://mail.google.com/mail/u/0/#inbox/private", "blur", "person-b", "Inbox"),
    ]);

    const result = builder.finalize("2026-01-01", "2026-01-02");
    expect(result.summary.focusVisits).toBe(2);
    expect(result.summary.pairedScreenTimeMs).toBe(90_000);
    expect(result.summary.publicVisits).toBe(1);
    expect(result.summary.privateVisits).toBe(1);
    expect(result.rankedPages[0]?.url).toBe("https://en.wikipedia.org/wiki/Train");
    expect(JSON.stringify(result)).not.toContain("inbox/private");
  });

  test("labels observed reach from distinct participants", () => {
    const builder = new HistoryAuditBuilder();
    builder.addEvents([
      navigation("1", 1_000, "https://example.com/article", "focus", "person-a", "Article"),
      navigation("2", 2_000, "https://example.com/article", "focus", "person-b", "Article"),
    ]);
    const result = builder.finalize("2026-01-01", "2026-01-02");
    expect(result.domains.find((domain) => domain.domain === "example.com")?.reach).toBe("Shared");
  });

  test("keeps path-aware categories separate on a multipurpose domain", () => {
    const builder = new HistoryAuditBuilder();
    builder.addEvents([
      navigation("1", 1_000, "https://example.com/travel/flight", "focus", "person-a", "Book a flight"),
      navigation("2", 2_000, "https://example.com/reference/api", "focus", "person-a", "API reference"),
    ]);
    const result = builder.finalize("2026-01-01", "2026-01-02");
    expect(result.categories.find((row) => row.category === "Travel & places")?.visits).toBe(1);
    expect(result.categories.find((row) => row.category === "Technology")?.visits).toBe(1);
  });
});
