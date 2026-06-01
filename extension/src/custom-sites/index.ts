// ABOUTME: Dispatches custom site logic based on the current domain.
// ABOUTME: Each site module initializes domain-specific collaborative features.

import type { PageDataChannel, PresenceAPI, PresenceRoom } from "@playhtml/common";
import type { InitOptions } from "../../../packages/playhtml/src/index";

export interface CustomSiteDeps {
  createPageData: <T>(name: string, defaultValue: T) => PageDataChannel<T>;
  createPresenceRoom: (name: string) => PresenceRoom;
  presence: PresenceAPI;
  cursorClient: any;
  playerColor: string;
}

export interface CustomSiteSettings {
  cursorsEnabled: boolean;
  defaultRoomOptions: NonNullable<InitOptions["defaultRoomOptions"]>;
}

interface CustomSiteSettingsOverride {
  cursorsEnabled?: boolean;
  defaultRoomOptions?: Partial<CustomSiteSettings["defaultRoomOptions"]>;
}

export interface CustomSitePolicy {
  matches: (hostname: string) => boolean;
  init: (deps: CustomSiteDeps) => Promise<(() => void) | null>;
  settings?: CustomSiteSettingsOverride;
}

const DEFAULT_CUSTOM_SITE_SETTINGS: CustomSiteSettings = {
  cursorsEnabled: true,
  defaultRoomOptions: { includeSearch: false },
};

function isWikipediaHostname(hostname: string): boolean {
  return hostname === "wikipedia.org" || hostname.endsWith(".wikipedia.org");
}

const CUSTOM_SITE_POLICIES: CustomSitePolicy[] = [
  {
    matches: isWikipediaHostname,
    init: async (deps) => {
      const { initWikipedia } = await import("./wikipedia");
      return initWikipedia(deps);
    },
  },
];

function mergeCustomSiteSettings(
  settings?: CustomSiteSettingsOverride,
): CustomSiteSettings {
  return {
    cursorsEnabled:
      settings?.cursorsEnabled ?? DEFAULT_CUSTOM_SITE_SETTINGS.cursorsEnabled,
    defaultRoomOptions: {
      ...DEFAULT_CUSTOM_SITE_SETTINGS.defaultRoomOptions,
      ...settings?.defaultRoomOptions,
    },
  };
}

export function resolveCustomSiteSettingsForHostname(
  hostname: string,
  policies: CustomSitePolicy[],
): CustomSiteSettings | null {
  const policy = policies.find((candidate) => candidate.matches(hostname));
  if (!policy) return null;

  return mergeCustomSiteSettings(policy.settings);
}

export function getCustomSiteSettingsForHostname(
  hostname: string,
): CustomSiteSettings | null {
  return resolveCustomSiteSettingsForHostname(hostname, CUSTOM_SITE_POLICIES);
}

export function getCustomSiteSettings(): CustomSiteSettings | null {
  return getCustomSiteSettingsForHostname(location.hostname);
}

// Returns true if the current domain should have collaborative cursors enabled.
export function shouldEnableCursors(): boolean {
  return getCustomSiteSettings()?.cursorsEnabled ?? false;
}

export function shouldEnableCursorsForHostname(hostname: string): boolean {
  return getCustomSiteSettingsForHostname(hostname)?.cursorsEnabled ?? false;
}

export async function initCustomSite(deps: CustomSiteDeps): Promise<(() => void) | null> {
  const hostname = location.hostname;
  const policy = CUSTOM_SITE_POLICIES.find((candidate) =>
    candidate.matches(hostname)
  );

  if (policy) return policy.init(deps);

  return null;
}
