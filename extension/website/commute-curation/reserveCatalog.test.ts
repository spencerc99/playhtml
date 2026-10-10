// ABOUTME: Tests reserve catalog validation and mapping into review candidates.
// ABOUTME: Keeps editorial evidence separate from durable human decisions.

import { describe, expect, it } from "vitest";
import { parseReserveCatalog } from "./reserveCatalog";

function artifact(entries: unknown[]) {
  return {
    format: "internet-commute-reserve-catalog/v1",
    generatedAt: "2026-08-21T23:30:00.000Z",
    entries,
  };
}

const entry = {
  url: "https://Poems.Example/work",
  title: "A web poem",
  sourceCollection: "Small Web Journal",
  sourceUrl: "https://journal.example/archive",
  sourceMode: "trusted-editorial",
  issue: "Issue 1",
  section: "individual work",
  tags: ["poetic", "interactive-web", "poetic"],
  interactionLevel: "responsive",
  health: {
    status: "linked-from-live-index",
    note: "Linked from the current issue.",
  },
};

describe("parseReserveCatalog", () => {
  it("maps source evidence into a stop candidate without a verdict", () => {
    expect(parseReserveCatalog(artifact([entry])).items).toEqual([
      {
        id: "https://Poems.Example/work",
        url: "https://Poems.Example/work",
        domain: "poems.example",
        title: "A web poem",
        currentDisposition: "stop",
        reserve: {
          sourceCollection: "Small Web Journal",
          sourceUrl: "https://journal.example/archive",
          sourceMode: "trusted-editorial",
          issue: "Issue 1",
          section: "individual work",
          tags: ["poetic", "interactive-web"],
          interactionLevel: "responsive",
          healthStatus: "linked-from-live-index",
          healthNote: "Linked from the current issue.",
        },
      },
    ]);
  });

  it("rejects duplicate URLs and invalid source modes", () => {
    expect(() => parseReserveCatalog(artifact([entry, entry]))).toThrow(
      "duplicate URLs",
    );
    expect(() =>
      parseReserveCatalog(artifact([{ ...entry, sourceMode: "automatic" }])),
    ).toThrow("source mode");
  });
});
