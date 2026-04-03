// ABOUTME: Registry of visualization components and their required event types.
// ABOUTME: Drives the multiselect UI and event fetching logic in the movement page.

export interface VisualizationDef {
  id: string;
  label: string;
  description: string;
  requiredEvents: string[];
  defaultEnabled: boolean;
}

export const VISUALIZATIONS: VisualizationDef[] = [
  {
    id: "trails",
    label: "Cursor Trails",
    description: "Animated paths of cursor movement across the screen",
    requiredEvents: ["cursor"],
    defaultEnabled: true,
  },
  {
    id: "clicks",
    label: "Click Ripples",
    description: "Expanding rings where clicks and holds occurred",
    requiredEvents: ["cursor"],
    defaultEnabled: false,
  },
  {
    id: "typing",
    label: "Keypress Grid",
    description: "Characters appearing in a spatial grid where they were typed",
    requiredEvents: ["keyboard"],
    defaultEnabled: false,
  },
  {
    id: "scrolling",
    label: "Scroll Depth",
    description: "Viewport position and scroll movement over time",
    requiredEvents: ["viewport"],
    defaultEnabled: false,
  },
  {
    id: "navigation",
    label: "Rabbit Holes",
    description: "Page visits and the paths between sites",
    requiredEvents: ["navigation"],
    defaultEnabled: false,
  },
  {
    id: "favicons",
    label: "Favicon Portrait",
    description: "Grid of site icons from pages visited over time",
    requiredEvents: ["navigation"],
    defaultEnabled: false,
  },
];

export function deriveRequiredEventTypes(activeVizIds: string[]): Set<string> {
  const types = new Set<string>();
  for (const id of activeVizIds) {
    const def = VISUALIZATIONS.find((v) => v.id === id);
    if (def) {
      for (const t of def.requiredEvents) types.add(t);
    }
  }
  return types;
}

export const DEFAULT_ACTIVE_VISUALIZATIONS = VISUALIZATIONS
  .filter((v) => v.defaultEnabled)
  .map((v) => v.id);
