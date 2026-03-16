// ABOUTME: Live-chat scenario: users append messages to a persistent growing array.
// ABOUTME: Tests growing doc sync cost and cold-join latency as history accumulates.

import type { Scenario } from "./index.js";

export const liveChat: Scenario = {
  name: "live-chat",
  description:
    "Users append messages to a shared growing array. Tests cold-join latency as history grows.",
  defaults: {
    rampUpSeconds: 40,
    writeRateHz: 0.1, // ~1 message per 10s per user
    awarenessRateHz: 2,
  },
  tick(client, tickIndex, params) {
    const ticksPerWrite = Math.round(10 / params.writeRateHz);
    if (params.writeRateHz > 0 && tickIndex % ticksPerWrite === 0) {
      client.appendToArray(["live-chat", "messages"], {
        authorId: client.clientId,
        text: `msg-${tickIndex}-${Math.random().toString(36).slice(2, 8)}`,
        ts: Date.now(),
      });
    }

    const ticksPerAwareness = Math.round(10 / params.awarenessRateHz);
    if (tickIndex % ticksPerAwareness === 0) {
      client.setAwareness({ typing: Math.random() > 0.8 });
    }
  },
};
