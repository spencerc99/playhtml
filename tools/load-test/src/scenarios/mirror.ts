// ABOUTME: Mirror scenario: all users write to the same shared key simultaneously.
// ABOUTME: Maximum CRDT write contention -- tests conflict resolution under load.

import type { Scenario } from "./index.js";

export const mirror: Scenario = {
  name: "mirror",
  description:
    "All users write to the same shared value simultaneously. Maximum CRDT contention.",
  defaults: {
    rampUpSeconds: 30,
    writeRateHz: 2,
    awarenessRateHz: 5,
  },
  tick(client, tickIndex, params) {
    const ticksPerWrite = Math.round(10 / params.writeRateHz);
    if (tickIndex % ticksPerWrite === 0) {
      client.write(["mirror", "shared-value"], {
        lastAuthor: client.clientId,
        value: Math.random(),
        ts: Date.now(),
      });
    }

    const ticksPerAwareness = Math.round(10 / params.awarenessRateHz);
    if (tickIndex % ticksPerAwareness === 0) {
      client.setAwareness({ active: true });
    }
  },
};
