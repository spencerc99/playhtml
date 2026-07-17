// ABOUTME: Creates stable artificial-user identities and behavior traits.
// ABOUTME: Gives each Playwright actor a distinct cursor identity and rhythm.

import { createRandom, type SeededRandom } from "./random";

export type MovementStyle = "deliberate" | "restless" | "social" | "observer";

export interface RhythmProfile {
  startDelayMs: number;
  thinkMinMs: number;
  thinkMaxMs: number;
  betweenMinMs: number;
  betweenMaxMs: number;
}

export interface MotionProfile {
  jitterPx: number;
  pathWobblePx: number;
  microPauseChance: number;
}

export interface PromptProfile {
  attention: number;
  commitment: number;
}

export interface ActorPersona {
  index: number;
  name: string;
  color: string;
  tempo: number;
  patience: number;
  curiosity: number;
  movementStyle: MovementStyle;
  rhythm: RhythmProfile;
  motion: MotionProfile;
  prompt: PromptProfile;
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

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function milliseconds(value: number): number {
  return Math.round(value);
}

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
    const thinkMinMs = milliseconds(actorRandom.float(120, 720));
    const betweenMinMs = milliseconds(actorRandom.float(180, 900));

    const styleBias = {
      deliberate: { attention: 0.75, commitment: 0.8, jitter: 0.45 },
      restless: { attention: 0.45, commitment: 0.45, jitter: 1 },
      social: { attention: 0.85, commitment: 0.65, jitter: 0.7 },
      observer: { attention: 0.35, commitment: 0.35, jitter: 0.35 },
    }[movementStyle];

    return {
      index,
      name,
      color,
      tempo: rounded(actorRandom.float(0.65, 1.6)),
      patience: rounded(actorRandom.float(0.05, 0.65)),
      curiosity: rounded(actorRandom.float(0.2, 0.95)),
      movementStyle,
      rhythm: {
        startDelayMs: milliseconds(actorRandom.float(0, 7000)),
        thinkMinMs,
        thinkMaxMs: thinkMinMs + milliseconds(actorRandom.float(350, 1700)),
        betweenMinMs,
        betweenMaxMs: betweenMinMs + milliseconds(actorRandom.float(500, 2400)),
      },
      motion: {
        jitterPx: rounded(actorRandom.float(4, 45) * styleBias.jitter),
        pathWobblePx: rounded(actorRandom.float(2, 30)),
        microPauseChance: rounded(actorRandom.float(0.02, 0.45)),
      },
      prompt: {
        attention: rounded(
          Math.min(0.95, Math.max(0.25, styleBias.attention + actorRandom.float(-0.15, 0.15))),
        ),
        commitment: rounded(
          Math.min(0.95, Math.max(0.25, styleBias.commitment + actorRandom.float(-0.18, 0.18))),
        ),
      },
      random: actorRandom,
    };
  });
}
