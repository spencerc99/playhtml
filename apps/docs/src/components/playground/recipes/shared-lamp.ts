// ABOUTME: Defines the shared elements recipe: a lamp whose source lives on spencer.place.
// ABOUTME: The consumer only needs data-source plus the same capability as the source.
import { sharedLampCss, sharedLampSrc } from "./demo-shared";
import { indent, recipeBaseStyles, recipeDocument } from "./recipe-document";
import { sharedLampReactSource } from "./react/shared-lamp";
import type { ExampleRecipe } from "./types";

export const sharedLampRecipe: ExampleRecipe = {
  id: "shared-lamp",
  title: "One lamp, many sites",
  description:
    "Toggle a lamp that is shared with spencer.place and the playhtml homepage.",
  tags: ["shared elements", "cross-site", "toggle"],
  capabilities: ["can-toggle"],
  difficulty: "starter",
  docsHref: "/docs/examples/shared-lamp/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: sharedLampReactSource,
  },
  html: recipeDocument({
    title: "One lamp, many sites",
    styles: `${recipeBaseStyles}
${indent(sharedLampCss, 4)}`,
    body: `  <main id="lamp-demo">
    <!-- The source lamp lives on spencer.place with \`shared\`. This copy
         reads and writes the same on/off state. -->
    <img
      class="lamp"
      src="${sharedLampSrc}"
      alt="A paper lamp"
      data-source="spencer.place#lamp-akari"
      can-toggle
    />
    <p>Click the lamp. It turns on for everyone on spencer.place and playhtml.fun too.</p>
  </main>`,
    script: "",
  }),
};
