// ABOUTME: Defines canonical can-mirror recipes for form state and direct children.
// ABOUTME: Keeps the vanilla-first DOM examples shared by docs embeds and the playground.
import { recipeDocument } from "./recipe-document";
import type { ExampleRecipe } from "./types";

const sharedStyles = `    :root {
      color: #1c1c1c;
      background: #f4efe5;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body { display: grid; min-height: 100vh; margin: 0; padding: 1rem; place-items: center; }
    main { width: min(34rem, 100%); }
    h1 { margin: 0 0 0.35rem; font-size: clamp(2rem, 8vw, 3.5rem); line-height: 1; }
    .intro { margin: 0 0 1.25rem; line-height: 1.5; }`;

export const emojiMirrorRecipe: ExampleRecipe = {
  id: "emoji-mirror",
  title: "Emoji-only mirrored textarea",
  description:
    "Filter a textarea to emoji while can-mirror shares its current value.",
  tags: ["textarea", "input filtering", "Vanilla HTML"],
  capabilities: ["can-mirror"],
  difficulty: "starter",
  docsHref: "/docs/examples/emoji-mirror/",
  html: recipeDocument({
    title: "Emoji-only mirrored textarea",
    styles: `${sharedStyles}
    textarea {
      width: 100%;
      min-height: 8rem;
      resize: vertical;
      padding: 0.85rem 0.95rem;
      border: 1.5px solid #1c1c1c;
      border-radius: 6px;
      background: #f4efe5;
      box-shadow: 2px 2px 0 #1c1c1c;
      color: #1c1c1c;
      font: 1.75rem/1.35 ui-sans-serif, system-ui, sans-serif;
    }
    textarea:focus { outline: 3px solid #274b9e; outline-offset: 3px; }
    .hint {
      margin: 0.75rem 0 0;
      color: #6a6761;
      font: 0.74rem/1.5 ui-monospace, monospace;
      text-align: center;
    }`,
    body: `  <main>
    <textarea
      id="emoji-pad"
      rows="4"
      placeholder="emojis only..."
      aria-label="Emoji-only shared textarea"
      can-mirror
    ></textarea>
    <p class="hint">Type anything. Only emojis stick, and the filtered value mirrors to everyone.</p>
  </main>`,
    script: `    const emojiOnly = /\\p{Extended_Pictographic}/gu;
    const emojiPad = document.getElementById("emoji-pad");

    emojiPad.addEventListener("input", () => {
      const matches = emojiPad.value.match(emojiOnly);
      emojiPad.value = matches ? matches.join("") : "";
    });`,
  }),
};

export const growingListMirrorRecipe: ExampleRecipe = {
  id: "growing-list-mirror",
  title: "Growing mirrored list",
  description:
    "Append direct list children and let can-mirror share the resulting DOM.",
  tags: ["dynamic DOM", "lists", "Vanilla HTML"],
  capabilities: ["can-mirror"],
  difficulty: "starter",
  docsHref: "/docs/examples/growing-list-mirror/",
  html: recipeDocument({
    title: "Growing mirrored list",
    styles: `${sharedStyles}
    .panel {
      padding: 1rem;
      border: 2px solid #1c1c1c;
      background: #ebe4d5;
      box-shadow: 5px 5px 0 #1c1c1c;
    }
    ul {
      min-height: 7rem;
      margin: 0 0 1rem;
      padding: 0.75rem 0.75rem 0.75rem 2rem;
      border: 1px solid #1c1c1c;
      background: #fffdf8;
    }
    li + li { margin-top: 0.35rem; }
    button {
      padding: 0.65rem 0.9rem;
      border: 2px solid #1c1c1c;
      background: #f3cf58;
      box-shadow: 3px 3px 0 #1c1c1c;
      cursor: pointer;
      font: 700 1rem/1 ui-sans-serif, system-ui, sans-serif;
    }
    button:active { translate: 3px 3px; box-shadow: none; }`,
    body: `  <main>
    <h1>Shared list</h1>
    <p class="intro">Add an item. The direct child appears for everyone.</p>
    <section class="panel">
      <ul id="guestbook" can-mirror>
        <li>first</li>
      </ul>
      <button id="guestbook-add" type="button">add entry</button>
    </section>
  </main>`,
    script: `    const list = document.getElementById("guestbook");
    const addButton = document.getElementById("guestbook-add");

    addButton.addEventListener("click", () => {
      const item = document.createElement("li");
      item.textContent = new Date().toLocaleTimeString();
      list.appendChild(item);
    });`,
  }),
};
