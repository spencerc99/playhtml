// ABOUTME: Shared type definitions for the vellum visualization — sheets, grouping modes, and the plate prop contract.
// ABOUTME: Kept import-light so plates and grouping logic can share these shapes without pulling in React.
import type { CollectionEvent } from "../shared/types";
import type { VellumSettings } from "./settings";

/** How raw events are partitioned into sheets. */
export type GroupingMode = "page-visit" | "domain" | "day";

/** One unit of browsing normalized into the shared browser-window frame:
 * by default, one participant's visit to one page. */
export interface VellumSheet {
  id: string;
  label: string;
  sublabel: string;
  url: string;
  domain: string;
  title?: string;
  cursorEvents: CollectionEvent[];
  viewportEvents: CollectionEvent[];
  startTs: number;
  endTs: number;
  eventCount: number;
  /** Deterministic hash of `id`, used for rotation jitter and riso-mode ink. */
  seed: number;
}

/** The common contract every plate renderer receives. `t` is the sheet-local
 * playback progress (0–1); plates map it onto [sheet.startTs, sheet.endTs]
 * themselves. `isEligibleForIframe` is only meaningful to PagePlate (whether
 * this sheet is within the topmost `maxPageLayers` and gets a live iframe
 * instead of just its ghost fallback) — every plate receives it so Sheet.tsx
 * can render the plate registry uniformly, and non-page plates ignore it. */
export interface PlateProps {
  sheet: VellumSheet;
  frame: { width: number; height: number };
  t: number;
  settings: VellumSettings;
  isEligibleForIframe: boolean;
}
