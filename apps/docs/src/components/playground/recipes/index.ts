// ABOUTME: Registers every canonical example available in the docs and playground.
// ABOUTME: Exposes metadata without HTML for the searchable examples catalogue.
import { starterRecipe } from "./_starter";
import {
  canHoverRecipe,
  canMoveRecipe,
  canToggleRecipe,
} from "./built-in-capabilities";
import { matterPhysicsRecipe } from "./matter-physics";
import { emojiMirrorRecipe, growingListMirrorRecipe } from "./mirror-basics";
import { sharedAudioFileRecipe } from "./shared-audio-file";
import {
  sharedCounterRecipe,
  sharedGuestbookRecipe,
} from "./shared-state-basics";
import { synchronizedSoundRecipe } from "./synchronized-sound";
import type { ExampleRecipeSummary, RunnableRecipe } from "./types";

export const exampleRecipes = [
  canMoveRecipe,
  canToggleRecipe,
  canHoverRecipe,
  emojiMirrorRecipe,
  growingListMirrorRecipe,
  sharedCounterRecipe,
  sharedGuestbookRecipe,
  sharedAudioFileRecipe,
  synchronizedSoundRecipe,
  matterPhysicsRecipe,
];
export const playableRecipes: readonly RunnableRecipe[] = [
  starterRecipe,
  ...exampleRecipes,
];

export const exampleRecipeSummaries: ExampleRecipeSummary[] =
  exampleRecipes.map(({ html: _html, react: _react, ...summary }) => summary);

export function getPlayableRecipe(id: string): RunnableRecipe | undefined {
  return playableRecipes.find((recipe) => recipe.id === id);
}
