// ABOUTME: Generates quiet RISO-inspired ink colors for extension portraits and records.
// ABOUTME: Varies a muted five-ink base without producing neon categorical accents.

import { parseColorToHsl } from "@movement/utils/eventUtils";

export const RISO_INKS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#8b6b7f",
] as const;

function seededUnit(seed: number): number {
  let value = Math.abs(Math.trunc(seed)) + 1;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

export function risoInkColor(index: number): string {
  const normalizedIndex = Math.abs(Math.trunc(index));
  const baseColor = RISO_INKS[normalizedIndex % RISO_INKS.length];
  const base = parseColorToHsl(baseColor);
  if (!base) return baseColor;

  const hueOffset = Math.round((seededUnit(normalizedIndex * 3 + 1) - 0.5) * 14);
  const saturationOffset = Math.round(
    (seededUnit(normalizedIndex * 3 + 2) - 0.65) * 14,
  );
  const lightnessOffset = Math.round(
    (seededUnit(normalizedIndex * 3 + 3) - 0.55) * 12,
  );
  const hue = (base.h + hueOffset + 360) % 360;
  const saturation = Math.max(22, Math.min(56, base.s + saturationOffset));
  const lightness = Math.max(38, Math.min(58, base.l + lightnessOffset));

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
