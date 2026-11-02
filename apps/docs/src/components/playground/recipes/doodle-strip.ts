// ABOUTME: Defines the doodle strip recipe: draw a 64x64 doodle, add it to a shared row.
// ABOUTME: Only finished doodles are shared, and the row keeps the newest 20.
import { indent, recipeBaseStyles, recipeDocument } from "./recipe-document";
import { doodleStripCss } from "./demo-shared";
import { doodleStripReactSource } from "./react/doodle-strip";
import type { ExampleRecipe } from "./types";

const script = `const SIZE = 64;
const MAX_DOODLES = 20;
const pad = document.getElementById("doodle-pad");
const pen = pad.getContext("2d");
pen.lineWidth = 4;
pen.lineCap = "round";
pen.lineJoin = "round";

// Pointer position in canvas pixels (the canvas is drawn 3x larger).
function toPad(event) {
  const rect = pad.getBoundingClientRect();
  return [
    ((event.clientX - rect.left) / rect.width) * SIZE,
    ((event.clientY - rect.top) / rect.height) * SIZE,
  ];
}

let drawing = false;
pad.addEventListener("pointerdown", (event) => {
  drawing = true;
  pad.setPointerCapture(event.pointerId);
  pen.beginPath();
  pen.moveTo(...toPad(event));
  pen.lineTo(...toPad(event)); // a click leaves a dot
  pen.stroke();
});
pad.addEventListener("pointermove", (event) => {
  if (!drawing) return;
  pen.lineTo(...toPad(event));
  pen.stroke();
});
pad.addEventListener("pointerup", () => (drawing = false));

const clearPad = () => pen.clearRect(0, 0, SIZE, SIZE);
document.getElementById("doodle-clear").addEventListener("click", clearPad);

// The shared row. Only finished doodles are shared, never the strokes.
const strip = playhtml.register("doodle-strip", {
  defaultData: { doodles: [] },
  update: ({ element, data }) => {
    element.replaceChildren(
      ...data.doodles.map((doodle) => {
        const img = document.createElement("img");
        img.src = doodle.src;
        img.alt = "";
        return img;
      }),
    );
  },
});

document.getElementById("doodle-add").addEventListener("click", () => {
  const src = pad.toDataURL("image/png");
  strip.setData((data) => {
    data.doodles.push({ id: crypto.randomUUID(), src });
    // Keep the newest 20. Shared arrays support splice, not shift.
    if (data.doodles.length > MAX_DOODLES) {
      data.doodles.splice(0, data.doodles.length - MAX_DOODLES);
    }
  });
  clearPad();
});`;

export const doodleStripRecipe: ExampleRecipe = {
  id: "doodle-strip",
  title: "Shared doodle strip",
  description:
    "Draw a tiny face and add it to a shared strip capped at 20 doodles.",
  tags: ["drawing", "canvas", "shared list"],
  capabilities: ["can-play"],
  difficulty: "intermediate",
  docsHref: "/docs/examples/doodle-strip/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: doodleStripReactSource,
  },
  html: recipeDocument({
    title: "Shared doodle strip",
    styles: `${recipeBaseStyles}
${indent(doodleStripCss, 4)}`,
    body: `  <main>
    <canvas id="doodle-pad" class="pad" width="64" height="64"></canvas>
    <div>
      <button id="doodle-clear">Clear</button>
      <button id="doodle-add">Add to row</button>
    </div>
    <div id="doodle-strip" class="strip"></div>
  </main>`,
    script: indent(script, 4),
  }),
};
