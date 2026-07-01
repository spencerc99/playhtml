// ABOUTME: Creates stable artificial-user identities and behavior traits.
// ABOUTME: Gives each Playwright actor a distinct cursor identity and rhythm.

import { createRandom, type SeededRandom } from "./random";

export type MovementStyle = "deliberate" | "restless" | "social" | "observer";

export interface ActorPersona {
  index: number;
  name: string;
  color: string;
  tempo: number;
  patience: number;
  curiosity: number;
  movementStyle: MovementStyle;
  random: SeededRandom;
}

const NAMES = [
  "Ada",
  "Ben",
  "Cleo",
  "Dev",
  "Eli",
  "Fern",
  "Gia",
  "Hugo",
  "Iris",
  "Jules",
  "Kai",
  "Lina",
  "Mina",
  "Noor",
  "Owen",
  "Pia",
  "Quinn",
  "Rae",
  "Sol",
  "Tavi",
];

const COLORS = [
  "#c4724e",
  "#4a9a8a",
  "#5b8db8",
  "#8a8279",
  "#d19f45",
  "#7c5fb8",
  "#4a7c59",
  "#b85b7a",
  "#4f78c4",
  "#9a6a4a",
];

const STYLES: MovementStyle[] = [
  "deliberate",
  "restless",
  "social",
  "observer",
];

export function createPersonas(count: number, seed: string): ActorPersona[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("count must be a positive integer");
  }

  const random = createRandom(seed);

  return Array.from({ length: count }, (_, index) => {
    const actorRandom = random.fork(`actor-${index}`);
    const baseName = NAMES[index % NAMES.length];
    const name = `${baseName}-${index + 1}`;
    const color = COLORS[index % COLORS.length];
    const movementStyle = actorRandom.pick(STYLES);

    return {
      index,
      name,
      color,
      tempo: Number(actorRandom.float(0.65, 1.6).toFixed(3)),
      patience: Number(actorRandom.float(0.05, 0.65).toFixed(3)),
      curiosity: Number(actorRandom.float(0.2, 0.95).toFixed(3)),
      movementStyle,
      random: actorRandom,
    };
  });
}
