// ABOUTME: Defines the event recipes: summon rain and send live emoji reactions.
// ABOUTME: Events reach everyone on the page right now and are never stored.
import { liveReactionsCss, makeItRain, rainCss } from "./demo-shared";
import { indent, recipeBaseStyles, recipeDocument } from "./recipe-document";
import {
  liveReactionsReactSource,
  rainEventReactSource,
} from "./react/events-basics";
import type { ExampleRecipe } from "./types";

export const rainEventRecipe: ExampleRecipe = {
  id: "rain-event",
  title: "Send a rain event",
  description:
    "Trigger a temporary rain effect for everyone currently connected.",
  tags: ["events", "animation", "transient"],
  capabilities: ["events"],
  difficulty: "intermediate",
  docsHref: "/docs/examples/rain-event/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: rainEventReactSource,
  },
  html: recipeDocument({
    title: "Send a rain event",
    styles: `${recipeBaseStyles}
${indent(rainCss, 4)}`,
    body: `  <main>
    <button id="hydrant" class="hydrant" aria-label="Summon rain"></button>
  </main>`,
    script: indent(
      `${makeItRain}

document.getElementById("hydrant").addEventListener("click", () => {
  playhtml.dispatchPlayEvent({ type: "rain" });
});`,
      4,
    ),
    initOptions: `      events: {
        rain: { type: "rain", onEvent: makeItRain },
      },`,
  }),
};

export const liveReactionsRecipe: ExampleRecipe = {
  id: "live-reactions",
  title: "Live reactions",
  description:
    "Broadcast short-lived emoji reactions without storing shared state.",
  tags: ["events", "emoji", "transient"],
  capabilities: ["events"],
  difficulty: "intermediate",
  docsHref: "/docs/examples/live-reactions/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: liveReactionsReactSource,
  },
  html: recipeDocument({
    title: "Live reactions",
    styles: `${recipeBaseStyles}
${indent(liveReactionsCss, 4)}`,
    body: `  <main id="reactions" class="reactions">
    <button data-emoji="❤️">❤️</button>
    <button data-emoji="✨">✨</button>
    <button data-emoji="🔥">🔥</button>
    <button data-emoji="🎉">🎉</button>
  </main>`,
    script: indent(
      `const stage = document.getElementById("reactions");

// Float one emoji up from a random spot, then remove it.
function burst({ emoji }) {
  const el = document.createElement("span");
  el.className = "burst";
  el.textContent = emoji;
  el.style.left = \`\${Math.random() * 90}%\`;
  el.addEventListener("animationend", () => el.remove());
  stage.append(el);
}

for (const button of stage.querySelectorAll("button")) {
  button.addEventListener("click", () => {
    playhtml.dispatchPlayEvent({
      type: "reaction",
      eventPayload: { emoji: button.dataset.emoji },
    });
  });
}`,
      4,
    ),
    initOptions: `      events: {
        reaction: { type: "reaction", onEvent: burst },
      },`,
  }),
};
