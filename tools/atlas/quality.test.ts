// ABOUTME: Verifies Atlas door-opener quality signals and scoring.
// ABOUTME: Covers downstream engagement, participant novelty, caps, and qualification.

import { describe, expect, test } from "bun:test";
import {
  aggregateSession,
  countParticipantSpringboards,
  qualityComponents,
  scoreDomains,
  type DomainAggregate,
  type ParticipantVisit,
  type SessionEvent,
} from "./quality";

function event(
  domain: string,
  timestamp: number,
  eventClass: SessionEvent["eventClass"],
  ordinal: number,
): SessionEvent {
  return {
    sessionId: "session-1",
    timestamp,
    ordinal,
    participantId: "participant-1",
    domain,
    url: `https://${domain}/`,
    eventClass,
    utcDay: 1,
  };
}

function visit(
  domain: string,
  fromDomain: string | null,
  timestamp: number,
  downstreamEngagedMs: number,
): ParticipantVisit {
  return {
    participantId: "participant-1",
    timestamp,
    sessionId: "session-1",
    ordinal: timestamp,
    domain,
    fromDomain,
    downstreamEngagedMs,
  };
}

function domain(overrides: Partial<DomainAggregate> = {}): DomainAggregate {
  return {
    domain: "example.com",
    quality: 0,
    engagedMs: 12_000_000,
    sessions: 10,
    participants: 10,
    returnDays: 30,
    breadthMean: 20,
    springboards: 5,
    downstreamMs: 1_500_000,
    ...overrides,
  };
}

describe("downstream springboards", () => {
  test("carries destination engagement into the participant-ordered pass", () => {
    const result = aggregateSession([
      event("a.test", 0, "start", 1),
      event("b.test", 1_000, "start", 2),
      event("b.test", 301_000, "end", 3),
    ]);

    expect(result.visits[1]).toMatchObject({
      domain: "b.test",
      fromDomain: "a.test",
      downstreamEngagedMs: 300_000,
    });
  });

  test("credits only new destinations and caps each launch at ten minutes", () => {
    const signals = countParticipantSpringboards([
      visit("a.test", null, 0, 0),
      visit("b.test", "a.test", 1, 900_000),
      visit("a.test", "b.test", 2, 1_000),
      visit("b.test", "a.test", 3, 300_000),
    ]);

    expect(signals.get("a.test")).toEqual({
      springboards: 1,
      downstreamMs: 600_000,
    });
    expect(signals.has("b.test")).toBe(false);
  });
});

describe("quality v4", () => {
  test("uses reach, generosity, launch, and return without marathon depth", () => {
    const shallow = domain({ engagedMs: 1 });
    const marathon = domain({ engagedMs: 1_000_000_000 });

    expect(qualityComponents(shallow)).toEqual({
      reach: 0.4,
      generosity: 1,
      launch: 1,
      return: 1,
    });
    expect(scoreDomains([shallow])[0].quality).toBe(
      scoreDomains([marathon])[0].quality,
    );
  });

  test("qualifies two participants and four sessions", () => {
    const qualified = domain({ participants: 2, sessions: 4, returnDays: 6 });
    const tooFewSessions = domain({
      domain: "short.test",
      participants: 2,
      sessions: 3,
    });

    const result = scoreDomains([qualified, tooFewSessions]);
    expect(
      result.find((entry) => entry.domain === "example.com")!.quality,
    ).toBeGreaterThan(0);
    expect(result.find((entry) => entry.domain === "short.test")!.quality).toBe(
      0,
    );
  });
});
