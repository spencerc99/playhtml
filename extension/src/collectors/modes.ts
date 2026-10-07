// ABOUTME: Collection mode vocabulary and per-collector mode capabilities.
// ABOUTME: Owns the storage key shape and normalizes stored values to modes a collector supports.

export type CollectionMode = "off" | "local" | "shared";

export const ALL_COLLECTION_MODES: readonly CollectionMode[] = [
  "off",
  "local",
  "shared",
] as const;

/**
 * Modes without sharing. Scraps (the "element" collector) capture image and icon
 * content from pages, which can carry private browsing content, so they are never
 * offered as shareable.
 */
const LOCAL_ONLY_MODES: readonly CollectionMode[] = ["off", "local"] as const;

const COLLECTOR_MODES: Record<string, readonly CollectionMode[]> = {
  element: LOCAL_ONLY_MODES,
};

export function collectionModesFor(
  type: string,
): readonly CollectionMode[] {
  return COLLECTOR_MODES[type] ?? ALL_COLLECTION_MODES;
}

export function supportsSharedCollection(type: string): boolean {
  return collectionModesFor(type).includes("shared");
}

export function isCollectionMode(value: unknown): value is CollectionMode {
  return ALL_COLLECTION_MODES.includes(value as CollectionMode);
}

export function collectionModeStorageKey(type: string): string {
  return `collection_mode_${type}`;
}

/**
 * Turn a stored value into a mode the collector actually supports. Unknown values
 * and modes a collector has dropped (e.g. an "element" mode stored as "shared"
 * before sharing was removed) fall back to "local".
 */
export function normalizeCollectionMode(
  type: string,
  value: unknown,
): CollectionMode {
  const supported = collectionModesFor(type);
  return supported.includes(value as CollectionMode)
    ? (value as CollectionMode)
    : "local";
}
