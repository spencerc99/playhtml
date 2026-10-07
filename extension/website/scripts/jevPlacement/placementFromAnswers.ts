// ABOUTME: Pure mapping from Jev's raw answers to a commute placement, with every
// ABOUTME: threshold in one config object so tuning needs no further API calls.

import type { HandmadeSignals } from "./handmadeSignals";
import { handmadeScore } from "./handmadeSignals";
import type { PlacementAnswers } from "./questions";

/**
 * Placements Jev can derive. `reserve` is human-only and never produced here;
 * Jev's strongest positive signal is `featured-candidate`.
 */
export type DerivedPlacement =
  | "hidden"
  | "scenery"
  | "featured-candidate"
  | "regular";

export type PlacementThresholds = {
  requiresLogin: number;
  personBound: number;
  unsafe: number;
  standsAlone: number;
  care: number;
  humanCommunity: number;
  handmade: number;
  massProduced: number;
  selling: number;
  scenerySurfaceKinds: readonly string[];
  featuredMakers: readonly string[];
};

/**
 * The spec's starting guesses. The hidden gate is tuned for recall: a wrongly
 * hidden page costs nothing, a wrongly shown private page costs trust.
 */
export const DEFAULT_THRESHOLDS: PlacementThresholds = {
  requiresLogin: 0.35,
  personBound: 0.35,
  unsafe: 0.35,
  standsAlone: 0.5,
  care: 2,
  humanCommunity: 0.6,
  handmade: 3,
  massProduced: 0.2,
  selling: 1,
  scenerySurfaceKinds: [
    "feed_or_index",
    "utility_workflow",
    "marketing",
    "platform_home",
  ],
  featuredMakers: [
    "individual",
    "small_group",
    "cultural_or_editorial_institution",
  ],
};

export type PlacementDecision = {
  placement: DerivedPlacement;
  /** Distance to the nearest threshold that would change the placement. */
  margin: number;
  /** The answer keys that decided this placement. */
  triggeredBy: string[];
};

/**
 * Maps raw answers to a placement. The gates run in order: privacy and safety
 * first, then surface kind, then character. Margin is the smallest distance to a
 * threshold whose crossing would move the page to a different placement, so a
 * small margin marks a decision worth a human glance.
 */
export type PlacementContext = {
  signals?: HandmadeSignals | null;
  /** True when the domain is well known enough that featuring adds nothing. */
  popular?: boolean;
};

export function placementFromAnswers(
  answers: PlacementAnswers,
  thresholds: PlacementThresholds = DEFAULT_THRESHOLDS,
  context: PlacementContext = {},
): PlacementDecision {
  const hiddenGates: Array<{ key: string; value: number; threshold: number }> = [
    {
      key: "requires_login",
      value: answers.requires_login.noul,
      threshold: thresholds.requiresLogin,
    },
    {
      key: "person_bound",
      value: answers.person_bound.noul,
      threshold: thresholds.personBound,
    },
    { key: "unsafe", value: answers.unsafe.noul, threshold: thresholds.unsafe },
  ];

  const trippedHidden = hiddenGates.filter(
    (gate) => gate.value > gate.threshold,
  );
  if (trippedHidden.length > 0) {
    const margin = Math.min(
      ...trippedHidden.map((gate) => gate.value - gate.threshold),
    );
    return {
      placement: "hidden",
      margin,
      triggeredBy: trippedHidden.map((gate) => gate.key),
    };
  }

  // Distance to becoming hidden bounds the margin of every placement below it.
  const distanceToHidden = Math.min(
    ...hiddenGates.map((gate) => gate.threshold - gate.value),
  );

  const surfaceKind = answers.surface_kind.choice;
  const scenerySurface = thresholds.scenerySurfaceKinds.includes(surfaceKind);
  const failsStandsAlone = answers.stands_alone.noul < thresholds.standsAlone;

  // A place people fill with their own things is a stop even when its front page
  // looks like a platform or an index. This never reaches past the hidden gate,
  // which has already returned above.
  const isHumanCommunity =
    answers.human_community.noul > thresholds.humanCommunity;

  if ((scenerySurface || failsStandsAlone) && !isHumanCommunity) {
    const triggeredBy: string[] = [];
    const distances: number[] = [distanceToHidden];

    if (scenerySurface) {
      triggeredBy.push("surface_kind");
      // How much of the choice mass sits on scenery kinds; losing that majority
      // is what would move the page off scenery.
      const sceneryMass = thresholds.scenerySurfaceKinds.reduce(
        (total, kind) => total + (answers.surface_kind.probabilities[kind] ?? 0),
        0,
      );
      distances.push(Math.abs(sceneryMass - 0.5));
    }
    if (failsStandsAlone) {
      triggeredBy.push("stands_alone");
      distances.push(thresholds.standsAlone - answers.stands_alone.noul);
    }

    return {
      placement: "scenery",
      margin: Math.min(...distances),
      triggeredBy,
    };
  }

  const featuredChecks: Array<{ key: string; distance: number }> = [
    { key: "care", distance: answers.care.score - thresholds.care },
    {
      key: "mass_produced",
      distance: thresholds.massProduced - answers.mass_produced.noul,
    },
    { key: "selling", distance: thresholds.selling - answers.selling.score },
    {
      key: "maker",
      distance: thresholds.featuredMakers.includes(answers.maker.choice)
        ? answers.maker.confidence
        : -answers.maker.confidence,
    },
  ];

  const failedFeatured = featuredChecks.filter((check) => check.distance < 0);

  if (failedFeatured.length === 0) {
    const margin = Math.min(
      distanceToHidden,
      ...featuredChecks.map((check) => check.distance),
    );
    return capPopular(
      {
        placement: "featured-candidate",
        margin,
        triggeredBy: featuredChecks.map((check) => check.key),
      },
      context,
    );
  }

  // A community of people posting their own things is worth featuring on that
  // basis alone, whatever the care score of the front page.
  if (isHumanCommunity) {
    return capPopular(
      {
        placement: "featured-candidate",
        margin: Math.min(
          distanceToHidden,
          answers.human_community.noul - thresholds.humanCommunity,
        ),
        triggeredBy: ["human_community"],
      },
      context,
    );
  }

  // Handmade markers in the markup carry a page that a text model cannot read,
  // such as a canvas work with a webring and a guestbook and no prose.
  const signalScore = context.signals ? handmadeScore(context.signals) : 0;
  if (
    signalScore >= thresholds.handmade &&
    answers.selling.score <= thresholds.selling
  ) {
    return capPopular(
      {
        placement: "featured-candidate",
        margin: Math.min(distanceToHidden, signalScore - thresholds.handmade),
        triggeredBy: ["handmade_signals"],
      },
      context,
    );
  }

  return {
    placement: "regular",
    margin: Math.min(
      distanceToHidden,
      ...failedFeatured.map((check) => Math.abs(check.distance)),
    ),
    triggeredBy: failedFeatured.map((check) => check.key),
  };
}

/**
 * A domain everyone already knows is capped at an ordinary stop: featuring is
 * for places a rider would not otherwise find.
 */
function capPopular(
  decision: PlacementDecision,
  context: PlacementContext,
): PlacementDecision {
  if (!context.popular || decision.placement !== "featured-candidate") {
    return decision;
  }
  return {
    placement: "regular",
    margin: decision.margin,
    triggeredBy: [...decision.triggeredBy, "popularity_cap"],
  };
}

/**
 * Human `reserve` and `featured` are both stronger-than-regular judgments, and
 * Jev's equivalent top output is `featured-candidate`.
 */
export function matchesExpected(
  expected: string,
  derived: DerivedPlacement,
): boolean {
  if (expected === "featured" || expected === "reserve") {
    return derived === "featured-candidate";
  }
  if (expected === "regular") {
    // "At least a stop": the code fixtures assert a valid destination, which
    // either an ordinary or a featured stop satisfies.
    return derived === "regular" || derived === "featured-candidate";
  }
  return expected === derived;
}
