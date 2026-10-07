// ABOUTME: Tests the pure answers-to-placement mapping against real-shaped Jev
// ABOUTME: answer objects, covering each gate, the margins, and expected matching.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_THRESHOLDS,
  matchesExpected,
  placementFromAnswers,
} from "../placementFromAnswers";
import type { PlacementAnswers } from "../questions";

function noul(value: number) {
  return { type: "noul" as const, noul: value };
}

function choice(
  picked: string,
  probabilities: Record<string, number>,
  confidence: number,
) {
  return {
    type: "choice" as const,
    choice: picked,
    probabilities,
    confidence,
  };
}

function score(
  value: number,
  probabilities: Record<string, number>,
  confidence: number,
) {
  return {
    type: "score" as const,
    score: value,
    legend: {},
    probabilities,
    confidence,
  };
}

/** A crafted personal page: passes every gate and reaches featured-candidate. */
function craftedPersonalPage(): PlacementAnswers {
  return {
    requires_login: noul(0.02),
    person_bound: noul(0.03),
    unsafe: noul(0.01),
    surface_kind: choice(
      "made_thing",
      { made_thing: 0.82, personal_home: 0.12, feed_or_index: 0.06 },
      0.8,
    ),
    stands_alone: noul(0.94),
    human_community: noul(0.05),
    maker: choice("individual", { individual: 0.88, small_group: 0.12 }, 0.86),
    care: score(3.6, { "3": 0.5, "4": 0.4, "2": 0.1 }, 0.72),
    selling: score(0.2, { "0": 0.82, "1": 0.15, "2": 0.03 }, 0.8),
    mass_produced: noul(0.04),
    reason: choice(
      "editorial-or-cultural",
      { "editorial-or-cultural": 0.77, "standalone-tool": 0.23 },
      0.75,
    ),
  };
}

describe("placementFromAnswers", () => {
  it("hides a page behind a login wall", () => {
    const answers = craftedPersonalPage();
    answers.requires_login = noul(0.91);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("hidden");
    expect(result.triggeredBy).toEqual(["requires_login"]);
    expect(result.margin).toBeCloseTo(0.91 - DEFAULT_THRESHOLDS.requiresLogin, 5);
  });

  it("hides a page bound to one account holder", () => {
    const answers = craftedPersonalPage();
    answers.person_bound = noul(0.78);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("hidden");
    expect(result.triggeredBy).toEqual(["person_bound"]);
  });

  it("reports every tripped hidden gate and the smallest of their margins", () => {
    const answers = craftedPersonalPage();
    answers.requires_login = noul(0.95);
    answers.unsafe = noul(0.4);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("hidden");
    expect(result.triggeredBy).toEqual(["requires_login", "unsafe"]);
    expect(result.margin).toBeCloseTo(0.4 - DEFAULT_THRESHOLDS.unsafe, 5);
  });

  it("sends a feed or index surface to scenery", () => {
    const answers = craftedPersonalPage();
    answers.surface_kind = choice(
      "feed_or_index",
      { feed_or_index: 0.71, made_thing: 0.29 },
      0.7,
    );

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("scenery");
    expect(result.triggeredBy).toContain("surface_kind");
  });

  it("sends a page that does not stand alone to scenery", () => {
    const answers = craftedPersonalPage();
    answers.stands_alone = noul(0.18);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("scenery");
    expect(result.triggeredBy).toEqual(["stands_alone"]);
    expect(result.margin).toBeCloseTo(DEFAULT_THRESHOLDS.standsAlone - 0.18, 5);
  });

  it("promotes a crafted page by an individual to featured-candidate", () => {
    const result = placementFromAnswers(craftedPersonalPage());

    expect(result.placement).toBe("featured-candidate");
    expect(result.margin).toBeGreaterThan(0);
  });

  it("keeps a competent but unremarkable page as regular", () => {
    const answers = craftedPersonalPage();
    answers.care = score(1.4, { "1": 0.7, "2": 0.2, "0": 0.1 }, 0.66);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("regular");
    expect(result.triggeredBy).toEqual(["care"]);
    // The care shortfall is 0.9, but the margin is bounded by the nearer hidden
    // gate, so it reports the distance to that instead.
    expect(result.margin).toBeCloseTo(DEFAULT_THRESHOLDS.personBound - 0.03, 5);
  });

  it("keeps a crafted page that exists to sell as regular", () => {
    const answers = craftedPersonalPage();
    answers.selling = score(2.8, { "3": 0.6, "2": 0.35, "1": 0.05 }, 0.7);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("regular");
    expect(result.triggeredBy).toEqual(["selling"]);
  });

  it("keeps a company-made page as regular however crafted", () => {
    const answers = craftedPersonalPage();
    answers.maker = choice("company", { company: 0.9, individual: 0.1 }, 0.88);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("regular");
    expect(result.triggeredBy).toEqual(["maker"]);
  });

  it("keeps bulk-produced text as regular", () => {
    const answers = craftedPersonalPage();
    answers.mass_produced = noul(0.83);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("regular");
    expect(result.triggeredBy).toEqual(["mass_produced"]);
  });

  it("runs the hidden gate before the scenery gate", () => {
    const answers = craftedPersonalPage();
    answers.person_bound = noul(0.9);
    answers.surface_kind = choice(
      "feed_or_index",
      { feed_or_index: 0.9, made_thing: 0.1 },
      0.88,
    );

    expect(placementFromAnswers(answers).placement).toBe("hidden");
  });

  it("bounds a featured margin by the distance to the hidden gate", () => {
    const answers = craftedPersonalPage();
    answers.person_bound = noul(0.34);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("featured-candidate");
    expect(result.margin).toBeCloseTo(DEFAULT_THRESHOLDS.personBound - 0.34, 5);
  });

  it("honours overridden thresholds without touching the defaults", () => {
    const answers = craftedPersonalPage();
    answers.care = score(1.4, { "1": 0.7, "2": 0.3 }, 0.66);

    const relaxed = placementFromAnswers(answers, {
      ...DEFAULT_THRESHOLDS,
      care: 1,
    });

    expect(relaxed.placement).toBe("featured-candidate");
    expect(placementFromAnswers(answers).placement).toBe("regular");
    expect(DEFAULT_THRESHOLDS.care).toBe(2);
  });
});

describe("human_community override", () => {
  /** A busy place people fill with their own listings, games, or posts. */
  function communityPlatform(): PlacementAnswers {
    const answers = craftedPersonalPage();
    answers.human_community = noul(0.93);
    answers.surface_kind = choice(
      "platform_home",
      { platform_home: 0.86, feed_or_index: 0.14 },
      0.84,
    );
    answers.maker = choice(
      "large_platform_user_content",
      { large_platform_user_content: 0.81, company: 0.19 },
      0.79,
    );
    answers.care = score(1.6, { "1": 0.5, "2": 0.4, "0": 0.1 }, 0.6);
    return answers;
  }

  it("keeps a community platform out of scenery despite its surface kind", () => {
    const result = placementFromAnswers(communityPlatform());

    expect(result.placement).toBe("featured-candidate");
    expect(result.triggeredBy).toEqual(["human_community"]);
  });

  it("keeps a community out of scenery when it does not stand alone", () => {
    const answers = communityPlatform();
    answers.surface_kind = choice(
      "made_thing",
      { made_thing: 0.9, feed_or_index: 0.1 },
      0.88,
    );
    answers.stands_alone = noul(0.12);

    expect(placementFromAnswers(answers).placement).toBe("featured-candidate");
  });

  it("leaves a low human_community page on the scenery path", () => {
    const answers = communityPlatform();
    answers.human_community = noul(0.2);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("scenery");
    expect(result.triggeredBy).toContain("surface_kind");
  });

  it("does not override the hidden gate", () => {
    const answers = communityPlatform();
    answers.requires_login = noul(0.88);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("hidden");
    expect(result.triggeredBy).toEqual(["requires_login"]);
  });

  it("does not override the hidden gate for unsafe content", () => {
    const answers = communityPlatform();
    answers.unsafe = noul(0.74);

    expect(placementFromAnswers(answers).placement).toBe("hidden");
  });

  it("promotes a community whose care score alone would not reach featured", () => {
    const answers = communityPlatform();
    answers.care = score(0.9, { "0": 0.4, "1": 0.5, "2": 0.1 }, 0.55);

    const result = placementFromAnswers(answers);

    expect(result.placement).toBe("featured-candidate");
    expect(result.triggeredBy).toEqual(["human_community"]);
  });

  it("honours an overridden human_community threshold", () => {
    const answers = communityPlatform();
    answers.human_community = noul(0.5);

    expect(placementFromAnswers(answers).placement).toBe("scenery");
    expect(
      placementFromAnswers(answers, {
        ...DEFAULT_THRESHOLDS,
        humanCommunity: 0.4,
      }).placement,
    ).toBe("featured-candidate");
  });
});

describe("handmade signals path", () => {
  /** Markup markers of a hand-built site: badge, webring, guestbook, feed. */
  function handmadeSignals() {
    return {
      badge88x31: true,
      webring: true,
      guestbook: true,
      feed: true,
      relMe: false,
      adTrackerCount: 0,
      cookieBanner: false,
      checkout: false,
    };
  }

  /** A canvas work: Jev sees no text, so care and community read low. */
  function wordlessCanvasPage(): PlacementAnswers {
    const answers = craftedPersonalPage();
    answers.care = score(0.8, { "0": 0.5, "1": 0.4, "2": 0.1 }, 0.55);
    answers.human_community = noul(0.05);
    answers.maker = choice("cannot_tell", { cannot_tell: 0.8, individual: 0.2 }, 0.7);
    return answers;
  }

  it("suggests featuring a wordless page carrying handmade markers", () => {
    const result = placementFromAnswers(wordlessCanvasPage(), DEFAULT_THRESHOLDS, {
      signals: handmadeSignals(),
    });

    expect(result.placement).toBe("featured-candidate");
    expect(result.triggeredBy).toEqual(["handmade_signals"]);
  });

  it("leaves the same page as regular with no signals", () => {
    expect(
      placementFromAnswers(wordlessCanvasPage(), DEFAULT_THRESHOLDS, {}).placement,
    ).toBe("regular");
  });

  it("does not use handmade signals to escape the hidden gate", () => {
    const answers = wordlessCanvasPage();
    answers.requires_login = noul(0.9);

    const result = placementFromAnswers(answers, DEFAULT_THRESHOLDS, {
      signals: handmadeSignals(),
    });

    expect(result.placement).toBe("hidden");
  });

  it("withholds the handmade path from a page that exists to sell", () => {
    const answers = wordlessCanvasPage();
    answers.selling = score(2.9, { "3": 0.7, "2": 0.3 }, 0.72);

    const result = placementFromAnswers(answers, DEFAULT_THRESHOLDS, {
      signals: handmadeSignals(),
    });

    expect(result.placement).toBe("regular");
  });

  it("ignores weak signals below the threshold", () => {
    const weak = { ...handmadeSignals(), badge88x31: false, webring: false, guestbook: false };

    expect(
      placementFromAnswers(wordlessCanvasPage(), DEFAULT_THRESHOLDS, {
        signals: weak,
      }).placement,
    ).toBe("regular");
  });
});

describe("popularity cap", () => {
  it("caps a well-known domain at an ordinary stop", () => {
    const result = placementFromAnswers(craftedPersonalPage(), DEFAULT_THRESHOLDS, {
      popular: true,
    });

    expect(result.placement).toBe("regular");
    expect(result.triggeredBy).toContain("popularity_cap");
  });

  it("caps a community platform too", () => {
    const answers = craftedPersonalPage();
    answers.human_community = noul(0.95);
    answers.surface_kind = choice("platform_home", { platform_home: 0.9 }, 0.9);

    expect(
      placementFromAnswers(answers, DEFAULT_THRESHOLDS, { popular: true }).placement,
    ).toBe("regular");
  });

  it("leaves an unlisted site uncapped", () => {
    expect(
      placementFromAnswers(craftedPersonalPage(), DEFAULT_THRESHOLDS, {
        popular: false,
      }).placement,
    ).toBe("featured-candidate");
  });

  it("never turns a hidden page into a stop", () => {
    const answers = craftedPersonalPage();
    answers.person_bound = noul(0.9);

    expect(
      placementFromAnswers(answers, DEFAULT_THRESHOLDS, { popular: true }).placement,
    ).toBe("hidden");
  });
});

describe("matchesExpected", () => {
  it("treats human featured and reserve as featured-candidate", () => {
    expect(matchesExpected("featured", "featured-candidate")).toBe(true);
    expect(matchesExpected("reserve", "featured-candidate")).toBe(true);
    expect(matchesExpected("featured", "regular")).toBe(false);
  });

  it("counts a featured-candidate as satisfying an at-least-a-stop label", () => {
    expect(matchesExpected("regular", "regular")).toBe(true);
    expect(matchesExpected("regular", "featured-candidate")).toBe(true);
    expect(matchesExpected("regular", "scenery")).toBe(false);
  });

  it("matches hidden and scenery exactly", () => {
    expect(matchesExpected("hidden", "hidden")).toBe(true);
    expect(matchesExpected("scenery", "scenery")).toBe(true);
    expect(matchesExpected("scenery", "regular")).toBe(false);
  });
});
