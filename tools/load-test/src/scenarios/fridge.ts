// ABOUTME: Fridge scenario: users drag elements by sending frequent position mutations.
// ABOUTME: Models the fridge.html page -- high-frequency writes, tests autosave pressure.

import type { Scenario } from "./index.js";

const ELEMENT_COUNT = 3;

export const fridge: Scenario = {
  name: "fridge",
  description:
    "Users drag 1-3 elements at high frequency via SyncedStore position mutations.",
  defaults: {
    rampUpSeconds: 30,
    writeRateHz: 5,
    awarenessRateHz: 10,
  },
  tick(client, tickIndex, params) {
    const ticksPerWrite = Math.round(10 / params.writeRateHz);
    if (tickIndex % ticksPerWrite === 0) {
      const elementIdx = tickIndex % ELEMENT_COUNT;
      client.write(
        ["fridge", `element-${client.clientId}-${elementIdx}`, "position"],
        { x: Math.random() * 1920, y: Math.random() * 1080 }
      );
    }

    const ticksPerAwareness = Math.round(10 / params.awarenessRateHz);
    if (tickIndex % ticksPerAwareness === 0) {
      client.setAwareness({
        x: Math.random() * 1920,
        y: Math.random() * 1080,
      });
    }
  },
};
