// ABOUTME: Pure message-protocol helpers shared by the wayfarer shell page and its tests.
// ABOUTME: Builds the framed map URL, validates inbound map messages, and shapes outbound journeys.

import type { Journey } from "./journey";

/** Marker on every message the map sends up to the shell. */
export const MAP_MESSAGE_SOURCE = "wwo-internet-map";

/** Marker on every message the shell sends down to the map. */
export const WAYFARER_MESSAGE_SOURCE = "wwo-wayfarer";

export type MapWalkState = "locating" | "walking" | "arrived" | "lost";

export interface MapPlace {
  name: string;
  host: string;
  domain: string;
}

export interface MapReadyMessage {
  source: typeof MAP_MESSAGE_SOURCE;
  type: "ready";
}

export interface MapStatusMessage {
  source: typeof MAP_MESSAGE_SOURCE;
  type: "status";
  state: MapWalkState;
  place: MapPlace | null;
  text: string;
}

export type MapMessage = MapReadyMessage | MapStatusMessage;

export interface JourneyMessage {
  source: typeof WAYFARER_MESSAGE_SOURCE;
  type: "journey";
  stops: Journey["stops"];
}

const WALK_STATES: MapWalkState[] = ["locating", "walking", "arrived", "lost"];

/** `?widget=1` on the map URL, respecting a query string it may already carry. */
export function buildWidgetSrc(base: string): string {
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}widget=1`;
}

/** Origin the map frame will post from — the only origin we talk to. */
export function mapOrigin(base: string): string {
  try {
    return new URL(base).origin;
  } catch {
    return "*";
  }
}

function isMapPlace(value: unknown): value is MapPlace {
  if (!value || typeof value !== "object") return false;
  const place = value as Record<string, unknown>;
  return (
    typeof place.name === "string" &&
    typeof place.host === "string" &&
    typeof place.domain === "string"
  );
}

/** True only for the two message shapes the map is allowed to send us. */
export function isMapMessage(value: unknown): value is MapMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.source !== MAP_MESSAGE_SOURCE) return false;
  if (message.type === "ready") return true;
  if (message.type !== "status") return false;
  if (typeof message.text !== "string") return false;
  if (!WALK_STATES.includes(message.state as MapWalkState)) return false;
  return message.place === null || isMapPlace(message.place);
}

/** The whole journey, oldest stop first. The map diffs it, so re-sending is cheap. */
export function buildJourneyMessage(journey: Journey): JourneyMessage {
  return {
    source: WAYFARER_MESSAGE_SOURCE,
    type: "journey",
    stops: journey.stops.map((stop) => ({
      url: stop.url,
      title: stop.title,
      ts: stop.ts,
    })),
  };
}

/** Full-page map, opened walking, centred on wherever the person is now. */
export function openMapUrl(base: string, journey: Journey): string {
  const separator = base.includes("?") ? "&" : "?";
  const latest = journey.stops[journey.stops.length - 1];
  let host = "";
  if (latest) {
    try {
      host = new URL(latest.url).hostname;
    } catch {
      host = "";
    }
  }
  const query = host ? `walk=1&q=${encodeURIComponent(host)}` : "walk=1";
  return `${base}${separator}${query}`;
}
