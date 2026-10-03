// ABOUTME: Ordered registry of sheet plates (page, scroll, trails) rendered bottom-to-top on each sheet.
// ABOUTME: Sheet.tsx iterates this list rather than hardcoding plate components, so future plates plug in here.
import type { ComponentType } from "react";
import type { PlateProps } from "../types";
import type { VellumSettings } from "../settings";
import { PagePlate } from "./PagePlate";
import { ScrollPlate } from "./ScrollPlate";
import { TrailsPlate } from "./TrailsPlate";

export interface PlateDef {
  id: string;
  label: string;
  component: ComponentType<PlateProps>;
  /** Whether this plate renders at all, given the current settings. A
   * predicate rather than a single settings key so a plate can render off of
   * more than one toggle — e.g. PagePlate must keep rendering ghost titles
   * when `showPages` is off but `showGhostTitles` is on. */
  isEnabled: (settings: VellumSettings) => boolean;
}

export const PLATE_REGISTRY: PlateDef[] = [
  {
    id: "page",
    label: "Page",
    component: PagePlate,
    isEnabled: (s) => s.showPages || s.showGhostTitles,
  },
  {
    id: "scroll",
    label: "Scroll",
    component: ScrollPlate,
    isEnabled: (s) => s.showScrollFrame,
  },
  {
    id: "trails",
    label: "Trails",
    component: TrailsPlate,
    isEnabled: (s) => s.showTrails,
  },
];
