// ABOUTME: The emote registry — data-only definitions for the radial wheel.
// ABOUTME: First three (wave/dance/spin) are ported verbatim from spencers-website.

export type EmoteKind = "solo" | "interact";

export interface EmoteDef {
  id: string;
  label: string;
  icon: string;
  durationMs: number;
  kind: EmoteKind;
  /** CSS class applied to the cursor SVG via CursorClientAwareness.triggerCursorAnimation (see cursor-gestures.styles.ts). */
  keyframe: string;
}

export const EMOTES: EmoteDef[] = [
  { id: "wave", label: "wave", icon: "\\o", durationMs: 1500, kind: "solo", keyframe: "cursor-gesture-wave" },
  { id: "dance", label: "dance", icon: "~\\/~", durationMs: 2000, kind: "solo", keyframe: "cursor-gesture-dance" },
  { id: "spin", label: "spin", icon: "','", durationMs: 1000, kind: "solo", keyframe: "cursor-gesture-spin" },
  { id: "heart", label: "heart", icon: "♡", durationMs: 1500, kind: "interact", keyframe: "cursor-gesture-heart" },
  { id: "sparkle", label: "sparkle", icon: "✦", durationMs: 1200, kind: "solo", keyframe: "cursor-gesture-sparkle" },
  { id: "sleepy", label: "sleepy", icon: "z", durationMs: 2000, kind: "solo", keyframe: "cursor-gesture-sleepy" },
  { id: "note", label: "note", icon: "♪", durationMs: 1500, kind: "solo", keyframe: "cursor-gesture-note" },
  { id: "highfive", label: "high five", icon: "/\\", durationMs: 1200, kind: "interact", keyframe: "cursor-gesture-highfive" },
  { id: "nuzzle", label: "nuzzle", icon: "~", durationMs: 1500, kind: "interact", keyframe: "cursor-gesture-nuzzle" },
  { id: "poke", label: "poke", icon: ">", durationMs: 1000, kind: "interact", keyframe: "cursor-gesture-poke" },
];

export function getEmote(id: string): EmoteDef | undefined {
  return EMOTES.find((e) => e.id === id);
}
