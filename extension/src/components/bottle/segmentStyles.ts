// ABOUTME: Segment style presets for bottle letters — each letter styles its own
// ABOUTME: scroll segment (ground, ink, perforation) from this fixed set.

export interface SegmentStyle {
  /** Persisted in BottleNote.styleId. Never rename existing ids. */
  id: string;
  /** Shown in the swatch row tooltip. */
  label: string;
  /** Class applied to the segment root; styles live in MessageBottle.scss. */
  className: string;
  /** Ink color for letter text, signature, and tick-rail accents. */
  ink: string;
}

/** Default ground for legacy notes (no styleId) — not in the picker. */
export const LINEN: SegmentStyle = {
  id: "linen",
  label: "linen",
  className: "seg-linen",
  ink: "#3d3833",
};

/** The pickable presets, deliberately spanning physical → digital. */
export const SEGMENT_STYLES: SegmentStyle[] = [
  { id: "web1", label: "bordered", className: "seg-web1", ink: "#1a1a8c" },
  { id: "stationery", label: "stationery", className: "seg-stationery", ink: "#3d3833" },
  { id: "webnative", label: "gradient", className: "seg-webnative", ink: "#1f2937" },
];

export function segmentStyle(id?: string): SegmentStyle {
  return SEGMENT_STYLES.find((s) => s.id === id) ?? LINEN;
}
