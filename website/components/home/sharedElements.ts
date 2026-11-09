// ABOUTME: Registers the homepage's vanilla can-play elements with playhtml.
// ABOUTME: Covers the here-now count, the snippet copy counter, the persistent note, tip jar and wordmark colors.

import { playhtml } from "playhtml";
import { setLabelText } from "./pageChrome";

type HerePresence = { online: true };

const SnippetText = `<div id="note" can-move>drag me</div>
<script type="module"
  src="https://unpkg.com/playhtml/dist/init.es.js"></script>`;

export function setupHereNow() {
  const countElement = document.getElementById("site-console-count-number");
  const countLabel = document.querySelector(".site-console__status-label");
  if (!countElement || !countLabel) return;

  playhtml.register<Record<string, never>, undefined, HerePresence>(
    "site-console-count",
    {
      defaultData: {},
      defaultPresence: { online: true },
      // `everyone` is one entry per person, even with several tabs open.
      update: ({ everyone }) => {
        const peopleCount = Math.max(everyone.length, 1);
        if (countElement.textContent === String(peopleCount)) return;
        countElement.textContent = String(peopleCount);
        countLabel.textContent = " here now";
      },
    },
  );
}

function renderTally(count: number) {
  const tally = document.querySelector<HTMLElement>(".ph-code__bar .ph-tally");
  if (!tally) return;
  // Tally marks for the first few copies, then just the number.
  const shown = Math.min(count, 10);
  tally.replaceChildren(
    ...Array.from({ length: shown }, (_, index) => {
      const mark = document.createElement("i");
      if (index % 5 === 4) mark.className = "slash";
      return mark;
    }),
  );
}

// "How it works" step 1: counts how many times the snippet was copied.
export function setupSnippetCopies() {
  const counter = document.getElementById("copy-snippet-count");
  const button = document.querySelector<HTMLButtonElement>(
    "[data-copy-snippet]",
  );
  if (!counter || !button) return;

  playhtml.register<{ count: number }>(counter, {
    defaultData: { count: 0 },
    update: ({ element, data }) => {
      const count = Number.isFinite(data.count) ? data.count : 0;
      element.textContent =
        count === 0
          ? "copy it"
          : `copied ${count.toLocaleString()} ${count === 1 ? "time" : "times"}`;
      renderTally(count);
    },
    onMount: ({ setData, getData }) => {
      button.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(SnippetText);
        } catch {
          // Clipboard can be blocked; still count the intent to copy.
        }
        const current = getData().count;
        setData({ count: (Number.isFinite(current) ? current : 0) + 1 });
        button.textContent = "copied";
        window.setTimeout(() => {
          button.textContent = "copy";
        }, 1400);
      });
    },
  });
}

interface PersistNoteData {
  x: number;
  y: number;
  moves: number;
}

// "How it works" step 3: a note that stays wherever the last person left it.
// Position is stored as a fraction of the card so it fits any screen width,
// and it's written once per drag, on release.
export function setupPersistentNote() {
  const note = document.getElementById("how-note");
  const bounds = document.getElementById("how-persist-bounds");
  const movedLabel = document.querySelector<HTMLElement>("[data-moved-label]");
  if (!note || !bounds) return;

  const place = (x: number, y: number) => {
    note.style.left = `${x * 100}%`;
    note.style.top = `${y * 100}%`;
  };

  playhtml.register<PersistNoteData>(note, {
    defaultData: { x: 0.07, y: 0.33, moves: 0 },
    update: ({ data }) => {
      if (Number.isFinite(data.x) && Number.isFinite(data.y)) {
        place(data.x, data.y);
      }
      const moves = Number.isFinite(data.moves) ? data.moves : 0;
      if (movedLabel) {
        setLabelText(
          movedLabel,
          `moved ${moves.toLocaleString()} ${moves === 1 ? "time" : "times"}`,
        );
      }
    },
    onMount: ({ getData, setData }) => {
      let drag: {
        pointerX: number;
        pointerY: number;
        left: number;
        top: number;
        moved: boolean;
      } | null = null;
      let next = { x: 0, y: 0 };

      note.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        note.setPointerCapture(event.pointerId);
        drag = {
          pointerX: event.clientX,
          pointerY: event.clientY,
          left: note.offsetLeft,
          top: note.offsetTop,
          moved: false,
        };
        note.style.cursor = "grabbing";
      });

      note.addEventListener("pointermove", (event) => {
        if (!drag) return;
        const maxLeft = bounds.clientWidth - note.offsetWidth;
        const maxTop = bounds.clientHeight - note.offsetHeight;
        const left = Math.min(
          maxLeft,
          Math.max(0, drag.left + event.clientX - drag.pointerX),
        );
        const top = Math.min(
          maxTop,
          Math.max(0, drag.top + event.clientY - drag.pointerY),
        );
        drag.moved = true;
        next = {
          x: left / bounds.clientWidth,
          y: top / bounds.clientHeight,
        };
        place(next.x, next.y);
      });

      const finish = () => {
        if (!drag) return;
        const { moved } = drag;
        drag = null;
        note.style.cursor = "";
        if (!moved) return;
        const current = getData();
        setData({
          x: next.x,
          y: next.y,
          moves: (Number.isFinite(current.moves) ? current.moves : 0) + 1,
        });
      };
      note.addEventListener("pointerup", finish);
      note.addEventListener("pointercancel", finish);
    },
  });
}

// Colors a footer letter can light up in. Matches the homepage palette.
const WordmarkColors = [
  "#e8a63a",
  "#c0373c",
  "#274b9e",
  "#5c7c54",
  "#b0306a",
  "#8a5cc0",
];

type WordmarkColorData = Record<string, string>;

// Footer wordmark: each letter is its own can-toggle. Every click also picks a
// new random color for that letter, shared with everyone, so a letter lights
// up differently each time it's switched on. One color per letter id, written
// only from clicks (last write wins).
export function setupWordmarkColors() {
  const wordmark = document.getElementById("wordmark-colors");
  if (!wordmark) return;

  const paint = (colors: WordmarkColorData) => {
    wordmark.querySelectorAll<HTMLElement>(".letter").forEach((letter) => {
      const color = colors[letter.id];
      if (typeof color === "string" && WordmarkColors.includes(color)) {
        letter.style.setProperty("--letter-color", color);
      } else {
        letter.style.removeProperty("--letter-color");
      }
    });
  };

  playhtml.register<WordmarkColorData>(wordmark, {
    defaultData: {},
    update: ({ data }) => paint(data ?? {}),
    onMount: ({ getData, setData }) => {
      wordmark.addEventListener("click", (event) => {
        const letter = (event.target as HTMLElement).closest<HTMLElement>(
          ".letter",
        );
        if (!letter?.id) return;
        const current = getData()?.[letter.id];
        const choices = WordmarkColors.filter((color) => color !== current);
        const next = choices[Math.floor(Math.random() * choices.length)];
        setData((draft) => {
          draft[letter.id] = next;
        });
      });
    },
  });
}

type TipPresence = { tips: number };

// Where coin n sits in the jar: rows of three, stacking up from the coins
// drawn in the markup. Past the top row they pile on the last spot.
const MaxShownCoins = 21;
function coinPosition(index: number) {
  const slot = Math.min(index, MaxShownCoins - 1);
  const row = Math.floor(slot / 3);
  const column = slot % 3;
  const shift = row % 2 === 0 ? 0 : 6;
  return {
    x: 42 + column * 17 + shift + ((slot * 7) % 5) - 2,
    y: 92 - row * 11 + ((slot * 3) % 4) - 2,
  };
}

// Support card tip jar. Each click adds a coin to your own presence, and the
// jar shows the sum for everyone here, so it empties once everyone leaves.
export function setupTipJar() {
  const jar = document.getElementById("tip-jar");
  const coins = jar?.querySelector<SVGGElement>("[data-tip-coins]");
  const count = jar?.querySelector<HTMLElement>("[data-tip-count]");
  if (!jar || !coins || !count) return;

  const render = (total: number) => {
    const shown = Math.min(total, MaxShownCoins);
    while (coins.childElementCount > shown) coins.lastElementChild?.remove();
    while (coins.childElementCount < shown) {
      const { x, y } = coinPosition(coins.childElementCount);
      const coin = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "circle",
      );
      coin.setAttribute("cx", String(x));
      coin.setAttribute("cy", String(y));
      coin.setAttribute("r", "8");
      coin.setAttribute("fill", "#e8a63a");
      coin.setAttribute("stroke", "#1c1c1c");
      coin.classList.add("is-new");
      coins.append(coin);
    }
    count.textContent =
      total === 0
        ? "click to tip"
        : `${total.toLocaleString()} ${total === 1 ? "coin" : "coins"} right now`;
  };

  playhtml.register<Record<string, never>, undefined, TipPresence>(jar, {
    defaultData: {},
    defaultPresence: { tips: 0 },
    update: ({ everyone }) => {
      const total = everyone.reduce((sum, person) => {
        const tips = person.presence?.tips;
        return sum + (Number.isFinite(tips) && tips > 0 ? tips : 0);
      }, 0);
      render(total);
    },
    onMount: ({ getMe, setMyPresence }) => {
      jar.addEventListener("click", () => {
        const mine = getMe().presence?.tips;
        setMyPresence({
          tips: (Number.isFinite(mine) && mine > 0 ? mine : 0) + 1,
        });
      });
    },
  });
}
