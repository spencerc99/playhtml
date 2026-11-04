// ABOUTME: Defines the page data recipe: one page-wide background color in a named channel.
// ABOUTME: Swatches in two separate corners write the same channel, so no element owns the state.
import { pageColorCss, pageColorSwatches } from "./demo-shared";
import { indent, recipeBaseStyles, recipeDocument } from "./recipe-document";
import { pageColorReactSource } from "./react/page-color";
import type { ExampleRecipe } from "./types";

const script = `// The page's background color is one value in a page data channel.
// No element owns it: any code on the page can read or write it by name.
const pageColor = playhtml.createPageData("page-color", "#f4efe5");
const readout = document.getElementById("readout");

function paint(color) {
  document.body.style.background = color;
  readout.textContent = \`"page-color": "\${color}"\`;
}

// Both corners' swatches write the same channel.
for (const swatch of document.querySelectorAll("[data-color]")) {
  swatch.addEventListener("click", () => {
    pageColor.setData(swatch.dataset.color);
  });
}

pageColor.onUpdate(paint);
paint(pageColor.getData());`;

const swatches = (where: string) =>
  `  <nav class="corner ${where}">
${pageColorSwatches
  .map(
    (color) =>
      `    <button data-color="${color}" style="--swatch: ${color}" aria-label="Paint the page ${color}"></button>`,
  )
  .join("\n")}
  </nav>`;

export const pageColorRecipe: ExampleRecipe = {
  id: "page-color",
  title: "Shared page color",
  description:
    "Store one page-wide background color in a named page channel that any code can write.",
  tags: ["page data", "color", "persistent state"],
  capabilities: ["page data"],
  difficulty: "starter",
  docsHref: "/docs/examples/page-color/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: pageColorReactSource,
  },
  html: recipeDocument({
    title: "Shared page color",
    styles: `${recipeBaseStyles}
${indent(pageColorCss, 4)}`,
    body: `${swatches("top")}
  <main id="page-color" class="middle">
    <p>Pick a color in either corner. It paints the whole page for everyone.</p>
    <code id="readout" class="readout"></code>
  </main>
${swatches("bottom")}`,
    script: "",
    afterInit: indent(script, 4),
  }),
};
