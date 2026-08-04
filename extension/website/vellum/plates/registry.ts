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
  /** Settings key that gates whether this plate renders at all. */
  enabledKey: keyof VellumSettings;
}

export const PLATE_REGISTRY: PlateDef[] = [
  { id: "page", label: "Page", component: PagePlate, enabledKey: "showPages" },
  { id: "scroll", label: "Scroll", component: ScrollPlate, enabledKey: "showScrollFrame" },
  { id: "trails", label: "Trails", component: TrailsPlate, enabledKey: "showTrails" },
];
