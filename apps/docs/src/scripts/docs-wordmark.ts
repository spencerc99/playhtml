// ABOUTME: Binds the docs footer wordmark to the homepage's shared letter colors.
// ABOUTME: Same data shape and click behavior as website/components/home/sharedElements.ts.
import { playhtml } from "playhtml";

type WordmarkColorData = Record<string, string>;

// Any hue, with saturation and lightness kept in a band that stays readable.
// Older rooms may still hold palette hex colors.
const WordmarkColorPattern =
  /^(#[0-9a-f]{6}|hsl\(\d{1,3} \d{1,3}% \d{1,3}%\))$/i;

function randomWordmarkColor(current: string | undefined): string {
  const currentHue = Number(current?.match(/^hsl\((\d+)/)?.[1] ?? NaN);
  let hue = Math.floor(Math.random() * 360);
  // Step away from the current hue so each click visibly changes the letter.
  if (
    !Number.isNaN(currentHue) &&
    Math.min(Math.abs(hue - currentHue), 360 - Math.abs(hue - currentHue)) < 40
  ) {
    hue = (hue + 120) % 360;
  }
  const saturation = 55 + Math.floor(Math.random() * 30);
  const lightness = 34 + Math.floor(Math.random() * 14);
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

// Writes only from clicks (last write wins), never from update.
export function setupDocsWordmark() {
  const wordmark = document.getElementById("wordmark-colors");
  if (!wordmark) return;

  const paint = (colors: WordmarkColorData) => {
    wordmark.querySelectorAll<HTMLElement>(".letter").forEach((letter) => {
      const color = letter.dataset.key ? colors[letter.dataset.key] : undefined;
      if (typeof color === "string" && WordmarkColorPattern.test(color)) {
        letter.style.setProperty("--letter-color", color);
        letter.dataset.lit = "";
      } else {
        letter.style.removeProperty("--letter-color");
        delete letter.dataset.lit;
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
        const key = letter?.dataset.key;
        if (!key) return;
        const next = randomWordmarkColor(getData()?.[key]);
        setData((draft) => {
          draft[key] = next;
        });
      });
    },
  });
}
