// ABOUTME: Serializes the playground's full audible arrangement to one versioned
// ABOUTME: object and round-trips it through localStorage as the page's own default

import { GlobalSettings } from "./Globals";
import { VoicingSettings, VOICING_DEFAULTS } from "./voicing";
import { VisualConfig, VISUAL_DEFAULTS } from "./soundVisuals";
import { CantusVariant } from "../shared/sound/types";

const STORAGE_KEY = "playhtml-sound-playground-config";
const CONFIG_VERSION = 1;

/** What the Sound Layers panel switches on, and how loud each family sits. */
export interface LayerConfig {
  bassPedal: boolean;
  trailArrivals: boolean;
  navigationSounds: boolean;
  crossings: "off" | "dissonance" | "merge";
  cantus: CantusVariant | null;
}

/**
 * The entire audible arrangement, as one versioned object. Mixer solo/mute is
 * deliberately excluded — that is a listening tool for the playground, not
 * part of the arrangement a saved default should carry forward.
 */
export interface PersistedConfig {
  v: 1;
  globals: GlobalSettings;
  layers: LayerConfig;
  voicing: VoicingSettings;
  visuals: VisualConfig;
}

export const buildPersistedConfig = (
  globals: GlobalSettings,
  layers: LayerConfig,
  voicing: VoicingSettings,
  visuals: VisualConfig,
): PersistedConfig => ({
  v: CONFIG_VERSION,
  globals: { ...globals },
  layers: { ...layers },
  voicing: { ...voicing },
  visuals: { ...visuals },
});

/** Fills in any field missing or unrecognized in a saved value with its shipped default. */
const withFallback = <T extends object>(defaults: T, saved: unknown): T => {
  if (typeof saved !== "object" || saved === null) return { ...defaults };
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T>) {
    const value = (saved as Partial<T>)[key];
    if (value !== undefined) {
      result[key] = value as T[keyof T];
    }
  }
  return result;
};

export interface RestoredConfig {
  globals: GlobalSettings;
  layers: LayerConfig;
  voicing: VoicingSettings;
  visuals: VisualConfig;
}

/**
 * Merges a saved config onto the shipped defaults field by field, so an old
 * save missing a field a later feature added (or carrying a field a later
 * change dropped) still restores cleanly rather than losing the whole save.
 */
export const restoreConfig = (
  saved: unknown,
  globalDefaults: GlobalSettings,
  layerDefaults: LayerConfig,
): RestoredConfig => {
  const record = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  return {
    globals: withFallback(globalDefaults, record.globals),
    layers: withFallback(layerDefaults, record.layers),
    voicing: withFallback(VOICING_DEFAULTS, record.voicing),
    visuals: withFallback(VISUAL_DEFAULTS, record.visuals),
  };
};

export interface SavedConfigEntry {
  config: PersistedConfig;
  savedAt: string;
}

/** Reads the saved config, if any. Corrupted or unreadable storage counts as "none". */
export const loadSavedConfig = (): SavedConfigEntry | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const entry = parsed as Partial<SavedConfigEntry>;
    if (typeof entry.savedAt !== "string" || typeof entry.config !== "object" || entry.config === null) {
      return null;
    }
    return { config: entry.config as PersistedConfig, savedAt: entry.savedAt };
  } catch {
    return null;
  }
};

/** Persists the config as the page's new default. Returns whether it succeeded. */
export const saveConfig = (config: PersistedConfig): boolean => {
  try {
    const entry: SavedConfigEntry = { config, savedAt: new Date().toISOString() };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
    return true;
  } catch {
    return false;
  }
};

/** Clears the saved default. Returns whether it succeeded. */
export const clearSavedConfig = (): boolean => {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};
