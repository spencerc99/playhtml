// ABOUTME: Click-ripple settings defaults for cursor visualizations
// ABOUTME: Lives outside MovementCanvas to break the Controls<->MovementCanvas import cycle

export const CLICK_DEFAULTS = {
  clickMinRadius: 12,
  clickMaxRadius: 80,
  clickCoreRadius: 3,
  clickMinDuration: 500,
  clickMaxDuration: 2500,
  clickStrokeWidth: 4,
  clickOpacity: 0.6,
  clickNumRings: 3,
  clickRingDelayMs: 160,
  clickExpansionDuration: 2400,
  clickAnimationStopPoint: 0.45,
  /** Cap the gap between consecutive scheduled clicks. `null` = off (use the
   * exact natural rhythm); a number = clamp any longer dead-air to this many
   * milliseconds. Useful for promo / timelapse playback where you want
   * cluster timing intact but don't want long pauses. */
  clickMaxGapMs: null as number | null,
};
