// ABOUTME: Defines canonical can-play recipes for a counter and bounded guestbook.
// ABOUTME: Shares complete Vanilla HTML and React sources across docs and the playground.
import { recipeDocument } from "./recipe-document";
import type { ExampleRecipe } from "./types";
import {
  sharedCounterReactSource,
  sharedGuestbookReactSource,
} from "./react/shared-state-basics";

const sharedStyles = `    :root {
      color: #1c1c1c;
      background: #f4efe5;
      font-family: ui-sans-serif, system-ui, sans-serif;
    }
    * { box-sizing: border-box; }
    body { display: grid; min-height: 100vh; margin: 0; padding: 1.5rem; place-items: center; }
    main { width: min(40rem, 100%); }
    h1 { margin: 0 0 0.35rem; font-size: clamp(2rem, 8vw, 3.5rem); line-height: 1; }
    .intro { margin: 0 0 1.25rem; line-height: 1.5; }`;

export const sharedCounterRecipe: ExampleRecipe = {
  id: "shared-counter",
  title: "Shared click counter",
  description:
    "Increment one persistent count with a merge-safe can-play data update.",
  tags: ["counter", "shared data", "persistent state"],
  capabilities: ["can-play"],
  difficulty: "starter",
  docsHref: "/docs/examples/shared-counter/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: sharedCounterReactSource,
  },
  html: recipeDocument({
    title: "Shared click counter",
    styles: `${sharedStyles}
    main { text-align: center; }
    .counter {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border: 1.5px solid #65795d;
      border-radius: 6px;
      background: #f4efe5;
      color: #1c1c1c;
      cursor: pointer;
      font: 1.1rem/1 ui-monospace, monospace;
      transition: transform 80ms, box-shadow 120ms;
    }
    .counter:hover { box-shadow: 2px 2px 0 #1c1c1c; }
    .counter:active { transform: translateY(1px); }
    .count { color: #65795d; font-weight: 600; }`,
    body: `  <main>
    <button
      id="ph-docs-counter"
      class="counter"
      type="button"
      can-play
      aria-label="Increment the shared counter"
    >
      <span aria-hidden="true">❤️</span>
      <span class="count" data-count>0</span>
    </button>
  </main>`,
    script: `    const counter = document.getElementById("ph-docs-counter");

    counter.defaultData = { count: 0 };
    counter.onClick = (_event, { setData }) => {
      setData((draft) => {
        draft.count += 1;
      });
    };
    counter.updateElement = ({ element, data }) => {
      element.querySelector("[data-count]").textContent = String(data.count);
    };`,
  }),
};

export const sharedGuestbookRecipe: ExampleRecipe = {
  id: "shared-guestbook",
  title: "Shared guestbook",
  description:
    "Add short notes to a persistent shared list capped at the latest 20 entries.",
  tags: ["guestbook", "shared list", "bounded data"],
  capabilities: ["can-play"],
  difficulty: "intermediate",
  docsHref: "/docs/examples/shared-guestbook/",
  react: {
    install: "npm install playhtml @playhtml/react profane-words",
    code: sharedGuestbookReactSource,
  },
  html: recipeDocument({
    title: "Shared guestbook",
    styles: `${sharedStyles}
    body { place-items: start center; }
    .guestbook {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
      gap: 1rem;
    }
    form, ul {
      margin: 0;
      padding: 1rem;
      border: 2px solid #1c1c1c;
      background: #ebe4d5;
      box-shadow: 4px 4px 0 #1c1c1c;
    }
    label { display: grid; gap: 0.35rem; margin-bottom: 0.75rem; font-weight: 700; }
    textarea, select, button {
      padding: 0.65rem;
      border: 2px solid #1c1c1c;
      font: inherit;
    }
    textarea, select { width: 100%; background: #fffdf8; }
    button {
      background: #f3cf58;
      box-shadow: 2px 2px 0 #1c1c1c;
      cursor: pointer;
      font-weight: 700;
    }
    button:disabled { cursor: default; opacity: 0.5; }
    ul { min-height: 14rem; list-style: none; }
    li { display: grid; gap: 0.25rem; padding: 0.65rem; background: #fffdf8; }
    li + li { margin-top: 0.55rem; }
    li strong { color: #274b9e; font-size: 0.78rem; }
    .empty { color: #66615b; }
    @media (max-width: 36rem) {
      body { padding: 1rem; }
      .guestbook { grid-template-columns: 1fr; }
      ul { min-height: 6rem; }
    }`,
    body: `  <main>
    <h1>Shared guestbook</h1>
    <p class="intro">Add a short note. The latest 20 entries remain for everyone.</p>
    <section id="ph-cap-docs-guestbook" class="guestbook" can-play>
      <form data-form>
        <label>
          Prompt
          <select name="prompt">
            <option value="building">I'm building…</option>
            <option value="learned">I learned…</option>
          </select>
        </label>
        <label>
          Your entry
          <textarea name="text" maxlength="140" rows="3" placeholder="I'm building…"></textarea>
        </label>
        <button type="submit" data-submit>Post</button>
      </form>
      <ul data-entries aria-live="polite"></ul>
    </section>
  </main>`,
    script: `    import words from "https://esm.sh/profane-words@1.6.0";

    const MAX_ENTRIES = 20;
    const guestbook = document.getElementById("ph-cap-docs-guestbook");
    const prompts = {
      building: "I'm building…",
      learned: "I learned…",
    };

    function isProfane(text) {
      return words.some((word) =>
        new RegExp("\\\\b" + word + "\\\\b", "i").test(text),
      );
    }

    guestbook.defaultData = { entries: [] };
    guestbook.updateElement = ({ element, data }) => {
      const list = element.querySelector("[data-entries]");
      const entries = [...data.entries].reverse();
      list.replaceChildren(
        ...(entries.length
          ? entries.map((entry) => {
              const item = document.createElement("li");
              const prompt = document.createElement("strong");
              const text = document.createElement("span");
              prompt.textContent = prompts[entry.prompt];
              text.textContent = entry.text;
              item.append(prompt, text);
              return item;
            })
          : [Object.assign(document.createElement("li"), {
              className: "empty",
              textContent: "No entries yet.",
            })]),
      );
    };
    guestbook.onClick = (event, { setData }) => {
      if (!event.target.closest("[data-submit]")) {
        return;
      }
      event.preventDefault();

      const form = guestbook.querySelector("[data-form]");
      const prompt = form.elements.prompt;
      const text = form.elements.text;
      const value = text.value.trim().slice(0, 140);
      if (!value || isProfane(value)) {
        text.value = "";
        return;
      }

      setData((draft) => {
        draft.entries.push({
          id: crypto.randomUUID(),
          prompt: prompt.value,
          text: value,
          at: Date.now(),
        });
        if (draft.entries.length > MAX_ENTRIES) {
          draft.entries.splice(0, draft.entries.length - MAX_ENTRIES);
        }
      });
      text.value = "";
    };
    guestbook.onMount = ({ getElement }) => {
      const form = getElement().querySelector("[data-form]");
      const prompt = form.elements.prompt;
      const text = form.elements.text;
      const updatePlaceholder = () => {
        text.placeholder = prompts[prompt.value];
      };

      prompt.addEventListener("change", updatePlaceholder);
      return () => {
        prompt.removeEventListener("change", updatePlaceholder);
      };
    };`,
  }),
};
