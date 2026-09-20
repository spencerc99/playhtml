// ABOUTME: Every colour the internet map draws, as one typed Theme plus presets.
// ABOUTME: Dark is Jacky's original; the light presets are built from the WWO tokens.

/**
 * One theme drives both the canvas and the DOM chrome.
 *
 * Upstream kept colours in three places — a `Theme` for the renderer, a
 * `PALETTE` of building tints in glyphs.ts, and CSS custom properties for the
 * panels. Everything a colour decision touches is gathered here instead, so a
 * preset is one object and the dev panel has one surface to edit.
 *
 * The building palette is twelve hue families of three lightness steps. The
 * family is the domain and the step is the subdomain, so a site keeps one hue
 * however many parts it has; the steps only need to stay distinguishable from
 * each other within a family.
 */

export const TINT_FAMILY_COUNT = 12;
export const TINT_STEP_COUNT = 3;
/** Woodland core to edge, then two cultivated-ground tints. */
export const WOOD_COUNT = 5;
export const FIELD_COUNT = 2;
/** Per-building opacity steps, sparse to dense traffic. */
export const BUILD_ALPHA_STEPS = 6;

export interface Theme {
  /** what shows through everything: the paper or the night */
  bg: string;
  /** one road colour; how travelled a road is rides on opacity */
  road: string;
  /** peak alpha, for the most-travelled road on the map */
  roadGain: number;
  /** fallback ink for any glyph with no tint of its own */
  landmark: string;
  /** master multiplier on the per-building alpha ramp */
  buildingGain: number;
  /** the ramp itself, sparse to dense traffic */
  buildAlpha: number[];
  /** trees and grass sit behind the built map */
  countrysideGain: number;
  /** open-country scenery sits behind even that */
  wildGain: number;
  /** place names, and the halo that lifts them off built ground */
  label: string;
  labelHalo: string;
  /** multiplies the whole label size ramp */
  labelScale: number;
  /**
   * Ink deepening applied only when the map is drawn scaled down, where many
   * cells average into one pixel. 1 is off (correct for a dark ground, where
   * averaging concentrates bright ink); a light ground needs >1 or the far
   * view washes out to bare paper.
   */
  farContrast: number;
  /** woodland, deep core to pale edge */
  wood: string[];
  /** cultivated ground near a town */
  field: string[];
  /** 12 hue families x 3 lightness steps, in family-major order */
  buildings: string[];
  /** the hovered building itself */
  hoverSelf: string;
  /** how far a hovered district's own hostname and its whole domain lift */
  hoverSubLift: number;
  hoverDomLift: number;
  /** a solved route, its walking legs, and its two endpoints */
  routeInk: string;
  routeWalk: string;
  routeFrom: string;
  routeTo: string;
  /** panels, tooltips and buttons */
  chrome: ChromeTheme;
}

export interface ChromeTheme {
  panel: string;
  panelInk: string;
  panelDim: string;
  line: string;
  shadow: string;
}

/**
 * On a dark ground a building is painted at partial alpha over near-black, so
 * more alpha means more of the tint and the cell reads brighter. On paper the
 * same alpha ramp washes a prominent building OUT — the busiest page ends up
 * palest. So a light preset needs both a darker set of tints and a ramp that
 * still climbs: alpha is what carries prominence either way, but the tints it
 * is climbing towards have to be darker than the ground rather than lighter.
 */

const DARK_CHROME: ChromeTheme = {
  panel: "#1e1d18",
  panelInk: "#ded8bd",
  panelDim: "#8e8873",
  line: "#ded8bd",
  shadow: "rgba(0, 0, 0, 0.5)",
};

/** Jacky's original, unchanged. */
export const DARK: Theme = {
  bg: "#17160f",
  road: "#e4dcb4",
  roadGain: 0.7,
  landmark: "#cec6a0",
  buildingGain: 1.0,
  buildAlpha: [0.26, 0.4, 0.55, 0.7, 0.86, 1.0],
  countrysideGain: 0.38,
  wildGain: 0.26,
  label: "#f2ecd0",
  labelHalo: "#17160f",
  labelScale: 1,
  farContrast: 1,
  wood: ["#4f8f3a", "#5d9c42", "#6daa4e", "#7fb85e", "#93c473"],
  field: ["#8fa87a", "#a3b88f"],
  buildings: [
    "#8f6a6d", "#c9989b", "#f0c3c0",
    "#6a7a8f", "#98adc9", "#c3d5f0",
    "#8f8560", "#c9bd8c", "#f0e4b4",
    "#7a6a8f", "#ab98c9", "#d9c2ee",
    "#5f8578", "#8bbdad", "#aee0cf",
    "#8f7a5f", "#c9ae8b", "#f0cfa8",
    "#8f6a7d", "#c998ab", "#eeb8c8",
    "#6f8f66", "#9ec994", "#c3e8b6",
    "#5f7f8f", "#8fb4c6", "#b6dcec",
    "#8f8a6a", "#c6c095", "#e9e3ba",
    "#7f6f8f", "#a89ac4", "#cfc2e6",
    "#6f8f85", "#95c0b6", "#bde3da",
  ],
  hoverSelf: "#fffbe8",
  hoverSubLift: 1.25,
  hoverDomLift: 1.1,
  routeInk: "#ffd86b",
  routeWalk: "#b9a86a",
  routeFrom: "#9dff96",
  routeTo: "#ff8f6a",
  chrome: DARK_CHROME,
};

const LIGHT_CHROME: ChromeTheme = {
  panel: "#f5f0e8",
  panelInk: "#3d3833",
  panelDim: "#8a8279",
  line: "rgba(90, 78, 65, 0.25)",
  shadow: "rgba(90, 78, 65, 0.14)",
};

/**
 * paper — linen ground, warm-brown ink.
 *
 * The reading is a survey drawn on the WWO linen: roads in the muted body
 * grey, woodland in a desaturated sage that sits back, and towns in the five
 * WWO accents darkened until they hold against paper. Twelve families are more
 * than five accents, so each accent contributes a family and the gaps are
 * filled by walking the hue circle between neighbouring accents — olive between
 * teal and gold, brick between gold and rust, and so on — which keeps adjacent
 * domains separable without introducing a hue that is foreign to the palette.
 */
export const PAPER: Theme = {
  bg: "#faf7f2",
  road: "#8f857a",
  roadGain: 0.44,
  landmark: "#6b6259",
  buildingGain: 1.0,
  buildAlpha: [0.16, 0.28, 0.42, 0.58, 0.78, 1.0],
  countrysideGain: 0.5,
  wildGain: 0.4,
  label: "#3d3833",
  labelHalo: "#faf7f2",
  labelScale: 1,
  farContrast: 3.2,
  wood: ["#41715f", "#4d7d6a", "#5b8976", "#6b9584", "#7fa294"],
  field: ["#8f8a63", "#a09a75"],
  buildings: [
    "#2f6b60", "#4a9a8a", "#7bbcae",   // teal
    "#3a6a4a", "#5d9a6f", "#8dbd9c",   // fern
    "#5c6f2e", "#87a04d", "#b0c07e",   // olive
    "#8a6a1c", "#b8912e", "#d4b85c",   // gold
    "#8f5a20", "#bd8036", "#d9a967",   // amber
    "#8b3f24", "#c4724e", "#dd9c7d",   // rust
    "#8a3348", "#bb5f74", "#d494a3",   // brick
    "#6d3a58", "#8b6b7f", "#b096a3",   // plum
    "#4a3f7a", "#6f639f", "#9a90c0",   // iris
    "#2f5a86", "#5b8db8", "#8cb3d5",   // blue
    "#25707e", "#4a9aa8", "#7fbcc6",   // lagoon
    "#4f5a63", "#78838d", "#a5aeb6",   // slate
  ],
  hoverSelf: "#1a1512",
  hoverSubLift: 0.66,
  hoverDomLift: 0.85,
  routeInk: "#b8912e",
  routeWalk: "#c0a86a",
  routeFrom: "#2f6b60",
  routeTo: "#8b3f24",
  chrome: LIGHT_CHROME,
};

/**
 * ink — the same linen, but the map is drawn in one ink.
 *
 * Everything is a step of near-black warm brown and the only colour on the
 * page is teal, spent on the busiest step of each family. This is the variant
 * to read a dense district in: with hue carrying nothing, the alpha ramp is
 * the whole signal and prominence is the only thing the eye sorts on.
 */
export const INK: Theme = {
  bg: "#faf7f2",
  road: "#7a726a",
  roadGain: 0.4,
  landmark: "#2a2521",
  buildingGain: 1.0,
  buildAlpha: [0.14, 0.25, 0.38, 0.54, 0.75, 1.0],
  countrysideGain: 0.4,
  wildGain: 0.3,
  label: "#221e1a",
  labelHalo: "#faf7f2",
  labelScale: 1.05,
  farContrast: 3.4,
  wood: ["#6e6a62", "#78746c", "#827e76", "#8c8880", "#96928a"],
  field: ["#8a867d", "#949087"],
  buildings: (() => {
    // Three steps of one warm near-black per family, with the top step of
    // every fourth family carrying the single accent so a large domain still
    // has an edge to find. Any more colour than that and this stops being the
    // monochrome read it exists to be.
    const dark = ["#26211d", "#4a423b", "#736a61"];
    const accent = "#2f6b60";
    const out: string[] = [];
    for (let f = 0; f < TINT_FAMILY_COUNT; f++) {
      out.push(f % 4 === 0 ? accent : dark[0], dark[1], dark[2]);
    }
    return out;
  })(),
  hoverSelf: "#0f0c0a",
  hoverSubLift: 0.6,
  hoverDomLift: 0.82,
  routeInk: "#4a9a8a",
  routeWalk: "#8fb5ad",
  routeFrom: "#1d4f47",
  routeTo: "#8b3f24",
  chrome: LIGHT_CHROME,
};

/**
 * atlas — aged paper, the gold-and-rust half of the palette.
 *
 * Warmer ground (the WWO surface rather than its bg), woodland pulled towards
 * a teal-grey so the built land stays the warm thing on the page, and the
 * building families weighted to gold, amber, rust and clay with the cool
 * families kept in as a minority so a blue site still reads as blue. Roads are
 * a shade browner than in paper — on an aged sheet a route looks drawn, not
 * printed.
 */
export const ATLAS: Theme = {
  bg: "#f5f0e8",
  road: "#9d8b71",
  roadGain: 0.48,
  landmark: "#6f6252",
  buildingGain: 1.0,
  buildAlpha: [0.18, 0.3, 0.44, 0.6, 0.79, 1.0],
  countrysideGain: 0.52,
  wildGain: 0.42,
  label: "#3a3229",
  labelHalo: "#f5f0e8",
  labelScale: 1,
  farContrast: 3.0,
  wood: ["#4a6d68", "#557874", "#628381", "#71908d", "#829d9a"],
  field: ["#94886a", "#a5997c"],
  buildings: [
    "#8a6a1c", "#b8912e", "#d4b85c",   // gold
    "#8f5a20", "#bd8036", "#d9a967",   // amber
    "#8b3f24", "#c4724e", "#dd9c7d",   // rust
    "#7a4a2c", "#a5714d", "#c79a7b",   // clay
    "#6b5220", "#967c3c", "#bda36b",   // bronze
    "#5c6f2e", "#87a04d", "#b0c07e",   // olive
    "#2f6b60", "#4a9a8a", "#7bbcae",   // teal
    "#8a3348", "#bb5f74", "#d494a3",   // brick
    "#6d3a58", "#8b6b7f", "#b096a3",   // plum
    "#2f5a86", "#5b8db8", "#8cb3d5",   // blue
    "#4a3f7a", "#6f639f", "#9a90c0",   // iris
    "#5a5348", "#847c6e", "#aca498",   // stone
  ],
  hoverSelf: "#1a1310",
  hoverSubLift: 0.66,
  hoverDomLift: 0.85,
  routeInk: "#9a6a12",
  routeWalk: "#bda370",
  routeFrom: "#2f6b60",
  routeTo: "#8b3f24",
  chrome: LIGHT_CHROME,
};

export const PRESETS: Record<string, Theme> = {
  dark: DARK,
  paper: PAPER,
  ink: INK,
  atlas: ATLAS,
};

export type PresetName = keyof typeof PRESETS;
export const DEFAULT_PRESET: PresetName = "paper";

export function cloneTheme(t: Theme): Theme {
  return {
    ...t,
    buildAlpha: [...t.buildAlpha],
    wood: [...t.wood],
    field: [...t.field],
    buildings: [...t.buildings],
    chrome: { ...t.chrome },
  };
}

/**
 * The flat PALETTE the baked grid indexes into: slot 0 is "whatever colour the
 * layer is drawn in", then woodland, then cultivated ground, then buildings.
 */
export const TINT_WOOD = 1;
export const TINT_FIELD = TINT_WOOD + WOOD_COUNT;
export const TINT_PASTEL = TINT_FIELD + FIELD_COUNT;

export function paletteOf(t: Theme): string[] {
  return ["", ...t.wood, ...t.field, ...t.buildings];
}

/**
 * Push the theme onto the document as CSS custom properties. The chrome reads
 * only these, so a preset change is one call and no stylesheet edit.
 */
export function applyChrome(t: Theme, root: HTMLElement = document.documentElement) {
  const s = root.style;
  s.setProperty("--im-bg", t.bg);
  s.setProperty("--im-panel", t.chrome.panel);
  s.setProperty("--im-panel-ink", t.chrome.panelInk);
  s.setProperty("--im-panel-dim", t.chrome.panelDim);
  s.setProperty("--im-line", t.chrome.line);
  s.setProperty("--im-shadow", t.chrome.shadow);
}

/** Every editable colour slot, grouped the way the dev panel shows them. */
export interface ColorSlot {
  key: string;
  label: string;
  get: (t: Theme) => string;
  set: (t: Theme, v: string) => void;
}

export interface ColorGroup {
  name: string;
  slots: ColorSlot[];
}

const slot = (
  key: string,
  label: string,
  get: (t: Theme) => string,
  set: (t: Theme, v: string) => void,
): ColorSlot => ({ key, label, get, set });

const arraySlots = (
  prefix: string,
  label: string,
  pick: (t: Theme) => string[],
  count: number,
): ColorSlot[] =>
  Array.from({ length: count }, (_, i) =>
    slot(
      `${prefix}${i}`,
      `${label} ${i + 1}`,
      (t) => pick(t)[i],
      (t, v) => { pick(t)[i] = v; },
    ));

export const COLOR_GROUPS: ColorGroup[] = [
  {
    name: "Ground",
    slots: [
      slot("bg", "background", (t) => t.bg, (t, v) => { t.bg = v; }),
      slot("landmark", "default ink", (t) => t.landmark, (t, v) => { t.landmark = v; }),
    ],
  },
  {
    name: "Roads",
    slots: [slot("road", "road", (t) => t.road, (t, v) => { t.road = v; })],
  },
  {
    name: "Terrain",
    slots: [
      ...arraySlots("wood", "woodland", (t) => t.wood, WOOD_COUNT),
      ...arraySlots("field", "field", (t) => t.field, FIELD_COUNT),
    ],
  },
  {
    name: "Buildings",
    slots: arraySlots(
      "bld",
      "family",
      (t) => t.buildings,
      TINT_FAMILY_COUNT * TINT_STEP_COUNT,
    ).map((s, i) => ({
      ...s,
      label: `family ${Math.floor(i / TINT_STEP_COUNT) + 1} · step ${(i % TINT_STEP_COUNT) + 1}`,
    })),
  },
  {
    name: "Labels",
    slots: [
      slot("label", "name", (t) => t.label, (t, v) => { t.label = v; }),
      slot("labelHalo", "halo", (t) => t.labelHalo, (t, v) => { t.labelHalo = v; }),
    ],
  },
  {
    name: "Highlights",
    slots: [
      slot("hoverSelf", "hovered building", (t) => t.hoverSelf, (t, v) => { t.hoverSelf = v; }),
      slot("routeInk", "route", (t) => t.routeInk, (t, v) => { t.routeInk = v; }),
      slot("routeWalk", "walking leg", (t) => t.routeWalk, (t, v) => { t.routeWalk = v; }),
      slot("routeFrom", "origin", (t) => t.routeFrom, (t, v) => { t.routeFrom = v; }),
      slot("routeTo", "destination", (t) => t.routeTo, (t, v) => { t.routeTo = v; }),
    ],
  },
  {
    name: "Chrome",
    slots: [
      slot("panel", "panel", (t) => t.chrome.panel, (t, v) => { t.chrome.panel = v; }),
      slot("panelInk", "panel ink", (t) => t.chrome.panelInk, (t, v) => { t.chrome.panelInk = v; }),
      slot("panelDim", "panel dim", (t) => t.chrome.panelDim, (t, v) => { t.chrome.panelDim = v; }),
    ],
  },
];

export interface NumberSlot {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  get: (t: Theme) => number;
  set: (t: Theme, v: number) => void;
}

export const NUMBER_SLOTS: NumberSlot[] = [
  {
    key: "labelScale", label: "label size", min: 0.5, max: 2, step: 0.05,
    get: (t) => t.labelScale, set: (t, v) => { t.labelScale = v; },
  },
  {
    key: "alphaFloor", label: "building alpha floor", min: 0.02, max: 0.9, step: 0.01,
    get: (t) => t.buildAlpha[0],
    set: (t, v) => { rampBuildAlpha(t, v, t.buildAlpha[t.buildAlpha.length - 1]); },
  },
  {
    key: "alphaCeil", label: "building alpha ceiling", min: 0.1, max: 1, step: 0.01,
    get: (t) => t.buildAlpha[t.buildAlpha.length - 1],
    set: (t, v) => { rampBuildAlpha(t, t.buildAlpha[0], v); },
  },
  {
    key: "buildingGain", label: "building gain", min: 0.2, max: 1.4, step: 0.02,
    get: (t) => t.buildingGain, set: (t, v) => { t.buildingGain = v; },
  },
  {
    key: "farContrast", label: "far-zoom contrast", min: 1, max: 7, step: 0.1,
    get: (t) => t.farContrast, set: (t, v) => { t.farContrast = v; },
  },
  {
    key: "roadGain", label: "road alpha", min: 0, max: 1, step: 0.02,
    get: (t) => t.roadGain, set: (t, v) => { t.roadGain = v; },
  },
  {
    key: "countrysideGain", label: "countryside alpha", min: 0, max: 1, step: 0.02,
    get: (t) => t.countrysideGain, set: (t, v) => { t.countrysideGain = v; },
  },
  {
    key: "wildGain", label: "wilderness alpha", min: 0, max: 1, step: 0.02,
    get: (t) => t.wildGain, set: (t, v) => { t.wildGain = v; },
  },
  {
    key: "hoverSubLift", label: "hover: same host", min: 0.3, max: 2, step: 0.02,
    get: (t) => t.hoverSubLift, set: (t, v) => { t.hoverSubLift = v; },
  },
  {
    key: "hoverDomLift", label: "hover: same domain", min: 0.3, max: 2, step: 0.02,
    get: (t) => t.hoverDomLift, set: (t, v) => { t.hoverDomLift = v; },
  },
];

/**
 * Redistribute the alpha ramp between a floor and a ceiling.
 *
 * Gamma 1.35 rather than linear: the ramp exists so the quiet majority of
 * pages stay quiet, and a straight line spends too much of the range on them.
 */
function rampBuildAlpha(t: Theme, lo: number, hi: number) {
  const n = t.buildAlpha.length;
  for (let i = 0; i < n; i++) {
    const f = Math.pow(i / (n - 1), 1.35);
    t.buildAlpha[i] = lo + (hi - lo) * f;
  }
}
