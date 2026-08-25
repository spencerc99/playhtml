// ABOUTME: Defines the page-to-extension bridge for hosted Slow Mode rides.
// ABOUTME: Keeps exact destination URLs inside the extension while exposing safe ride metadata.

import type {
  SlowModeRideOutcome,
  SlowModeStopVisibility,
} from "./slowMode";

export const SLOW_MODE_HOSTED_BRIDGE_SOURCE = "wwo-slow-mode";
export const SLOW_MODE_HOSTED_REQUEST = "request-ride";
export const SLOW_MODE_HOSTED_RESPONSE = "ride-response";
export const SLOW_MODE_HOSTED_OUTCOME = "ride-outcome";

export interface HostedSlowModeRide {
  rideId: string;
  destinationDomain: string;
  stopVisibility: SlowModeStopVisibility;
}

interface HostedSlowModeRequestMessage {
  source: typeof SLOW_MODE_HOSTED_BRIDGE_SOURCE;
  type: typeof SLOW_MODE_HOSTED_REQUEST;
  requestId: string;
  rideId: string;
}

interface HostedSlowModeResponseMessage {
  source: typeof SLOW_MODE_HOSTED_BRIDGE_SOURCE;
  type: typeof SLOW_MODE_HOSTED_RESPONSE;
  requestId: string;
  ride: HostedSlowModeRide | null;
}

interface HostedSlowModeOutcomeMessage {
  source: typeof SLOW_MODE_HOSTED_BRIDGE_SOURCE;
  type: typeof SLOW_MODE_HOSTED_OUTCOME;
  rideId: string;
  outcome: SlowModeRideOutcome;
  navigate: boolean;
}

export function isHostedCommuteUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://wewere.online" &&
      (url.pathname === "/commute" || url.pathname === "/commute/")
    );
  } catch {
    return false;
  }
}

export function getHostedSlowModeRideId(hash: string): string | null {
  const rideId = new URLSearchParams(hash.replace(/^#/, "")).get("ride");
  return rideId && /^[0-9a-f-]{36}$/i.test(rideId) ? rideId : null;
}

export function isHostedSlowModeRequest(
  value: unknown,
): value is HostedSlowModeRequestMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<HostedSlowModeRequestMessage>;
  return (
    message.source === SLOW_MODE_HOSTED_BRIDGE_SOURCE &&
    message.type === SLOW_MODE_HOSTED_REQUEST &&
    typeof message.requestId === "string" &&
    typeof message.rideId === "string"
  );
}

export function isHostedSlowModeOutcome(
  value: unknown,
): value is HostedSlowModeOutcomeMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<HostedSlowModeOutcomeMessage>;
  return (
    message.source === SLOW_MODE_HOSTED_BRIDGE_SOURCE &&
    message.type === SLOW_MODE_HOSTED_OUTCOME &&
    typeof message.rideId === "string" &&
    (message.outcome === "arrived" ||
      message.outcome === "teleported" ||
      message.outcome === "left") &&
    typeof message.navigate === "boolean"
  );
}

export function requestHostedSlowModeRide(
  rideId: string,
  timeoutMs = 1_000,
): Promise<HostedSlowModeRide | null> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", receiveResponse);
      resolve(null);
    }, timeoutMs);
    const receiveResponse = (event: MessageEvent) => {
      if (event.source !== window) return;
      const message = event.data as Partial<HostedSlowModeResponseMessage>;
      if (
        message.source !== SLOW_MODE_HOSTED_BRIDGE_SOURCE ||
        message.type !== SLOW_MODE_HOSTED_RESPONSE ||
        message.requestId !== requestId
      ) {
        return;
      }
      window.clearTimeout(timer);
      window.removeEventListener("message", receiveResponse);
      resolve(message.ride ?? null);
    };
    window.addEventListener("message", receiveResponse);
    window.postMessage(
      {
        source: SLOW_MODE_HOSTED_BRIDGE_SOURCE,
        type: SLOW_MODE_HOSTED_REQUEST,
        requestId,
        rideId,
      } satisfies HostedSlowModeRequestMessage,
      window.location.origin,
    );
  });
}

export function reportHostedSlowModeOutcome(
  rideId: string,
  outcome: SlowModeRideOutcome,
  navigate: boolean,
): void {
  window.postMessage(
    {
      source: SLOW_MODE_HOSTED_BRIDGE_SOURCE,
      type: SLOW_MODE_HOSTED_OUTCOME,
      rideId,
      outcome,
      navigate,
    } satisfies HostedSlowModeOutcomeMessage,
    window.location.origin,
  );
}
