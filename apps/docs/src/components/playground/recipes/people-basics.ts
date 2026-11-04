// ABOUTME: Defines the People page recipes: your saved name and color, and a page status board.
// ABOUTME: Both read playhtml.people once playhtml is ready; the status board uses page presence.
import { pageStatusCss, yourNameCss } from "./demo-shared";
import { indent, recipeBaseStyles, recipeDocument } from "./recipe-document";
import {
  pageStatusReactSource,
  yourNameReactSource,
} from "./react/people-basics";
import type { ExampleRecipe } from "./types";

const yourNameScript = `// <input type="color"> only takes hex, but default colors are hsl()
function toHex(color) {
  const context = document.createElement("canvas").getContext("2d");
  context.fillStyle = color;
  return context.fillStyle;
}

const card = document.getElementById("me");
const nameInput = document.getElementById("my-name");
const colorInput = document.getElementById("my-color");

// playhtml.people is available once playhtml has connected.
playhtml.ready.then(() => {
  const { people } = playhtml;

  // Calls back now, then whenever someone's name or color changes
  // (including yours from another tab).
  people.onChange(() => {
    card.querySelector(".name").textContent = people.me.name ?? "anonymous";
    card.querySelector(".dot").style.background = people.me.color;
    if (document.activeElement !== nameInput) {
      nameInput.value = people.me.name ?? "";
    }
    colorInput.value = toHex(people.me.color);
  });

  // Setting me.name or me.color saves it for your next visit and shows it
  // to everyone.
  nameInput.addEventListener("change", () => {
    people.me.name = nameInput.value.trim();
  });
  colorInput.addEventListener("input", () => {
    people.me.color = colorInput.value;
  });
});`;

export const yourNameRecipe: ExampleRecipe = {
  id: "your-name-and-color",
  title: "Your name and color",
  description:
    "Show your saved name and color, and let readers change them for everyone.",
  tags: ["people", "names", "colors"],
  capabilities: ["people"],
  difficulty: "starter",
  docsHref: "/docs/examples/your-name-and-color/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: yourNameReactSource,
  },
  html: recipeDocument({
    title: "Your name and color",
    styles: `${recipeBaseStyles}
${indent(yourNameCss, 4)}`,
    body: `  <main>
    <p id="me" class="me"><span class="dot"></span><span class="name">connecting…</span></p>
    <label>name <input id="my-name" placeholder="your name" /></label>
    <label>color <input id="my-color" type="color" /></label>
  </main>`,
    script: indent(yourNameScript, 4),
  }),
};

const pageStatusScript = `const STATUSES = ["reading", "coding", "taking a break"];
const picker = document.getElementById("picker");
const list = document.getElementById("people");

// playhtml.people is available once playhtml has connected.
playhtml.ready.then(() => {
  const { people } = playhtml;

  for (const status of STATUSES) {
    const button = document.createElement("button");
    button.textContent = status;
    button.addEventListener("click", () => {
      // Picking your current status again clears it (null removes the key).
      const mine = people.me.presence.status;
      people.setMyPresence("status", mine === status ? null : status);
    });
    picker.append(button);
  }

  // Calls back now, then when someone joins, leaves, renames, or changes
  // their status.
  people.onChange("status", (everyone) => {
    const mine = people.me.presence.status;
    for (const button of picker.children) {
      button.setAttribute("aria-pressed", String(button.textContent === mine));
    }
    list.replaceChildren(
      ...everyone.map((person) => {
        const row = document.createElement("li");
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = person.color;
        const name = document.createElement("span");
        name.textContent = (person.name ?? "anonymous") + (person.isMe ? " (you)" : "");
        const status = document.createElement("span");
        status.className = "status";
        status.textContent = person.presence.status ?? "…";
        row.append(dot, name, status);
        return row;
      }),
    );
  });
});`;

export const pageStatusRecipe: ExampleRecipe = {
  id: "page-status",
  title: "Page status board",
  description:
    "Everyone picks a status and sees everyone else's, gone when they leave.",
  tags: ["people", "presence", "status"],
  capabilities: ["people"],
  difficulty: "starter",
  docsHref: "/docs/examples/page-status/",
  react: {
    install: "npm install playhtml @playhtml/react",
    code: pageStatusReactSource,
  },
  html: recipeDocument({
    title: "Page status board",
    styles: `${recipeBaseStyles}
${indent(pageStatusCss, 4)}`,
    body: `  <main>
    <div id="picker" class="picker"></div>
    <ul id="people" class="people"></ul>
  </main>`,
    script: indent(pageStatusScript, 4),
  }),
};
