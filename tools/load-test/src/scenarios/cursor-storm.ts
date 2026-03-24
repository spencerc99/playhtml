// ABOUTME: Cursor-storm scenario: all users send continuous awareness (cursor) updates only.
// ABOUTME: Tests the ceiling on pure presence/awareness load with no Y.Doc writes.

import type { Scenario } from "./index.js";

export const cursorStorm: Scenario = {
  name: "cursor-storm",
  description: "All users send cursor position awareness updates at high frequency. No Y.Doc writes.",
  defaults: {
    rampUpSeconds: 60,
    writeRateHz: 0,
    awarenessRateHz: 10,
  },
  tick(client, tickIndex, params) {
    const ticksPerAwareness = Math.round(10 / params.awarenessRateHz);
    if (tickIndex % ticksPerAwareness === 0) {
      client.setAwareness({
        x: Math.random() * 1920,
        y: Math.random() * 1080,
      });
    }
  },
};
