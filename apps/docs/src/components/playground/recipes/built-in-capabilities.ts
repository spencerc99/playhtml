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
    body { display: grid; min-height: 100vh; margin: 0; padding: 1rem; place-items: center; }
    main { width: min(40rem, 100%); }`;

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
      width: 100%;
      height: min(14.75rem, calc(100vh - 2rem));
      overflow: hidden;
      border: 1.5px solid #1c1c1c;
      border-radius: 8px;
      background: #f1f2e9;
      box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35);
    }
    .piece {
      position: absolute;
      top: 0;
      left: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 0;
      background: transparent;
      box-shadow: none;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    .piece:active { cursor: grabbing; }
    .hat { width: 4.5rem; height: 4.5rem; }
    .cat { width: 5.25rem; height: 9.5rem; }
    .piece img {
      display: block;
      width: 100%;
      height: 100%;
      object-fit: contain;
      pointer-events: none;
    }`,
    body: `  <main>
    <div id="ph-cap-move-arena" class="arena" aria-label="Drag the hat and cat">
      <div
        id="ph-cap-hat"
        class="piece hat"
        can-move
        can-move-bounds="ph-cap-move-arena"
      >
        <img src="https://playhtml.fun/docs/yankees-hat.png" alt="" draggable="false" />
      </div>
      <div
        id="ph-cap-cat"
        class="piece cat"
        can-move
        can-move-bounds="ph-cap-move-arena"
      >
        <img src="https://playhtml.fun/docs/long-cat.png" alt="" draggable="false" />
      </div>
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
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      padding: 0.55rem 1rem;
      border: 2px solid #1c1c1c;
      border-radius: 6px;
      background: #ebe4d5;
      box-shadow: 2px 2px 0 #1c1c1c;
      color: #1c1c1c;
      cursor: pointer;
      font: 700 0.8rem/1 ui-monospace, monospace;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      transition: transform 120ms, box-shadow 120ms, background 120ms, color 120ms;
    }
    .toggle:hover { transform: translate(-1px, -1px); box-shadow: 3px 3px 0 #1c1c1c; }
    .toggle:active { transform: translate(2px, 2px); box-shadow: none; }
    .toggle.toggled { background: #274b9e; color: #f4efe5; }
    .dot {
      width: 0.625rem;
      height: 0.625rem;
      border: 1px solid rgba(0, 0, 0, 0.35);
      border-radius: 999px;
      background: #79766f;
    }
    .toggle.toggled .dot { background: #e8a63a; box-shadow: 0 0 0 3px rgba(232, 166, 58, 0.25); }
    .on-label { display: none; }
    .toggle.toggled .off-label { display: none; }
    .toggle.toggled .on-label { display: inline; }`,
    body: `  <main>
    <button id="ph-docs-toggle-demo" class="toggle" type="button" can-toggle>
      <span class="dot" aria-hidden="true"></span>
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
    .hover-pad {
      display: grid;
      width: min(22.5rem, 100%);
      min-height: 7.5rem;
      margin: 0 auto;
      padding: 1rem 1.1rem;
      place-items: center;
      border: 1.5px solid #1c1c1c;
      border-radius: 8px;
      background: linear-gradient(135deg, #ebe4d5, #ded6c7);
      box-shadow: 2px 2px 0 #1c1c1c;
      transition: background 150ms, transform 150ms;
    }
    .hover-pad[data-playhtml-hover] {
      background: linear-gradient(135deg, #e8a63a, #ded6c7);
      transform: translateY(-2px);
    }
    p { margin: 0; font-size: 0.92rem; line-height: 1.45; }`,
    body: `  <main>
    <div id="ph-cap-hover-pad" class="hover-pad" can-hover>
      <p>Hover here with a friend - the pad lights up for everyone.</p>
    </div>
  </main>`,
    script: "    // can-hover manages the data-playhtml-hover attribute.",
  }),
};
