// ABOUTME: Round-trips the playground's saved arrangement through localStorage
// ABOUTME: Covers per-field fallback for old saves and corrupted-storage recovery

import { beforeEach, describe, expect, it } from "vitest";
import {
  buildPersistedConfig,
  clearSavedConfig,
  LayerConfig,
  loadSavedConfig,
  restoreConfig,
  saveConfig,
} from "../persistedConfig";
import { GlobalSettings } from "../Globals";
import { VoicingSettings, VOICING_DEFAULTS } from "../voicing";
import { VisualConfig, VISUAL_DEFAULTS } from "../soundVisuals";
import { DEFAULT_PROGRESSION_ID } from "../../shared/sound/scales";

const GLOBAL_DEFAULTS: GlobalSettings = {
  mode: "spotlight",
  chordRotation: true,
  progression: DEFAULT_PROGRESSION_ID,
  energyArc: true,
  trailVoices: true,
  swells: true,
  choralTimbre: false,
  cursorInstruments: true,
  traceability: 0,
  volume: 0.5,
};

const LAYER_DEFAULTS: LayerConfig = {
  bassPedal: false,
  trailArrivals: true,
  navigationSounds: true,
  crossings: "off",
  cantus: null,
};

beforeEach(() => {
  window.localStorage.clear();
});

describe("persistedConfig round trip", () => {
  it("serializes the full arrangement and restores it exactly", () => {
    const globals: GlobalSettings = {
      ...GLOBAL_DEFAULTS,
      mode: "notes",
      chordRotation: false,
      traceability: 0.42,
      volume: 0.77,
    };
    const layers: LayerConfig = {
      bassPedal: true,
      trailArrivals: false,
      navigationSounds: false,
      crossings: "merge",
      cantus: "duet",
    };
    const voicing: VoicingSettings = {
      click: "crisp",
      hold: "rootFifth",
    };

    const visuals: VisualConfig = {
      gathering: false,
      knot: false,
      lightnessSurge: false,
      hueTilt: true,
    };

    const config = buildPersistedConfig(globals, layers, voicing, visuals);
    expect(config.v).toBe(1);
    expect(saveConfig(config)).toBe(true);

    const loaded = loadSavedConfig();
    expect(loaded).not.toBeNull();
    expect(loaded?.savedAt).toEqual(expect.any(String));

    const restored = restoreConfig(loaded?.config, GLOBAL_DEFAULTS, LAYER_DEFAULTS);
    expect(restored.globals).toEqual(globals);
    expect(restored.layers).toEqual(layers);
    expect(restored.voicing).toEqual(voicing);
    expect(restored.visuals).toEqual(visuals);
  });

  it("excludes mixer solo/mute state — it was never part of the serialized config", () => {
    const config = buildPersistedConfig(
      GLOBAL_DEFAULTS,
      LAYER_DEFAULTS,
      VOICING_DEFAULTS,
      VISUAL_DEFAULTS,
    );
    const serialized = JSON.stringify(config);
    expect(serialized).not.toMatch(/solo/i);
    expect(serialized).not.toMatch(/mute/i);
  });

  it("clearSavedConfig removes the save so the next load falls back to defaults", () => {
    saveConfig(buildPersistedConfig(
      GLOBAL_DEFAULTS,
      LAYER_DEFAULTS,
      VOICING_DEFAULTS,
      VISUAL_DEFAULTS,
    ));
    expect(loadSavedConfig()).not.toBeNull();

    expect(clearSavedConfig()).toBe(true);
    expect(loadSavedConfig()).toBeNull();
  });
});

describe("per-field fallback", () => {
  it("fills in fields missing from an old save with shipped defaults", () => {
    // Simulates a save written before a later feature added new fields.
    const legacySaved = {
      v: 1,
      globals: { mode: "notes", volume: 0.9 },
      layers: { bassPedal: true },
      voicing: { click: "soft" },
    };

    const restored = restoreConfig(legacySaved, GLOBAL_DEFAULTS, LAYER_DEFAULTS);

    expect(restored.globals.mode).toBe("notes");
    expect(restored.globals.volume).toBe(0.9);
    // Fields the legacy save never had fall back per-field, not the whole save.
    expect(restored.globals.chordRotation).toBe(GLOBAL_DEFAULTS.chordRotation);
    expect(restored.globals.progression).toBe(GLOBAL_DEFAULTS.progression);

    expect(restored.layers.bassPedal).toBe(true);
    expect(restored.layers.trailArrivals).toBe(LAYER_DEFAULTS.trailArrivals);
    expect(restored.layers.cantus).toBe(LAYER_DEFAULTS.cantus);

    expect(restored.voicing.click).toBe("soft");
    // The legacy save never had `hold`, so it falls back per-field too.
    expect(restored.voicing.hold).toBe(VOICING_DEFAULTS.hold);

    // The visual gestures are a later addition, so a save from before them
    // has no `visuals` at all and takes the whole shipped set.
    expect(restored.visuals).toEqual(VISUAL_DEFAULTS);
  });

  it("ignores unknown fields a save carries from a removed feature", () => {
    const savedWithStaleField = {
      v: 1,
      globals: { ...GLOBAL_DEFAULTS, ghostFeature: true },
      layers: { ...LAYER_DEFAULTS },
      voicing: { ...VOICING_DEFAULTS },
    };

    const restored = restoreConfig(savedWithStaleField, GLOBAL_DEFAULTS, LAYER_DEFAULTS);
    expect(restored.globals).toEqual(GLOBAL_DEFAULTS);
    expect("ghostFeature" in restored.globals).toBe(false);
  });

  it("falls back entirely to defaults when no config was ever saved", () => {
    const restored = restoreConfig(undefined, GLOBAL_DEFAULTS, LAYER_DEFAULTS);
    expect(restored.globals).toEqual(GLOBAL_DEFAULTS);
    expect(restored.layers).toEqual(LAYER_DEFAULTS);
    expect(restored.voicing).toEqual(VOICING_DEFAULTS);
    expect(restored.visuals).toEqual(VISUAL_DEFAULTS);
  });
});

describe("corrupted storage", () => {
  it("loadSavedConfig returns null for unparsable JSON rather than throwing", () => {
    window.localStorage.setItem("playhtml-sound-playground-config", "{not json");
    expect(() => loadSavedConfig()).not.toThrow();
    expect(loadSavedConfig()).toBeNull();
  });

  it("loadSavedConfig returns null for valid JSON in the wrong shape", () => {
    window.localStorage.setItem(
      "playhtml-sound-playground-config",
      JSON.stringify(["not", "an", "entry"]),
    );
    expect(loadSavedConfig()).toBeNull();

    window.localStorage.setItem(
      "playhtml-sound-playground-config",
      JSON.stringify({ config: { v: 1 } }), // missing savedAt
    );
    expect(loadSavedConfig()).toBeNull();
  });

  it("restoreConfig falls back cleanly when the saved config itself is malformed", () => {
    const restored = restoreConfig("not an object", GLOBAL_DEFAULTS, LAYER_DEFAULTS);
    expect(restored.globals).toEqual(GLOBAL_DEFAULTS);
    expect(restored.layers).toEqual(LAYER_DEFAULTS);
    expect(restored.voicing).toEqual(VOICING_DEFAULTS);
  });
});
