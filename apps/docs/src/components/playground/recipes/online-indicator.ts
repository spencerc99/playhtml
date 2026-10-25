// ABOUTME: Defines the online indicator recipe: one colored dot per reader on the page.
// ABOUTME: Each reader's color is live per-user state, so it clears when they leave.
import { onlineIndicatorCss } from "./demo-shared";
import { indent, recipeBaseStyles, recipeDocument } from "./recipe-document";
import { onlineIndicatorReactSource } from "./react/online-indicator";
import type { ExampleRecipe } from "./types";

const script = `// \`live\` is your value for this element. It never persists, and every
// reader's current value arrives in \`users\` next to their identity.
const online = playhtml.register("online", {
  live: { color: "#4a6a3e" },
  update: ({ element, users }) => {
    element.querySelector(".dots").replaceChildren(
      ...users.map(({ user, live }) => {
        const dot = document.createElement("span");
        dot.className = user.isMe ? "dot me" : "dot";
        dot.style.background = live?.color ?? user.color;
        return dot;
      }),
    );
    const people = users.length === 1 ? "person" : "people";
    element.querySelector(".count").textContent =
      \`\${users.length} \${people} here\`;
  },
});

document.getElementById("my-color").addEventListener("input", (event) => {
  online.setLive({ color: event.target.value });
});`;

export const onlineIndicatorRecipe: ExampleRecipe = {
  id: "online-indicator",
  title: "Online presence indicator",
  description:
    "Show one live colored dot for each reader currently on the page.",
  tags: ["presence", "online", "live state"],
  capabilities: ["can-play"],
  difficulty: "intermediate",
  docsHref: "/docs/examples/online-indicator/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: onlineIndicatorReactSource,
  },
  html: recipeDocument({
    title: "Online presence indicator",
    styles: `${recipeBaseStyles}
${indent(onlineIndicatorCss, 4)}`,
    body: `  <main>
    <div id="online">
      <div class="dots"></div>
      <p class="count"></p>
    </div>
    <label>
      your color
      <input id="my-color" type="color" value="#4a6a3e" />
    </label>
  </main>`,
    script: indent(script, 4),
  }),
};
