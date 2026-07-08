// ABOUTME: Owns extension player identity storage and public profile reads.
// ABOUTME: Separates private signing keys from public identity and browsing profile state.

import browser from "webextension-polyfill";
import type { PlayerIdentity } from "@playhtml/common";

export const PLAYER_IDENTITY_STORAGE_KEY = "playerIdentity";
export const DISCOVERED_SITES_STORAGE_KEY = "playerDiscoveredSites";

export type StoredPlayerIdentity = {
  public: PlayerIdentity;
  privateKey: JsonWebKey;
};

export type PlayerProfile = {
  identity: PlayerIdentity | null;
  discoveredSites: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function toDiscoveredSites(value: unknown): string[] {
  return toStringArray(value).filter((site) => site.length > 0);
}

function toPrivateKey(value: unknown): JsonWebKey | null {
  if (!isRecord(value)) return null;
  return value as JsonWebKey;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function toPublicPlayerIdentity(value: unknown): PlayerIdentity | null {
  if (!isRecord(value)) return null;

  const publicKey = value.publicKey;
  if (typeof publicKey !== "string" || publicKey.length === 0) return null;

  const sourceStyle = isRecord(value.playerStyle) ? value.playerStyle : {};
  const colorPalette = toStringArray(sourceStyle.colorPalette).filter(
    (color) => color.length > 0,
  );
  if (colorPalette.length === 0) return null;

  const publicIdentity: PlayerIdentity = {
    publicKey,
    playerStyle: {
      colorPalette,
    },
  };

  if (typeof value.name === "string") {
    publicIdentity.name = value.name;
  }

  if (typeof sourceStyle.cursorStyle === "string") {
    publicIdentity.playerStyle.cursorStyle = sourceStyle.cursorStyle;
  }

  return publicIdentity;
}

function readStoredPlayerIdentity(value: unknown): StoredPlayerIdentity | null {
  if (!isRecord(value)) return null;

  const publicSource = isRecord(value.public) ? value.public : value;
  const privateSource = value.privateKey;

  const publicIdentity = toPublicPlayerIdentity(publicSource);
  const privateKey = toPrivateKey(privateSource);

  if (!publicIdentity || !privateKey) return null;

  return {
    public: publicIdentity,
    privateKey,
  };
}

function readLegacyDiscoveredSites(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return toDiscoveredSites(value.discoveredSites);
}

async function readIdentityStorage() {
  return browser.storage.local.get([
    PLAYER_IDENTITY_STORAGE_KEY,
    DISCOVERED_SITES_STORAGE_KEY,
  ]);
}

export async function getStoredPlayerIdentity(): Promise<StoredPlayerIdentity | null> {
  const result = await readIdentityStorage();
  const rawIdentity = result[PLAYER_IDENTITY_STORAGE_KEY];
  const storedIdentity = readStoredPlayerIdentity(rawIdentity);
  if (!storedIdentity) return null;

  const updates: Record<string, unknown> = {};
  const rawPublic = isRecord(rawIdentity) ? rawIdentity.public : undefined;
  const hasStoredShape = isRecord(rawIdentity) && isRecord(rawPublic);
  const needsIdentityWrite =
    !hasStoredShape ||
    !hasOnlyKeys(rawIdentity, ["public", "privateKey"]) ||
    JSON.stringify(rawPublic) !== JSON.stringify(storedIdentity.public);

  if (needsIdentityWrite) {
    updates[PLAYER_IDENTITY_STORAGE_KEY] = storedIdentity;
  }

  if (!Array.isArray(result[DISCOVERED_SITES_STORAGE_KEY])) {
    const discoveredSites = readLegacyDiscoveredSites(rawIdentity);
    if (discoveredSites.length > 0) {
      updates[DISCOVERED_SITES_STORAGE_KEY] = discoveredSites;
    }
  }

  if (Object.keys(updates).length > 0) {
    await browser.storage.local.set(updates);
  }

  return storedIdentity;
}

export async function getPublicPlayerIdentity(): Promise<PlayerIdentity | null> {
  const storedIdentity = await getStoredPlayerIdentity();
  return storedIdentity?.public ?? null;
}

export async function getPlayerProfile(): Promise<PlayerProfile> {
  const storedIdentity = await getStoredPlayerIdentity();
  const result = await browser.storage.local.get(DISCOVERED_SITES_STORAGE_KEY);
  const discoveredSites = toDiscoveredSites(result[DISCOVERED_SITES_STORAGE_KEY]);

  return {
    identity: storedIdentity?.public ?? null,
    discoveredSites,
  };
}

export async function recordDiscoveredSite(domain: string): Promise<void> {
  if (domain.length === 0) return;

  await getStoredPlayerIdentity();

  const result = await browser.storage.local.get(DISCOVERED_SITES_STORAGE_KEY);
  const discoveredSites = toDiscoveredSites(result[DISCOVERED_SITES_STORAGE_KEY]);
  if (discoveredSites.includes(domain)) return;

  await browser.storage.local.set({
    [DISCOVERED_SITES_STORAGE_KEY]: [...discoveredSites, domain],
  });
}
