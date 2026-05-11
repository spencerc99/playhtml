// ABOUTME: Hand-curated matrix of visualizations to capture as art-piece previews.
// ABOUTME: Edit this file to add/remove cells. Each cell becomes one mp4.

export interface CaptureCell {
  /** File-safe name; becomes `<name>.mp4` in the output directory. */
  name: string;
  /** Query-string params merged into the URL. Same keys parsed by
   *  `parseSettingsFromUrl` / `parseVizFromUrl` / `parseDomainFromUrl` /
   *  `parsePathFromUrl` / `parseTimeRangeFromUrl` in
   *  `extension/website/shared/config.ts`.
   *
   *  Common keys:
   *    viz                 csv of visualization ids ("trails,clicks,navigation")
   *    domain              exact domain match ("google.com")
   *    path                URL path prefix ("/maps") — combine with domain
   *    startMs / endMs     scope to a time range (epoch ms)
   *    trailStyle          "straight" | "smooth" | "organic" | "chaotic"
   *    trailAnimationMode  "natural" | "stagger"
   *    animationSpeed      number
   *    randomizeColors     true | false
   *    navigationViewMode  "timeline" | "radial"
   *    keyboardDisplayMode "full" | "abstract"
   */
  params: Record<string, string | number | boolean>;
  /** Recording length in ms. Defaults to 15000. */
  durationMs?: number;
}

export const CELLS: CaptureCell[] = [];
