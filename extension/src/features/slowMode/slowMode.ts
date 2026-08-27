// ABOUTME: Defines Slow Mode navigation policy, consent gates, and persisted ride state.
// ABOUTME: Keeps interception decisions deterministic and separate from browser listeners.

import { getDomain } from "tldts";

export const SLOW_MODE_SETTINGS_KEY = "slowModeSettings";
export const SLOW_MODE_STATE_KEY = "slowModeState";
export const SLOW_MODE_COOLDOWN_MS = 25 * 60 * 1_000;
export const SLOW_MODE_RIDE_LOG_LIMIT = 30;

export interface SlowModeSettings {
  enabled: boolean;
  chancePercent: number;
}

export const DEFAULT_SLOW_MODE_SETTINGS: SlowModeSettings = {
  enabled: false,
  chancePercent: 30,
};

export type SlowModeRideOutcome = "riding" | "arrived" | "teleported" | "left";

export interface SlowModeRide {
  id: string;
  destinationUrl: string;
  destinationDomain: string;
  startedAt: number;
  stopCount: number;
  outcome: SlowModeRideOutcome;
}

export interface SlowModeState {
  lastCommuteAt: number | null;
  lastCommuteByDomain: Record<string, string>;
  rides: SlowModeRide[];
}

export interface FarJumpNavigation {
  previousUrl: string | null;
  destinationUrl: string;
  transitionType: string;
  transitionQualifiers: string[];
}

export type SlowModeDecisionReason =
  | "commute"
  | "disabled"
  | "not-far"
  | "chance"
  | "global-cooldown"
  | "domain-cooldown";

export interface SlowModeDecision {
  shouldCommute: boolean;
  reason: SlowModeDecisionReason;
}

export function isSlowModeRideOutcome(
  value: unknown,
): value is SlowModeRideOutcome {
  return (
    value === "riding" ||
    value === "arrived" ||
    value === "teleported" ||
    value === "left"
  );
}

const DELIBERATE_TRANSITIONS = new Set([
  "typed",
  "auto_bookmark",
  "generated",
]);
const NEVER_TRANSITIONS = new Set(["link", "form_submit", "reload"]);
const PROTECTED_HOST_PREFIXES = ["mail.", "calendar.", "docs."];
const AUTHENTICATION_HOST_LABELS = new Set([
  "auth",
  "idp",
  "idpproxy",
  "login",
  "mysignin",
  "mysignins",
  "signin",
  "signins",
  "sso",
]);
const PRIVATE_HOSTS = new Set([
  "accounts.google.com",
  "calendar.google.com",
  "docs.google.com",
  "drive.google.com",
  "mail.google.com",
  "outlook.live.com",
  "outlook.office.com",
]);
const PROTECTED_PATH_SEGMENTS = new Set([
  "account",
  "auth",
  "authorize",
  "billing",
  "cart",
  "checkout",
  "login",
  "oauth",
  "pay",
  "payment",
  "signin",
  "sso",
]);
const AUTHENTICATION_PATH_MARKERS = [
  "oauth2callback",
  "saml2acs",
  "signinoidc",
  "simplesaml",
];

function isWebUrl(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function isNewTabUrl(value: string | null): boolean {
  if (!value) return false;
  return (
    value === "about:newtab" ||
    value.startsWith("chrome://newtab") ||
    value.startsWith("edge://newtab") ||
    value.startsWith("brave://newtab")
  );
}

function isPrivateNetworkHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1" || hostname.endsWith(".local")) return true;

  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) {
    return false;
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

function isProtectedDestination(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  if (isPrivateNetworkHostname(hostname)) return true;
  if (PRIVATE_HOSTS.has(hostname)) return true;
  if (PROTECTED_HOST_PREFIXES.some((prefix) => hostname.startsWith(prefix))) {
    return true;
  }
  if (
    hostname
      .split(".")
      .some((label) => AUTHENTICATION_HOST_LABELS.has(label))
  ) {
    return true;
  }

  return url.pathname
    .toLowerCase()
    .split("/")
    .filter(Boolean)
    .some((segment) => {
      const label = segment.replace(/[^a-z0-9]+/g, "");
      return (
        PROTECTED_PATH_SEGMENTS.has(label) ||
        AUTHENTICATION_PATH_MARKERS.some((marker) => label.includes(marker))
      );
    });
}

function siteDomain(url: URL): string | null {
  return getDomain(url.hostname, { allowPrivateDomains: true });
}

export function destinationDomain(destinationUrl: string): string {
  const url = new URL(destinationUrl);
  return siteDomain(url) ?? url.hostname.replace(/^www\./, "").toLowerCase();
}

export function dayKey(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isFarJump(navigation: FarJumpNavigation): boolean {
  if (NEVER_TRANSITIONS.has(navigation.transitionType)) return false;
  if (navigation.transitionQualifiers.includes("forward_back")) return false;

  let destination: URL;
  try {
    destination = new URL(navigation.destinationUrl);
  } catch {
    return false;
  }
  if (!isWebUrl(destination) || isProtectedDestination(destination)) return false;

  if (navigation.previousUrl) {
    try {
      const previous = new URL(navigation.previousUrl);
      const previousSite = siteDomain(previous);
      const destinationSite = siteDomain(destination);
      if (previousSite && destinationSite && previousSite === destinationSite) {
        return false;
      }
    } catch {
      if (!isNewTabUrl(navigation.previousUrl)) return false;
    }
  }

  return (
    DELIBERATE_TRANSITIONS.has(navigation.transitionType) ||
    isNewTabUrl(navigation.previousUrl)
  );
}

export function getCooldownStatus(
  state: SlowModeState,
  now: number,
): { ready: boolean; remainingMs: number } {
  if (state.lastCommuteAt === null) return { ready: true, remainingMs: 0 };
  const remainingMs = Math.max(
    0,
    state.lastCommuteAt + SLOW_MODE_COOLDOWN_MS - now,
  );
  return { ready: remainingMs === 0, remainingMs };
}

export function evaluateSlowModeNavigation(
  navigation: FarJumpNavigation,
  settings: SlowModeSettings,
  state: SlowModeState,
  now: number,
  random: () => number = Math.random,
): SlowModeDecision {
  if (!settings.enabled) return { shouldCommute: false, reason: "disabled" };
  if (!isFarJump(navigation)) {
    return { shouldCommute: false, reason: "not-far" };
  }
  if (!getCooldownStatus(state, now).ready) {
    return { shouldCommute: false, reason: "global-cooldown" };
  }

  const domain = destinationDomain(navigation.destinationUrl);
  if (state.lastCommuteByDomain[domain] === dayKey(now)) {
    return { shouldCommute: false, reason: "domain-cooldown" };
  }
  if (random() >= settings.chancePercent / 100) {
    return { shouldCommute: false, reason: "chance" };
  }
  return { shouldCommute: true, reason: "commute" };
}

export function recordSlowModeRide(
  state: SlowModeState,
  ride: Omit<SlowModeRide, "id" | "destinationDomain">,
): SlowModeState {
  const domain = destinationDomain(ride.destinationUrl);
  const entry: SlowModeRide = {
    ...ride,
    id: `${ride.startedAt}:${domain}`,
    destinationDomain: domain,
  };
  return {
    ...state,
    lastCommuteAt: ride.startedAt,
    lastCommuteByDomain: {
      ...state.lastCommuteByDomain,
      [domain]: dayKey(ride.startedAt),
    },
    rides: [entry, ...state.rides.filter((item) => item.id !== entry.id)].slice(
      0,
      SLOW_MODE_RIDE_LOG_LIMIT,
    ),
  };
}

export function updateSlowModeRide(
  state: SlowModeState,
  rideId: string,
  outcome: SlowModeRideOutcome,
): SlowModeState {
  return {
    ...state,
    rides: state.rides.map((ride) =>
      ride.id === rideId ? { ...ride, outcome } : ride,
    ),
  };
}

export function createCommuteUrl(
  commutePageUrl: string,
  destinationUrl: string,
  rideId?: string,
  stopCount?: number,
): string {
  const url = new URL(commutePageUrl);
  url.searchParams.set("slow", "1");
  url.searchParams.set("destination", destinationUrl);
  if (rideId) url.searchParams.set("ride", rideId);
  if (stopCount) url.searchParams.set("stops", String(stopCount));
  return url.toString();
}

export function normalizeSlowModeSettings(value: unknown): SlowModeSettings {
  if (!value || typeof value !== "object") return DEFAULT_SLOW_MODE_SETTINGS;
  const stored = value as Record<string, unknown>;
  return {
    enabled:
      typeof stored.enabled === "boolean"
        ? stored.enabled
        : DEFAULT_SLOW_MODE_SETTINGS.enabled,
    chancePercent:
      typeof stored.chancePercent === "number" &&
      Number.isFinite(stored.chancePercent)
        ? Math.min(100, Math.max(10, Math.round(stored.chancePercent / 10) * 10))
        : DEFAULT_SLOW_MODE_SETTINGS.chancePercent,
  };
}

export function normalizeSlowModeState(value: unknown): SlowModeState {
  const empty: SlowModeState = {
    lastCommuteAt: null,
    lastCommuteByDomain: {},
    rides: [],
  };
  if (!value || typeof value !== "object") return empty;
  const stored = value as Partial<SlowModeState>;
  return {
    lastCommuteAt:
      typeof stored.lastCommuteAt === "number" ? stored.lastCommuteAt : null,
    lastCommuteByDomain:
      stored.lastCommuteByDomain &&
      typeof stored.lastCommuteByDomain === "object"
        ? stored.lastCommuteByDomain
        : {},
    rides: Array.isArray(stored.rides)
      ? stored.rides.filter((ride): ride is SlowModeRide => {
          if (!ride || typeof ride !== "object") return false;
          const item = ride as Partial<SlowModeRide>;
          return (
            typeof item.id === "string" &&
            typeof item.destinationUrl === "string" &&
            typeof item.destinationDomain === "string" &&
            typeof item.startedAt === "number" &&
            typeof item.stopCount === "number" &&
            isSlowModeRideOutcome(item.outcome)
          );
        })
      : [],
  };
}
