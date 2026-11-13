// ABOUTME: Demo page for the declarative dragging prototype.
// ABOUTME: Registers each example and shows its source next to it.

import { playhtml, type ElementInitializer } from "playhtml";
import "./declarative-drag.scss";
import { sortable } from "./examples/sortable";
import { piles } from "./examples/piles";
import { board } from "./examples/board";
import { toggle } from "./examples/toggle";
import { slider } from "./examples/slider";
import { dial } from "./examples/dial";
import { dialSteps } from "./examples/dial-steps";
import sortableSrc from "./examples/sortable.ts?raw";
import pilesSrc from "./examples/piles.ts?raw";
import boardSrc from "./examples/board.ts?raw";
import toggleSrc from "./examples/toggle.ts?raw";
import sliderSrc from "./examples/slider.ts?raw";
import dialSrc from "./examples/dial.ts?raw";
import dialStepsSrc from "./examples/dial-steps.ts?raw";

const EXAMPLES: {
  id: string;
  title: string;
  note: string;
  init: ElementInitializer;
  src: string;
}[] = [
  {
    id: "dd-toggle",
    title: "Switch",
    note: "closest of 2 states",
    init: toggle,
    src: toggleSrc,
  },
  {
    id: "dd-sortable",
    title: "Sortable list",
    note: "closest of every position",
    init: sortable,
    src: sortableSrc,
  },
  {
    id: "dd-piles",
    title: "Sort into piles",
    note: "closest of every pile",
    init: piles,
    src: pilesSrc,
  },
  {
    id: "dd-board",
    title: "Board pieces",
    note: "closest of every empty square",
    init: board,
    src: boardSrc,
  },
  {
    id: "dd-slider",
    title: "Slider",
    note: "vary a number",
    init: slider,
    src: sliderSrc,
  },
  {
    id: "dd-dial",
    title: "Dial",
    note: "vary an angle",
    init: dial,
    src: dialSrc,
  },
  {
    id: "dd-dial-steps",
    title: "Dial with steps",
    note: "closest of 4 angles",
    init: dialSteps,
    src: dialStepsSrc,
  },
];

const root = document.getElementById("dd-examples")!;
for (const example of EXAMPLES) {
  const section = document.createElement("section");
  section.className = "dd-example";
  section.innerHTML = `
    <h2>${example.title} <span>${example.note}</span></h2>
    <div class="dd-row">
      <div class="dd-stage"><div id="${example.id}" class="dd-toy"></div></div>
      <pre class="dd-code"><code></code></pre>
    </div>`;
  // Hide the two import lines; they're the same everywhere.
  section.querySelector("code")!.textContent = example.src
    .split("\n")
    .filter((line) => !line.startsWith("import "))
    .join("\n")
    .trim();
  root.appendChild(section);
}

playhtml.init({ cursors: { enabled: true } });
for (const example of EXAMPLES) {
  playhtml.register(example.id, example.init);
}
