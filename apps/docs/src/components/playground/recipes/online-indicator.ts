// ABOUTME: Defines the online indicator recipe: one colored dot per reader on the page.
// ABOUTME: Each reader's color is their presence on the element, so it clears when they leave.
import { onlineIndicatorCss } from "./demo-shared";
import { indent, recipeBaseStyles, recipeDocument } from "./recipe-document";
import { onlineIndicatorReactSource } from "./react/online-indicator";
import type { ExampleRecipe } from "./types";

const script = `// Each person here has a presence on this element: a value everyone can
// see, gone when they leave. Yours starts at \`defaultPresence\`, and
// \`everyone\` lists each person (name, color, isMe) with theirs.
const online = playhtml.register("online", {
  defaultPresence: { color: "#4a6a3e" },
  update: ({ element, everyone }) => {
    element.querySelector(".dots").replaceChildren(
      ...everyone.map((person) => {
        const dot = document.createElement("span");
        dot.className = person.isMe ? "dot me" : "dot";
        dot.style.background = person.presence.color;
        return dot;
      }),
    );
    const people = everyone.length === 1 ? "person" : "people";
    element.querySelector(".count").textContent =
      \`\${everyone.length} \${people} here\`;
  },
});

document.getElementById("my-color").addEventListener("input", (event) => {
  online.setMyPresence({ color: event.target.value });
});`;

export const onlineIndicatorRecipe: ExampleRecipe = {
  id: "online-indicator",
  title: "Online presence indicator",
  description:
    "Show one live colored dot for each reader currently on the page.",
  tags: ["presence", "online"],
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
