// ABOUTME: Owns extension player identity storage and public profile reads.
// ABOUTME: Separates private signing keys from public identity and browsing profile state.

import browser from "webextension-polyfill";
import {
  isPresenceRecord,
  toPublicPlayerIdentity,
  type PlayerIdentity,
} from "@playhtml/common";

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

// Verifiable identities use ECDSA P-256 raw public keys: 130 hex chars plus "pk_".
function needsVerifiableKey(publicKey: string): boolean {
  return !publicKey.startsWith("pk_") || publicKey.length < 100;
}

function randomHslColor(): string {
  const hue = Math.floor(Math.random() * 360);
  const s = 65 + Math.floor(Math.random() * 15); // 65-80%
  const l = 55 + Math.floor(Math.random() * 15); // 55-70%
  return `hsl(${hue}, ${s}%, ${l}%)`;
}

async function generateEcdsaKeypair(): Promise<{
  publicKey: string;
  privateKey: JsonWebKey;
}> {
  const keypair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const pubRaw = await crypto.subtle.exportKey("raw", keypair.publicKey);
  const pubHex =
    "pk_" +
    Array.from(new Uint8Array(pubRaw))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  const privateKey = await crypto.subtle.exportKey("jwk", keypair.privateKey);

  return { publicKey: pubHex, privateKey };
}

function toDiscoveredSites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (site): site is string => typeof site === "string" && site.length > 0,
  );
}

function readStoredPlayerIdentity(value: unknown): StoredPlayerIdentity | null {
  if (!isPresenceRecord(value)) return null;

  const publicSource = isPresenceRecord(value.public) ? value.public : value;
  const privateKey = isPresenceRecord(value.privateKey)
    ? (value.privateKey as JsonWebKey)
    : null;

  const publicIdentity = toPublicPlayerIdentity(publicSource);

  if (!publicIdentity?.playerStyle.colorPalette[0] || !privateKey) return null;

  return {
    public: publicIdentity,
    privateKey,
  };
}

async function readIdentityStorage() {
  return browser.storage.local.get([
    PLAYER_IDENTITY_STORAGE_KEY,
    DISCOVERED_SITES_STORAGE_KEY,
  ]);
}

export async function saveStoredPlayerIdentity(
  identity: StoredPlayerIdentity,
): Promise<void> {
  await browser.storage.local.set({
    [PLAYER_IDENTITY_STORAGE_KEY]: identity,
  });
}

export async function getStoredPlayerIdentity(): Promise<StoredPlayerIdentity | null> {
  const result = await readIdentityStorage();
  const rawIdentity = result[PLAYER_IDENTITY_STORAGE_KEY];
  const storedIdentity = readStoredPlayerIdentity(rawIdentity);
  if (!storedIdentity) return null;

  const updates: Record<string, unknown> = {};
  const rawIdentityRecord = isPresenceRecord(rawIdentity) ? rawIdentity : {};
  const rawPublic = isPresenceRecord(rawIdentityRecord.public)
    ? rawIdentityRecord.public
    : undefined;
  const hasStoredShape = rawPublic !== undefined;
  const needsIdentityWrite =
    !hasStoredShape ||
    Object.keys(rawIdentityRecord).some(
      (key) => key !== "public" && key !== "privateKey",
    ) ||
    JSON.stringify(rawPublic) !== JSON.stringify(storedIdentity.public);

  if (needsIdentityWrite) {
    updates[PLAYER_IDENTITY_STORAGE_KEY] = storedIdentity;
  }

  if (!Array.isArray(result[DISCOVERED_SITES_STORAGE_KEY])) {
    const discoveredSites = toDiscoveredSites(rawIdentityRecord.discoveredSites);
    if (discoveredSites.length > 0) {
      updates[DISCOVERED_SITES_STORAGE_KEY] = discoveredSites;
    }
  }

  if (Object.keys(updates).length > 0) {
    await browser.storage.local.set(updates);
  }

  return storedIdentity;
}

export async function ensurePlayerIdentity(): Promise<StoredPlayerIdentity | null> {
  const existing = await getStoredPlayerIdentity();

  if (existing && !needsVerifiableKey(existing.public.publicKey)) {
    return existing;
  }

  const { publicKey, privateKey } = await generateEcdsaKeypair();
  const colorPalette = existing?.public.playerStyle.colorPalette ?? [
    randomHslColor(),
  ];
  const identity = {
    public: {
      publicKey,
      createdAt: existing?.public.createdAt ?? Date.now(),
      playerStyle: {
        ...existing?.public.playerStyle,
        colorPalette,
      },
      ...(existing?.public.name !== undefined
        ? { name: existing.public.name }
        : {}),
    },
    privateKey,
  } satisfies StoredPlayerIdentity;

  await saveStoredPlayerIdentity(identity);
  await browser.storage.local.remove("collection_participant_id");
  return identity;
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
