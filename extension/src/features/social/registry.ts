// ABOUTME: The list of social experiments. To add one: drop a module in features/social/ and add it here.
// ABOUTME: To graduate or kill one: cherry-pick (or delete) its file + this line. Flags gate what's live.

import type { SocialExperiment } from "./types";
import { bottlesExperiment } from "./bottles";
import { scissorsExperiment } from "./scissors";
import { hammerExperiment } from "./hammer";

export const SOCIAL_EXPERIMENTS: SocialExperiment[] = [
  bottlesExperiment,
  scissorsExperiment,
  hammerExperiment,
  // quarantineTapeExperiment,  ← added when built
];
