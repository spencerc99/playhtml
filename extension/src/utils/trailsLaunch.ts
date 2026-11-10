// ABOUTME: Parses the page-hash switch that opens the trails overlay without a click.
// ABOUTME: Lets an agent or operator load `page#wwo-trails=everyone` to record everyone's trails.

import type { TrailSource } from "../storage/historyLoader";

export type TrailsLaunch = {
  source: TrailSource;
  uiHidden: boolean;
};

/**
 * Reads `#wwo-trails=everyone|mine` (plus optional `&wwo-ui=hidden`) from a
 * location hash. Other hash content is ignored, so the switch can follow an
 * anchor: `#History&wwo-trails=everyone`.
 */
export function parseTrailsLaunch(hash: string): TrailsLaunch | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const source = params.get("wwo-trails");
  if (source !== "everyone" && source !== "mine") return null;
  return { source, uiHidden: params.get("wwo-ui") === "hidden" };
}
