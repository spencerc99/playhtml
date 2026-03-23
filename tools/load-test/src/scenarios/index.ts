// ABOUTME: Scenario registry mapping scenario names to their implementations.
// ABOUTME: Each scenario defines default params and a tick function for each virtual user.

import type { VirtualClient } from "../client.js";

export interface ScenarioParams {
  maxUsers: number;
  duration: number;        // seconds
  rampUpSeconds: number;
  writeRateHz: number;
  awarenessRateHz: number;
  target: string;
}

export interface Scenario {
  name: string;
  description: string;
  defaults: Omit<ScenarioParams, "target" | "maxUsers" | "duration">;
  /** Called once per client per tick (~100ms). Client should write/update awareness as appropriate. */
  tick: (client: VirtualClient, tickIndex: number, params: ScenarioParams) => void;
}

import { cursorStorm } from "./cursor-storm.js";
import { liveChat } from "./live-chat.js";
import { fridge } from "./fridge.js";
import { mirror } from "./mirror.js";
import { lobbyPresence } from "./lobby-presence.js";

export const scenarios: Record<string, Scenario> = {
  "cursor-storm": cursorStorm,
  "live-chat": liveChat,
  fridge,
  mirror,
  "lobby-presence": lobbyPresence,
};
