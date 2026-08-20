// ABOUTME: Lists every repo-owned example shown in the searchable docs catalogue.
// ABOUTME: Combines complete playground recipes with smaller demos embedded in guide pages.

import { exampleRecipeSummaries } from "../playground/recipes";
import type { ExampleDifficulty } from "../playground/recipes/types";

export type CatalogueExampleSummary = {
  id: string;
  title: string;
  description: string;
  tags: readonly string[];
  capabilities: readonly string[];
  difficulty: ExampleDifficulty;
  docsHref: string;
  kind: "recipe" | "docs-demo";
  remixId?: string;
};

const docsDemoSummaries: CatalogueExampleSummary[] = [
  {
    id: "can-grow-demo",
    title: "Grow a balloon",
    description: "Grow or shrink a balloon and share its current scale.",
    tags: ["scale", "click", "React"],
    capabilities: ["can-grow"],
    difficulty: "starter",
    docsHref: "/docs/capabilities/#can-grow",
    kind: "docs-demo",
  },
  {
    id: "can-spin-demo",
    title: "Spin a wheel",
    description: "Drag a wheel to rotate it for everyone on the page.",
    tags: ["rotation", "dragging", "React"],
    capabilities: ["can-spin"],
    difficulty: "starter",
    docsHref: "/docs/capabilities/#can-spin",
    kind: "docs-demo",
  },
  {
    id: "can-duplicate-demo",
    title: "Duplicate rabbits",
    description:
      "Create shared copies from one template and reset the collection.",
    tags: ["cloning", "dynamic elements", "React"],
    capabilities: ["can-duplicate"],
    difficulty: "intermediate",
    docsHref: "/docs/capabilities/#can-duplicate",
    kind: "docs-demo",
  },
  {
    id: "doodle-strip-demo",
    title: "Shared doodle strip",
    description:
      "Draw a tiny face and add it to a shared strip capped at 20 doodles.",
    tags: ["drawing", "canvas", "shared list"],
    capabilities: ["can-play"],
    difficulty: "intermediate",
    docsHref: "/docs/custom-elements/#play-doodle",
    kind: "docs-demo",
  },
  {
    id: "shared-prize-wheel-demo",
    title: "Shared prize wheel",
    description:
      "Run one seeded animation so every reader lands on the same result.",
    tags: ["animation", "requestUpdate", "shared seed"],
    capabilities: ["can-play"],
    difficulty: "advanced",
    docsHref: "/docs/custom-elements/#play-spinner",
    kind: "docs-demo",
  },
  {
    id: "mirror-controls-playground",
    title: "Native controls mirror playground",
    description:
      "Test shared forms, contenteditable fields, hover, focus, and nested elements.",
    tags: ["forms", "contenteditable", "playground"],
    capabilities: ["can-mirror"],
    difficulty: "advanced",
    docsHref: "/docs/advanced/mirror-playground/#hover",
    kind: "docs-demo",
  },
  {
    id: "rain-event-demo",
    title: "Send a rain event",
    description:
      "Trigger a temporary rain effect for everyone currently connected.",
    tags: ["events", "animation", "transient"],
    capabilities: [],
    difficulty: "intermediate",
    docsHref: "/docs/data/events/#rain-event-demo",
    kind: "docs-demo",
  },
  {
    id: "live-reactions-demo",
    title: "Live reactions",
    description:
      "Broadcast short-lived emoji reactions without storing shared state.",
    tags: ["events", "emoji", "transient"],
    capabilities: [],
    difficulty: "intermediate",
    docsHref: "/docs/data/events/#live-reactions-demo",
    kind: "docs-demo",
  },
  {
    id: "online-indicator-demo",
    title: "Online presence indicator",
    description:
      "Show one live colored dot for each reader currently on the page.",
    tags: ["presence", "online", "React"],
    capabilities: [],
    difficulty: "intermediate",
    docsHref: "/docs/data/presence/#online-indicator-demo",
    kind: "docs-demo",
  },
];

export const catalogueExamples: CatalogueExampleSummary[] = [
  ...exampleRecipeSummaries.map((example) => ({
    ...example,
    kind: "recipe" as const,
    remixId: example.id,
  })),
  ...docsDemoSummaries,
];
