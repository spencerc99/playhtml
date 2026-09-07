// ABOUTME: Serializes the playground's full audible arrangement to one versioned
// ABOUTME: object and round-trips it through localStorage as the page's own default

import { GlobalSettings } from "./SceneSettings";
import { DEFAULT_PROGRESSION_ID } from "./scales";
import { VoicingSettings, VOICING_DEFAULTS } from "./voicing";
import { CantusVariant } from "./types";

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
 * The arrangement a fresh visit opens on — the combination Spencer settled on
 * by ear in the playground. A saved config is merged over this, so a setting
 * added after a save still arrives at its shipped value.
 *
 * These live beside `restoreConfig` rather than being handed to it, so every
 * page restores against the same complete set of keys. Restoring merges saved
 * values onto the defaults key by key: a defaults object missing a key drops
 * that key from the result even when the save has it, so a caller able to pass
 * its own defaults is a caller able to silently lose part of the arrangement.
 */
export const SCENE_DEFAULTS: GlobalSettings = {
  mode: "spotlight",
  chordRotation: true,
  progression: DEFAULT_PROGRESSION_ID,
  energyArc: true,
  trailVoices: true,
  swells: true,
  choralTimbre: true,
  cursorInstruments: true,
  soloistVoice: "presence",
  traceability: 0.51,
  volume: 0.49,
};

export const LAYER_DEFAULTS: LayerConfig = {
  bassPedal: true,
  trailArrivals: true,
  navigationSounds: true,
  crossings: "off",
  /**
   * The soprano cantus sings over the crowd from the start. It carries a line
   * the trails themselves never hold long enough to state, which is what a
   * scene of short cursor gestures is otherwise missing; the soprano is the
   * one that sits clear of the ensemble's own register rather than inside it.
   */
  cantus: "soprano",
};

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
}

export const buildPersistedConfig = (
  globals: GlobalSettings,
  layers: LayerConfig,
  voicing: VoicingSettings,
): PersistedConfig => ({
  v: CONFIG_VERSION,
  globals: { ...globals },
  layers: { ...layers },
  voicing: { ...voicing },
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

/**
 * Carries a saved arrangement onto settings that were renamed or removed.
 *
 * The merge above copies saved values through without checking them against
 * the type, so a value the type no longer names reaches the engine and matches
 * nothing there — silently, since the engine falls through rather than
 * throwing.
 *
 * "descant" became "presence" when the voice stopped lifting an octave and
 * started stepping a voice forward in place. The "notes" mode was removed
 * outright; a save that names it lands on "sustained", the mode it was always
 * the discrete-event alternative to.
 */
const migrateGlobals = (globals: GlobalSettings): GlobalSettings => {
  let migrated = globals;
  if ((migrated.soloistVoice as string) === "descant") {
    migrated = { ...migrated, soloistVoice: "presence" };
  }
  if ((migrated.mode as string) === "notes") {
    migrated = { ...migrated, mode: "sustained" };
  }
  return migrated;
};

export interface RestoredConfig {
  globals: GlobalSettings;
  layers: LayerConfig;
  voicing: VoicingSettings;
}

/**
 * Merges a saved config onto the shipped defaults field by field, so an old
 * save missing a field a later feature added (or carrying a field a later
 * change dropped) still restores cleanly rather than losing the whole save.
 *
 * The defaults are this module's own. Every page that reads the arrangement
 * gets the identical object back from the identical stored value, and no
 * caller can narrow the set of keys that survives the merge.
 */
export const restoreConfig = (saved: unknown): RestoredConfig => {
  const record = typeof saved === "object" && saved !== null ? (saved as Record<string, unknown>) : {};
  return {
    globals: migrateGlobals(withFallback(SCENE_DEFAULTS, record.globals)),
    layers: withFallback(LAYER_DEFAULTS, record.layers),
    voicing: withFallback(VOICING_DEFAULTS, record.voicing),
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
