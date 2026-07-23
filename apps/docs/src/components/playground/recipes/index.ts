// ABOUTME: Registers every canonical example available in the docs and playground.
// ABOUTME: Exposes metadata without HTML for the searchable examples catalogue.
import { starterRecipe } from "./_starter";
import { matterPhysicsRecipe } from "./matter-physics";
import { sharedAudioFileRecipe } from "./shared-audio-file";
import { synchronizedSoundRecipe } from "./synchronized-sound";
import type { ExampleRecipeSummary, RunnableRecipe } from "./types";

export const exampleRecipes = [
  sharedAudioFileRecipe,
  synchronizedSoundRecipe,
  matterPhysicsRecipe,
];
export const playableRecipes: readonly RunnableRecipe[] = [starterRecipe, ...exampleRecipes];

export const exampleRecipeSummaries: ExampleRecipeSummary[] = exampleRecipes.map(
  ({ html: _html, ...summary }) => summary,
);

export function getPlayableRecipe(id: string): RunnableRecipe | undefined {
  return playableRecipes.find((recipe) => recipe.id === id);
}
