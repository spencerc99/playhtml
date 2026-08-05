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
  /**
   * Whether this emote appears on the wheel / can be fired. The full catalog
   * below is the source of truth for every emote that EXISTS; flip `enabled`
   * to control which are live. The wheel, number keys, and firing all read the
   * enabled subset (ACTIVE_EMOTES), so the set can grow/shrink over time and
   * the radial layout adapts to whatever count is active.
   */
  enabled: boolean;
}

// The full catalog — every emote that exists. `enabled` gates what's live.
// The four interaction emotes are disabled while their two-cursor behavior is
// still being worked out; the interaction code stays intact and re-enabling is
// a one-line flip here.
export const EMOTES: EmoteDef[] = [
  { id: "wave", label: "wave", icon: "\\o", durationMs: 1500, kind: "solo", keyframe: "cursor-gesture-wave", enabled: true },
  { id: "dance", label: "dance", icon: "~\\/~", durationMs: 2000, kind: "solo", keyframe: "cursor-gesture-dance", enabled: true },
  { id: "spin", label: "spin", icon: "','", durationMs: 1000, kind: "solo", keyframe: "cursor-gesture-spin", enabled: true },
  { id: "heart", label: "heart", icon: "♡", durationMs: 1500, kind: "interact", keyframe: "cursor-gesture-heart", enabled: false },
  { id: "sparkle", label: "sparkle", icon: "✦", durationMs: 1200, kind: "solo", keyframe: "cursor-gesture-sparkle", enabled: true },
  { id: "sleepy", label: "sleepy", icon: "z", durationMs: 2000, kind: "solo", keyframe: "cursor-gesture-sleepy", enabled: true },
  { id: "note", label: "note", icon: "♪", durationMs: 1500, kind: "solo", keyframe: "cursor-gesture-note", enabled: true },
  { id: "highfive", label: "high five", icon: "/\\", durationMs: 1200, kind: "interact", keyframe: "cursor-gesture-highfive", enabled: false },
  { id: "nuzzle", label: "nuzzle", icon: "~", durationMs: 1500, kind: "interact", keyframe: "cursor-gesture-nuzzle", enabled: false },
  { id: "poke", label: "poke", icon: ">", durationMs: 1000, kind: "interact", keyframe: "cursor-gesture-poke", enabled: false },
];

/** The live emotes, in wheel order — what the wheel shows and number keys fire. */
export const ACTIVE_EMOTES: EmoteDef[] = EMOTES.filter((e) => e.enabled);

export function getEmote(id: string): EmoteDef | undefined {
  return EMOTES.find((e) => e.id === id);
}
