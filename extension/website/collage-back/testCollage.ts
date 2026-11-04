// ABOUTME: A fixed, network-free collage for the back bench: drawn pieces from a few pretend pages.
// ABOUTME: Overlapping, rotated and uneven, on a strong paper color, so the back has something to show through.

import type {
  CollagePiece,
  CollageRecord,
} from "@extension/entrypoints/scraps/collageRecord";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 8, 23, 15);

function svg(body: string, width: number, height: number): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`,
  )}`;
}

interface Sketch {
  body: string;
  width: number;
  height: number;
  domain: string;
  pageTitle: string;
}

const SKETCHES: Sketch[] = [
  {
    width: 800,
    height: 560,
    body: `<defs><radialGradient id="g"><stop offset="0" stop-color="#ff3fd2"/><stop offset=".5" stop-color="#6a2cff"/><stop offset="1" stop-color="#1d8bff"/></radialGradient></defs><rect width="800" height="560" fill="url(#g)"/><g fill="none" stroke="#111" stroke-width="18"><ellipse cx="400" cy="280" rx="320" ry="170"/><ellipse cx="400" cy="280" rx="200" ry="100"/></g>`,
    domain: "instagram.com",
    pageTitle: "(3) Instagram",
  },
  {
    width: 600,
    height: 600,
    body: `<rect width="600" height="600" fill="#6b5a4e"/><rect x="120" y="140" width="360" height="380" rx="40" fill="#a89a88"/><circle cx="300" cy="120" r="80" fill="#caa98c"/>`,
    domain: "blossoms.jeraldlim.com",
    pageTitle: "blossoms",
  },
  {
    width: 520,
    height: 520,
    body: `<g fill="#ee4b3b" stroke="#a82619" stroke-width="6">${Array.from(
      { length: 12 },
      (_, i) => {
        const x = 60 + (i % 4) * 110;
        const y = 60 + Math.floor(i / 4) * 140;
        return `<rect x="${x}" y="${y}" width="90" height="40" rx="6"/><rect x="${x + 6}" y="${y + 40}" width="14" height="70"/><rect x="${x + 70}" y="${y + 40}" width="14" height="70"/>`;
      },
    ).join("")}</g>`,
    domain: "class.playhtml.fun",
    pageTitle: "Showcase",
  },
  {
    width: 700,
    height: 300,
    body: `<rect width="700" height="300" rx="24" fill="#2a8a3a"/><circle cx="130" cy="150" r="70" fill="none" stroke="#d8f0dc" stroke-width="18" stroke-dasharray="330 110"/><text x="240" y="185" font-family="Helvetica, Arial, sans-serif" font-size="110" fill="#fff">Loading</text>`,
    domain: "github.com",
    pageTitle: "Open installation",
  },
  {
    width: 500,
    height: 700,
    body: `<rect width="500" height="700" fill="#2f2f36"/><g stroke="#9aa3ad" stroke-width="10">${Array.from(
      { length: 14 },
      (_, i) => `<line x1="60" y1="${80 + i * 42}" x2="440" y2="${60 + i * 42}"/>`,
    ).join("")}</g>`,
    domain: "en.wikipedia.org",
    pageTitle: "Mass Rapid Transit",
  },
  {
    width: 360,
    height: 360,
    body: `<circle cx="180" cy="180" r="170" fill="#d9a23a"/><circle cx="130" cy="150" r="22" fill="#3d2a12"/><circle cx="230" cy="150" r="22" fill="#3d2a12"/><path d="M110 240 Q180 290 250 240" stroke="#3d2a12" stroke-width="14" fill="none"/>`,
    domain: "app.a24films.com",
    pageTitle: "You Can Stay",
  },
];

interface Placement {
  sketch: number;
  x: number;
  y: number;
  width: number;
  rotation: number;
}

const PLACEMENTS: Placement[] = [
  { sketch: 0, x: -20, y: -30, width: 820, rotation: -2 },
  { sketch: 1, x: 1000, y: 40, width: 520, rotation: 3 },
  { sketch: 4, x: 520, y: 380, width: 380, rotation: 0 },
  { sketch: 2, x: 540, y: 180, width: 560, rotation: -4 },
  { sketch: 3, x: 900, y: 700, width: 620, rotation: 0 },
  { sketch: 5, x: 80, y: 620, width: 300, rotation: 8 },
];

const pieces: CollagePiece[] = PLACEMENTS.map((placement, z) => {
  const sketch = SKETCHES[placement.sketch];
  const scrapId = `bench_scrap_${z}`;
  return {
    id: `bench_piece_${z}`,
    scrapId,
    scrap: {
      id: scrapId,
      key: `image:bench:${z}`,
      kind: "image",
      src: svg(sketch.body, sketch.width, sketch.height),
      naturalWidth: sketch.width,
      naturalHeight: sketch.height,
      pageTitle: sketch.pageTitle,
      domain: sketch.domain,
      pageUrl: `https://${sketch.domain}/bench/${placement.sketch}`,
      ts: START + (z % 2) * DAY,
    },
    x: placement.x,
    y: placement.y,
    width: placement.width,
    height: (placement.width * sketch.height) / sketch.width,
    rotation: placement.rotation,
    z,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
  };
});

export const testCollage: CollageRecord = {
  id: "bench_collage",
  title: "",
  createdAt: START + DAY,
  updatedAt: START + DAY,
  frame: { width: 1500, height: 1000 },
  format: "postcard",
  paper: { color: "#1f5fd6", grain: true },
  pieces,
  preview: { drawn: false, reason: "the bench draws it" },
};
