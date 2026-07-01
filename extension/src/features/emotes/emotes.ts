// ABOUTME: The emote registry — data-only definitions for the radial wheel.
// ABOUTME: First three (wave/dance/spin) are ported verbatim from spencers-website.

export type EmoteKind = "solo" | "interact";

export interface EmoteDef {
  id: string;
  label: string;
  icon: string;
  durationMs: number;
  kind: EmoteKind;
  /** CSS animation-name applied to the cursor node (see emotes.styles.ts). */
  keyframe: string;
}

export const EMOTES: EmoteDef[] = [
  { id: "wave", label: "wave", icon: "\\o", durationMs: 1500, kind: "solo", keyframe: "emote-wave" },
  { id: "dance", label: "dance", icon: "~\\/~", durationMs: 2000, kind: "solo", keyframe: "emote-dance" },
  { id: "spin", label: "spin", icon: "','", durationMs: 1000, kind: "solo", keyframe: "emote-spin" },
  { id: "heart", label: "heart", icon: "♡", durationMs: 1500, kind: "interact", keyframe: "emote-heart" },
  { id: "sparkle", label: "sparkle", icon: "✦", durationMs: 1200, kind: "solo", keyframe: "emote-sparkle" },
  { id: "sleepy", label: "sleepy", icon: "z", durationMs: 2000, kind: "solo", keyframe: "emote-sleepy" },
  { id: "note", label: "note", icon: "♪", durationMs: 1500, kind: "solo", keyframe: "emote-note" },
  { id: "highfive", label: "high five", icon: "/\\", durationMs: 1200, kind: "interact", keyframe: "emote-highfive" },
  { id: "nuzzle", label: "nuzzle", icon: "~", durationMs: 1500, kind: "interact", keyframe: "emote-nuzzle" },
  { id: "poke", label: "poke", icon: ">", durationMs: 1000, kind: "interact", keyframe: "emote-poke" },
];

export function getEmote(id: string): EmoteDef | undefined {
  return EMOTES.find((e) => e.id === id);
}
