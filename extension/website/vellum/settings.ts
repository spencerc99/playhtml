// ABOUTME: Spec-driven parameters for the vellum visualization (data, composition, fan, page, scroll, trails, playback).
// ABOUTME: Defines the settings shape, defaults, the dev-panel param spec, and localStorage persistence helpers.
import type { GroupingMode } from "./types";

export type BlendMode = "multiply" | "normal" | "darken" | "luminosity";
export type InkMode = "participant" | "riso" | "mono";
export type TrailsDrawMode = "reveal" | "window";

export interface VellumSettings {
  // data
  groupingMode: GroupingMode;
  maxSheets: number;
  minEventsPerSheet: number;
  domainFilter: string;

  // composition
  frameAspect: number;
  frameScale: number;
  paperColor: string;
  blendMode: BlendMode;
  sheetOpacity: number;
  showSheetEdges: boolean;
  showLabels: boolean;

  // fan
  spread: number;
  fanDistance: number;
  fanAngleDeg: number;
  rotateJitterDeg: number;
  hoverLift: boolean;

  // page
  showPages: boolean;
  maxPageLayers: number;
  pageOpacity: number;
  pageGrayscale: boolean;
  showGhostTitles: boolean;

  // scroll
  showScrollFrame: boolean;
  scrollFrameOpacity: number;

  // trails
  showTrails: boolean;
  strokeWidth: number;
  trailOpacity: number;
  inkMode: InkMode;
  monoColor: string;
  showClicks: boolean;
  clickRadius: number;
  smoothing: boolean;

  // playback
  animate: boolean;
  loopSeconds: number;
  trailsDrawMode: TrailsDrawMode;
}

export const DEFAULT_VELLUM_SETTINGS: VellumSettings = {
  groupingMode: "page-visit",
  maxSheets: 10,
  minEventsPerSheet: 8,
  domainFilter: "",

  frameAspect: 1.6,
  frameScale: 0.8,
  paperColor: "#f5f1e8",
  blendMode: "multiply",
  sheetOpacity: 0.12,
  showSheetEdges: true,
  showLabels: true,

  spread: 0,
  fanDistance: 34,
  fanAngleDeg: 30,
  rotateJitterDeg: 1.5,
  hoverLift: true,

  showPages: true,
  maxPageLayers: 4,
  pageOpacity: 0.35,
  pageGrayscale: true,
  showGhostTitles: true,

  showScrollFrame: true,
  scrollFrameOpacity: 0.5,

  showTrails: true,
  strokeWidth: 2.5,
  trailOpacity: 0.8,
  inkMode: "participant",
  monoColor: "#1d3fa8",
  showClicks: true,
  clickRadius: 9,
  smoothing: true,

  animate: true,
  loopSeconds: 20,
  trailsDrawMode: "reveal",
};

type ParamControl =
  | { type: "slider"; min: number; max: number; step: number }
  | { type: "select"; options: readonly string[] }
  | { type: "toggle" }
  | { type: "color" }
  | { type: "text" };

export interface ParamSpec {
  key: keyof VellumSettings;
  label: string;
  group: string;
  control: ParamControl;
}

export const VELLUM_PARAM_SPEC: ParamSpec[] = [
  // data
  {
    key: "groupingMode",
    label: "grouping",
    group: "data",
    control: { type: "select", options: ["page-visit", "domain", "day"] },
  },
  {
    key: "maxSheets",
    label: "max sheets",
    group: "data",
    control: { type: "slider", min: 1, max: 30, step: 1 },
  },
  {
    key: "minEventsPerSheet",
    label: "min events/sheet",
    group: "data",
    control: { type: "slider", min: 0, max: 100, step: 1 },
  },
  {
    key: "domainFilter",
    label: "domain filter",
    group: "data",
    control: { type: "text" },
  },

  // composition
  {
    key: "frameAspect",
    label: "frame aspect",
    group: "composition",
    control: { type: "slider", min: 0.6, max: 2.4, step: 0.05 },
  },
  {
    key: "frameScale",
    label: "frame scale",
    group: "composition",
    control: { type: "slider", min: 0.3, max: 1, step: 0.01 },
  },
  {
    key: "paperColor",
    label: "paper color",
    group: "composition",
    control: { type: "color" },
  },
  {
    key: "blendMode",
    label: "blend mode",
    group: "composition",
    control: {
      type: "select",
      options: ["multiply", "normal", "darken", "luminosity"],
    },
  },
  {
    key: "sheetOpacity",
    label: "sheet opacity",
    group: "composition",
    control: { type: "slider", min: 0, max: 0.5, step: 0.01 },
  },
  {
    key: "showSheetEdges",
    label: "sheet edges",
    group: "composition",
    control: { type: "toggle" },
  },
  {
    key: "showLabels",
    label: "labels",
    group: "composition",
    control: { type: "toggle" },
  },

  // fan
  {
    key: "spread",
    label: "spread",
    group: "fan",
    control: { type: "slider", min: 0, max: 1, step: 0.01 },
  },
  {
    key: "fanDistance",
    label: "fan distance",
    group: "fan",
    control: { type: "slider", min: 0, max: 120, step: 1 },
  },
  {
    key: "fanAngleDeg",
    label: "fan angle",
    group: "fan",
    control: { type: "slider", min: -180, max: 180, step: 1 },
  },
  {
    key: "rotateJitterDeg",
    label: "rotate jitter",
    group: "fan",
    control: { type: "slider", min: 0, max: 8, step: 0.1 },
  },
  {
    key: "hoverLift",
    label: "hover lift",
    group: "fan",
    control: { type: "toggle" },
  },

  // page
  {
    key: "showPages",
    label: "show pages",
    group: "page",
    control: { type: "toggle" },
  },
  {
    key: "maxPageLayers",
    label: "max page layers",
    group: "page",
    control: { type: "slider", min: 0, max: 10, step: 1 },
  },
  {
    key: "pageOpacity",
    label: "page opacity",
    group: "page",
    control: { type: "slider", min: 0, max: 1, step: 0.01 },
  },
  {
    key: "pageGrayscale",
    label: "page grayscale",
    group: "page",
    control: { type: "toggle" },
  },
  {
    key: "showGhostTitles",
    label: "ghost titles",
    group: "page",
    control: { type: "toggle" },
  },

  // scroll
  {
    key: "showScrollFrame",
    label: "scroll frame",
    group: "scroll",
    control: { type: "toggle" },
  },
  {
    key: "scrollFrameOpacity",
    label: "scroll frame opacity",
    group: "scroll",
    control: { type: "slider", min: 0, max: 1, step: 0.01 },
  },

  // trails
  {
    key: "showTrails",
    label: "show trails",
    group: "trails",
    control: { type: "toggle" },
  },
  {
    key: "strokeWidth",
    label: "stroke width",
    group: "trails",
    control: { type: "slider", min: 0.5, max: 12, step: 0.5 },
  },
  {
    key: "trailOpacity",
    label: "trail opacity",
    group: "trails",
    control: { type: "slider", min: 0, max: 1, step: 0.01 },
  },
  {
    key: "inkMode",
    label: "ink mode",
    group: "trails",
    control: { type: "select", options: ["participant", "riso", "mono"] },
  },
  {
    key: "monoColor",
    label: "mono color",
    group: "trails",
    control: { type: "color" },
  },
  {
    key: "showClicks",
    label: "show clicks",
    group: "trails",
    control: { type: "toggle" },
  },
  {
    key: "clickRadius",
    label: "click radius",
    group: "trails",
    control: { type: "slider", min: 2, max: 30, step: 1 },
  },
  {
    key: "smoothing",
    label: "smoothing",
    group: "trails",
    control: { type: "toggle" },
  },

  // playback
  {
    key: "animate",
    label: "animate",
    group: "playback",
    control: { type: "toggle" },
  },
  {
    key: "loopSeconds",
    label: "loop seconds",
    group: "playback",
    control: { type: "slider", min: 4, max: 120, step: 1 },
  },
  {
    key: "trailsDrawMode",
    label: "draw mode",
    group: "playback",
    control: { type: "select", options: ["reveal", "window"] },
  },
];

const STORAGE_KEY = "vellum-settings-v1";

/** Reads persisted settings from localStorage, merging stored values over the
 * defaults so a settings-shape change (a newly added param) always has a
 * default rather than `undefined`. */
export function loadSettings(): VellumSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VELLUM_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_VELLUM_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_VELLUM_SETTINGS };
  }
}

export function saveSettings(settings: VellumSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* ignore — private-browsing / storage-full shouldn't crash the page */
  }
}
