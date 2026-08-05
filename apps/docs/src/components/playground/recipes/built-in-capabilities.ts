// ABOUTME: Defines canonical recipes for can-move, can-toggle, and can-hover.
// ABOUTME: Reuses each complete source across docs embeds, detail pages, and the playground.
import { recipeDocument } from "./recipe-document";
import type { ExampleRecipe } from "./types";
import {
  canHoverReactSource,
  canMoveReactSource,
  canToggleReactSource,
} from "./react/built-in-capabilities";

const sharedStyles = `    :root {
      color: #1c1c1c;
      background: #f4efe5;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body { display: grid; min-height: 100vh; margin: 0; padding: 1.5rem; place-items: center; }
    main { width: min(36rem, 100%); }
    h1 { margin: 0 0 0.35rem; font-size: clamp(2rem, 8vw, 3.5rem); line-height: 1; }
    .intro { margin: 0 0 1.25rem; line-height: 1.5; }`;

export const canMoveRecipe: ExampleRecipe = {
  id: "can-move",
  title: "Drag with can-move",
  description:
    "Drag two shared stickers inside a bounded area and keep their positions across reloads.",
  tags: ["dragging", "bounds", "persistent state"],
  capabilities: ["can-move"],
  difficulty: "starter",
  docsHref: "/docs/examples/can-move/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: canMoveReactSource,
  },
  html: recipeDocument({
    title: "Drag with can-move",
    styles: `${sharedStyles}
    .arena {
      position: relative;
      height: 20rem;
      overflow: hidden;
      border: 2px solid #1c1c1c;
      background: #dce8cf;
      box-shadow: 5px 5px 0 #1c1c1c;
    }
    .piece {
      position: absolute;
      display: grid;
      width: 8rem;
      height: 8rem;
      place-items: center;
      font-size: 6rem;
      touch-action: none;
      user-select: none;
    }
    .hat { top: 2rem; left: 2rem; }
    .cat { right: 2rem; bottom: 1.5rem; }`,
    body: `  <main>
    <h1>Drag together</h1>
    <p class="intro">Move either sticker. Its position updates in every connected browser.</p>
    <div id="move-arena" class="arena">
      <div
        id="move-hat"
        class="piece hat"
        can-move
        can-move-bounds="move-arena"
        role="img"
        aria-label="A draggable baseball cap"
      >🧢</div>
      <div
        id="move-cat"
        class="piece cat"
        can-move
        can-move-bounds="move-arena"
        role="img"
        aria-label="A draggable cat"
      >🐈</div>
    </div>
  </main>`,
    script: "    // Built-in capabilities need no custom handlers.",
  }),
};

export const canToggleRecipe: ExampleRecipe = {
  id: "can-toggle",
  title: "Switch with can-toggle",
  description:
    "Share one persistent on or off switch with every connected browser.",
  tags: ["switch", "boolean", "persistent state"],
  capabilities: ["can-toggle"],
  difficulty: "starter",
  docsHref: "/docs/examples/can-toggle/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: canToggleReactSource,
  },
  html: recipeDocument({
    title: "Switch with can-toggle",
    styles: `${sharedStyles}
    main { text-align: center; }
    .switch {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      border: 2px solid #1c1c1c;
      background: #ebe4d5;
      box-shadow: 4px 4px 0 #1c1c1c;
      cursor: pointer;
      font: 700 1rem/1 ui-sans-serif, system-ui, sans-serif;
    }
    .track {
      display: flex;
      width: 3.5rem;
      padding: 0.2rem;
      border: 2px solid #1c1c1c;
      background: #d7cfc0;
    }
    .thumb {
      width: 1.25rem;
      height: 1.25rem;
      background: #1c1c1c;
      transition: translate 150ms;
    }
    .on-label { display: none; }
    .switch.toggled { background: #b9dfad; }
    .switch.toggled .thumb { translate: 1.55rem 0; }
    .switch.toggled .off-label { display: none; }
    .switch.toggled .on-label { display: inline; }`,
    body: `  <main>
    <h1>Shared switch</h1>
    <p class="intro">Click the switch. Everyone sees the same state.</p>
    <button id="shared-switch" class="switch" type="button" can-toggle>
      <span class="track"><span class="thumb"></span></span>
      <span class="off-label">off</span>
      <span class="on-label">on</span>
    </button>
  </main>`,
    script: "    // can-toggle adds or removes the toggled class.",
  }),
};

export const canHoverRecipe: ExampleRecipe = {
  id: "can-hover",
  title: "Presence with can-hover",
  description:
    "Show an ephemeral hover effect to everyone while any connected reader is hovering.",
  tags: ["hover", "presence", "awareness"],
  capabilities: ["can-hover"],
  difficulty: "starter",
  docsHref: "/docs/examples/can-hover/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: canHoverReactSource,
  },
  html: recipeDocument({
    title: "Presence with can-hover",
    styles: `${sharedStyles}
    main { text-align: center; }
    .hover-card {
      display: grid;
      min-height: 12rem;
      place-items: center;
      border: 2px solid #1c1c1c;
      background: #dce8cf;
      box-shadow: 5px 5px 0 #1c1c1c;
      font-size: 1.4rem;
      font-weight: 800;
      transition: background 150ms, transform 150ms;
    }
    .hover-card[data-playhtml-hover] {
      background: #f3cf58;
      transform: scale(1.03);
    }`,
    body: `  <main>
    <h1>Shared hover</h1>
    <p class="intro">Hover over the card. It lights up for everyone currently connected.</p>
    <div id="shared-hover-card" class="hover-card" can-hover>
      hover here
    </div>
  </main>`,
    script: "    // can-hover manages the data-playhtml-hover attribute.",
  }),
};
