// ABOUTME: Registers the homepage's vanilla can-play elements with playhtml.
// ABOUTME: Covers the here-now count, the candle, the snippet copy counter and the persistent note.

import { playhtml } from "playhtml";
import { setLabelText } from "./pageChrome";

type HomepageAwareness = { online: true };

const SnippetText = `<div id="note" can-move>drag me</div>
<script type="module"
  src="https://unpkg.com/playhtml/dist/init.es.js"></script>`;

export function setupHereNow() {
  const countElement = document.getElementById("site-console-count-number");
  const countLabel = document.querySelector(".site-console__status-label");
  if (!countElement || !countLabel) return;

  playhtml.register<Record<string, never>, undefined, HomepageAwareness>(
    "site-console-count",
    {
      defaultData: {},
      myDefaultAwareness: { online: true },
      updateElement: () => {},
      // `everyone` is one entry per person; `awareness` has one per open tab.
      updateElementAwareness: ({ everyone }) => {
        const peopleCount = Math.max(everyone.length, 1);
        if (countElement.textContent === String(peopleCount)) return;
        countElement.textContent = String(peopleCount);
        countLabel.textContent = " here now";
      },
    },
  );
}

// Same id and {on} data as the old homepage candle.
export function setupCandle() {
  const candle = document.getElementById("customCandle");
  if (!candle) return;

  playhtml.register(candle, {
    defaultData: { on: true },
    onClick: (_event, { data, setData }) => {
      setData({ on: !data.on });
    },
    updateElement: ({ element, data }) => {
      (element as HTMLImageElement).src = data.on
        ? "/candle-gif.gif"
        : "/candle-off.png";
    },
    resetShortcut: "shiftKey",
  });
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
    updateElement: ({ element, data }) => {
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
    updateElement: ({ data }) => {
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
