// ABOUTME: Tests page classification, uncertainty, and hidden-gem scoring for the commute evaluator.
// ABOUTME: Covers rare pages, major-platform items, privacy gates, and promotion judgments.

import { describe, expect, test } from "vitest";

import { classifyCharacter, classifyContent, classifyPageType, exposureLabel, formulaScores, initialJudgment, scoreComponents } from "./evaluationModel";
import type { EvaluationCandidate, PageObservation } from "./evaluationTypes";

const observation: PageObservation = {
  visits: 3,
  participants: 2,
  sessions: 2,
  screenTimeMs: 180_000,
  firstSeen: "2026-07-01T00:00:00.000Z",
  lastSeen: new Date().toISOString(),
  domainParticipants: 3,
  domainVisits: 8,
  domainScreenTimeMs: 300_000,
};

describe("evaluation classification", () => {
  test("separates page content from page type", () => {
    expect(classifyContent("https://www.youtube.com/watch?v=abc", "A museum tour").value).toBe("Arts & culture");
    expect(classifyPageType("https://www.youtube.com/watch?v=abc", "A museum tour").value).toBe("Video");
  });

  test("preserves uncertainty for unsupported authorship claims", () => {
    expect(classifyCharacter("https://unfamiliar.example/something", "A page").value).toBe("Uncertain");
  });

  test("uses named public authors as a human-made signal off major platforms", () => {
    expect(classifyCharacter("https://small.example/essay", "An essay", { status: "available", author: "June", checkedAt: "2026-08-15T00:00:00Z" })).toMatchObject({ value: "Human-made", confidence: 0.72, source: "public-metadata" });
  });

  test("keeps private pages out of promotion", () => {
    const category = classifyContent("https://example.com/essay", "An art essay");
    const pageType = classifyPageType("https://example.com/essay", "An art essay");
    const character = classifyCharacter("https://example.com/essay", "An art essay");
    const external = { status: "not-requested" } as const;
    const components = scoreComponents("https://example.com/essay", observation, category, pageType, character, external);
    const candidate = {
      id: "candidate",
      url: "https://example.com/essay",
      title: "An art essay",
      domain: "example.com",
      lanes: ["Random control"],
      observation,
      category,
      pageType,
      exposure: exposureLabel(false),
      character,
      external,
      components,
      scores: formulaScores(components),
    } satisfies Omit<EvaluationCandidate, "initialJudgment" | "reasons">;
    expect(initialJudgment(candidate).value).toBe("Do not promote");
  });

  test("does not infer item rarity from a major platform", () => {
    const category = classifyContent("https://www.youtube.com/watch?v=abc", "A museum tour");
    const pageType = classifyPageType("https://www.youtube.com/watch?v=abc", "A museum tour");
    const character = classifyCharacter("https://www.youtube.com/watch?v=abc", "A museum tour");
    const external = { status: "not-requested" } as const;
    const components = scoreComponents("https://www.youtube.com/watch?v=abc", observation, category, pageType, character, external);
    const candidate = { id: "candidate", url: "https://www.youtube.com/watch?v=abc", title: "A museum tour", domain: "youtube.com", lanes: ["Hidden item on major platform"], observation, category, pageType, exposure: exposureLabel(true), character, external, components, scores: formulaScores(components) } satisfies Omit<EvaluationCandidate, "initialJudgment" | "reasons">;
    expect(initialJudgment(candidate)).toMatchObject({ value: "Uncertain", confidence: 0.72 });
  });

  test("rejects transactional and unavailable destinations", () => {
    const category = classifyContent("https://example.com/jobs/123", "Job Opportunities");
    const pageType = classifyPageType("https://example.com/jobs/123", "Job Opportunities");
    const character = classifyCharacter("https://example.com/jobs/123", "Job Opportunities");
    const external = { status: "not-requested" } as const;
    const components = scoreComponents("https://example.com/jobs/123", observation, category, pageType, character, external);
    const candidate = { id: "candidate", url: "https://example.com/jobs/123", title: "Job Opportunities", domain: "example.com", lanes: ["Random control"], observation, category, pageType, exposure: exposureLabel(true), character, external, components, scores: formulaScores(components) } satisfies Omit<EvaluationCandidate, "initialJudgment" | "reasons">;
    expect(initialJudgment(candidate).value).toBe("Do not promote");
  });

  test("gives independent convergence more value than one-person attention", () => {
    const category = classifyContent("https://example.com/essay", "An art essay");
    const pageType = classifyPageType("https://example.com/essay", "An art essay");
    const character = classifyCharacter("https://example.com/essay", "An art essay");
    const external = { status: "not-requested" } as const;
    const shared = scoreComponents("https://example.com/essay", observation, category, pageType, character, external);
    const solo = scoreComponents("https://example.com/essay", { ...observation, participants: 1 }, category, pageType, character, external);
    expect(shared.convergence).toBeGreaterThan(solo.convergence);
  });
});
