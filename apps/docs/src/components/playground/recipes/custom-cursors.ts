// ABOUTME: Defines the custom cursor recipe: other people's cursors drawn as emoji in their color.
// ABOUTME: Shows onCustomCursorRender looking up each cursor's person by pid.
import { critterCursorCss, critterHelpers } from "./demo-shared";
import { indent, recipeBaseStyles, recipeDocument } from "./recipe-document";
import { customCursorsReactSource } from "./react/custom-cursors";
import type { ExampleRecipe } from "./types";

const script = `${critterHelpers}

// Called once for each other person's cursor. Fill in \`element\` and
// return it, or return null to keep the default arrow. playhtml moves the
// element and adds the person's name tag.
function renderCursor(pid, element) {
  const person = playhtml.people.everyone.find((p) => p.pid === pid);
  const critter = document.createElement("div");
  critter.className = "critter";
  critter.textContent = critterFor(pid);
  critter.style.setProperty("--color", person?.color ?? "#1c1c1c");
  element.replaceChildren(critter);
  return element;
}`;

const afterInit = `document.getElementById("my-critter").textContent = critterFor(
  playhtml.people.me.pid,
);`;

export const customCursorsRecipe: ExampleRecipe = {
  id: "custom-cursors",
  title: "Custom cursors",
  description:
    "Draw everyone else's cursor as an emoji in their color with onCustomCursorRender.",
  tags: ["cursors", "presence", "custom render"],
  capabilities: ["cursors"],
  difficulty: "intermediate",
  docsHref: "/docs/examples/custom-cursors/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: customCursorsReactSource,
  },
  html: recipeDocument({
    title: "Custom cursors",
    styles: `${recipeBaseStyles}
${indent(critterCursorCss, 4)}`,
    body: `  <main class="critter-pad">
    <p>Others see your cursor as <span id="my-critter"></span></p>
    <p>Open this page in a second window and move your mouse in both.</p>
  </main>`,
    script: indent(script, 4),
    initOptions: `      cursors: {
        enabled: true,
        onCustomCursorRender: renderCursor,
      },`,
    afterInit: indent(afterInit, 4),
  }),
};
