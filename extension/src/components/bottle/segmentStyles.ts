// ABOUTME: Segment style presets for bottle letters — each letter styles its own
// ABOUTME: scroll segment (ground, ink, perforation) from this fixed set.

/** Paints the sealing ceremony's paper texture for a style. Defined alongside
 * each style so a new style (or a future user-made one) supplies its own
 * painter instead of the ceremony hardcoding a look. */
export interface CeremonyPaper {
  /** Ink the message text is drawn in on the ceremony texture. */
  ink: string;
  /** Paints the paper ground (background, borders, decorations) onto the
   * ceremony texture canvas. Text and seal marks are drawn on top. */
  paintGround(ctx: CanvasRenderingContext2D, w: number, h: number): void;
}

export interface SegmentStyle {
  /** Persisted in BottleNote.styleId. Never rename existing ids. */
  id: string;
  /** Shown in the swatch row tooltip. */
  label: string;
  /** Class applied to the segment root; styles live in MessageBottle.scss. */
  className: string;
  /** Ink color for letter text, signature, and tick-rail accents. */
  ink: string;
  /** Painter for the sealing ceremony's Three.js paper texture. */
  ceremony: CeremonyPaper;
}

// Warm linen ground + speckle grain + a soft grey border — the ceremony
// texture's original look, now the linen style's painter.
function paintLinenGround(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#faf7f2";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(0,0,0,0.012)";
  for (let i = 0; i < 800; i++) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  ctx.strokeStyle = "#767676";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  ctx.fillStyle = "rgba(0,0,0,0.06)";
  ctx.fillRect(6, 6, w - 12, 6);
}

// White ground + a chunky navy pixel-dashed border inset around all edges,
// evoking the seg-web1 broider border — plus a thin inner rule.
function paintWeb1Ground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  const inset = 22;
  const square = 24;
  const gap = 12;
  ctx.fillStyle = "#1a1a8c";
  // Top and bottom edges
  for (let x = inset; x < w - inset; x += square + gap) {
    ctx.fillRect(x, inset, square, square);
    ctx.fillRect(x, h - inset - square, square, square);
  }
  // Left and right edges
  for (let y = inset; y < h - inset; y += square + gap) {
    ctx.fillRect(inset, y, square, square);
    ctx.fillRect(w - inset - square, y, square, square);
  }

  // Thin inner rule
  ctx.strokeStyle = "#1a1a8c";
  ctx.lineWidth = 3;
  const ruleInset = inset + square + 10;
  ctx.strokeRect(ruleInset, ruleInset, w - ruleInset * 2, h - ruleInset * 2);
}

// Warm paper ground + speckle grain + a rust vertical margin rule, evoking
// seg-stationery's fibre-flecked sheet and left margin rule.
function paintStationeryGround(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#f5efe4";
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "rgba(90,70,50,0.03)";
  for (let i = 0; i < 900; i++) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  ctx.strokeStyle = "#767676";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  ctx.fillStyle = "rgba(0,0,0,0.06)";
  ctx.fillRect(6, 6, w - 12, 6);

  // Rust vertical margin rule, ~120px from the left
  ctx.strokeStyle = "rgba(196,114,78,0.45)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(120, 24);
  ctx.lineTo(120, h - 24);
  ctx.stroke();
}

// White-ish ground + soft radial color splotches, a few bright bars/squares
// near the edges, and small monospace ascii ornaments — evoking seg-webnative's
// scattered homepage collage.
function paintWebnativeGround(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = "#fdfdfb";
  ctx.fillRect(0, 0, w, h);

  const splotches: [number, number, number, string][] = [
    [0.1, 0.06, 230, "rgba(255,94,196,0.25)"],
    [0.94, 0.24, 200, "rgba(34,204,255,0.25)"],
    [0.2, 0.92, 240, "rgba(255,212,0,0.25)"],
    [0.76, 0.74, 160, "rgba(0,236,120,0.25)"],
    [0.55, 0.03, 130, "rgba(151,71,255,0.25)"],
  ];
  for (const [fx, fy, radius, color] of splotches) {
    const cx = fx * w;
    const cy = fy * h;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, color);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }

  // Bright bars/squares near the edges
  ctx.fillStyle = "#ff5ec4";
  ctx.fillRect(w * 0.82, h * 0.1, 150, 9);
  ctx.fillStyle = "#22ccff";
  ctx.fillRect(w * 0.06, h * 0.6, 7, 110);
  ctx.fillStyle = "#ffd400";
  ctx.fillRect(w * 0.58, h * 0.96, 46, 46);
  ctx.fillStyle = "#9747ff";
  ctx.fillRect(w * 0.12, h * 0.3, 92, 7);

  // Ascii ornaments
  ctx.fillStyle = "rgba(74,154,138,0.75)";
  ctx.font = `22px ui-monospace, "SFMono-Regular", Menlo, monospace`;
  ctx.textBaseline = "top";
  ctx.fillText("*~ . :-) . ~*", w - 260, 20);
  ctx.fillText("*~ . :-) . ~*", 40, h - 50);

  ctx.strokeStyle = "#767676";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);
}

/** Default ground for legacy notes (no styleId) — not in the picker. */
export const LINEN: SegmentStyle = {
  id: "linen",
  label: "linen",
  className: "seg-linen",
  ink: "#3d3833",
  ceremony: { ink: "#3d3833", paintGround: paintLinenGround },
};

/** The pickable presets, deliberately spanning physical → digital. */
export const SEGMENT_STYLES: SegmentStyle[] = [
  {
    id: "web1",
    label: "bordered",
    className: "seg-web1",
    ink: "#1a1a8c",
    ceremony: { ink: "#1a1a8c", paintGround: paintWeb1Ground },
  },
  {
    id: "stationery",
    label: "stationery",
    className: "seg-stationery",
    ink: "#3d3833",
    ceremony: { ink: "#3d3833", paintGround: paintStationeryGround },
  },
  {
    id: "webnative",
    label: "gradient",
    className: "seg-webnative",
    ink: "#1f2937",
    ceremony: { ink: "#223142", paintGround: paintWebnativeGround },
  },
];

export function segmentStyle(id?: string): SegmentStyle {
  return SEGMENT_STYLES.find((s) => s.id === id) ?? LINEN;
}
