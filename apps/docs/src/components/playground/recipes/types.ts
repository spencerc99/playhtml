// ABOUTME: Defines the metadata and source shared by docs examples and the playground.
// ABOUTME: Keeps catalogue cards, example pages, and runnable recipes on one contract.

export type ExampleDifficulty = "starter" | "intermediate" | "advanced";

export type RunnableRecipe = {
  id: string;
  html: string;
};

export type ExampleRecipe = RunnableRecipe & {
  title: string;
  description: string;
  tags: readonly string[];
  capabilities: readonly string[];
  difficulty: ExampleDifficulty;
  docsHref: `/docs/examples/${string}/`;
};

export type ExampleRecipeSummary = Omit<ExampleRecipe, "html">;
