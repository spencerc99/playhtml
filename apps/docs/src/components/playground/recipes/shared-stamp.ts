// ABOUTME: Defines the shared elements recipe: the spinning logo stamp from the playhtml.fun homepage.
// ABOUTME: The consumer only needs data-source plus the same capability as the source.
import { sharedStampCss, sharedStampSrc } from "./demo-shared";
import { indent, recipeBaseStyles, recipeDocument } from "./recipe-document";
import { sharedStampReactSource } from "./react/shared-stamp";
import type { ExampleRecipe } from "./types";

export const sharedStampRecipe: ExampleRecipe = {
  id: "shared-stamp",
  title: "Borrow an element from another page",
  description:
    "Spin the logo stamp from the playhtml.fun homepage, from any other page.",
  tags: ["shared elements", "cross-page", "spin"],
  capabilities: ["can-spin"],
  difficulty: "starter",
  docsHref: "/docs/examples/shared-stamp/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: sharedStampReactSource,
  },
  html: recipeDocument({
    title: "Borrow an element from another page",
    styles: `${recipeBaseStyles}
${indent(sharedStampCss, 4)}`,
    body: `  <main id="stamp-demo">
    <!-- The source stamp lives on the playhtml.fun homepage with \`shared\`.
         This copy reads and writes the same rotation. -->
    <img
      class="stamp"
      src="${sharedStampSrc}"
      alt="The playhtml logo stamp"
      data-source="playhtml.fun#stamp"
      can-spin
    />
    <p>Drag to spin it. It's the same stamp as on the playhtml.fun homepage.</p>
  </main>`,
    script: "",
  }),
};
