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
import { GlobalSettings } from "../SceneSettings";
import { VoicingSettings, VOICING_DEFAULTS } from "../voicing";
import { VisualConfig, VISUAL_DEFAULTS } from "../soundVisuals";
import {
  LAYER_DEFAULTS,
  SCENE_DEFAULTS as GLOBAL_DEFAULTS,
} from "../useSoundArrangement";

beforeEach(() => {
  window.localStorage.clear();
});

describe("the shipped arrangement", () => {
  /**
   * Written out literally rather than compared against the constants, so this
   * asserts the arrangement itself rather than restating whatever the file
   * currently holds. Every value here is one Spencer settled on by ear; a
   * change to any of them should be a deliberate edit to this list, not a
   * side effect of touching the defaults.
   */
  it("is the combination settled on by ear", () => {
    expect(GLOBAL_DEFAULTS).toEqual({
      mode: "spotlight",
      chordRotation: true,
      progression: "circular",
      energyArc: true,
      trailVoices: true,
      swells: true,
      choralTimbre: true,
      cursorInstruments: true,
      soloistVoice: "presence",
      traceability: 0.51,
      volume: 0.49,
    });

    expect(LAYER_DEFAULTS).toEqual({
      bassPedal: true,
      trailArrivals: true,
      navigationSounds: true,
      crossings: "off",
      cantus: "soprano",
    });

    expect(VOICING_DEFAULTS).toEqual({
      click: "bells",
      hold: "rootFifth",
    });
  });
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

    const restored = restoreConfig(loaded?.config);
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
    // Named keys rather than a substring search: `soloistVoice` is part of the
    // arrangement and contains "solo" without being mixer state.
    const keys = new Set<string>();
    const walk = (value: unknown) => {
      if (typeof value !== "object" || value === null) return;
      for (const [key, nested] of Object.entries(value)) {
        keys.add(key);
        walk(nested);
      }
    };
    walk(config);
    expect(keys.has("muted")).toBe(false);
    expect(keys.has("soloed")).toBe(false);
    expect(keys.has("layerMix")).toBe(false);
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

    const restored = restoreConfig(legacySaved);

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

    const restored = restoreConfig(savedWithStaleField);
    expect(restored.globals).toEqual(GLOBAL_DEFAULTS);
    expect("ghostFeature" in restored.globals).toBe(false);
  });

  it("falls back entirely to defaults when no config was ever saved", () => {
    const restored = restoreConfig(undefined);
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
    const restored = restoreConfig("not an object");
    expect(restored.globals).toEqual(GLOBAL_DEFAULTS);
    expect(restored.layers).toEqual(LAYER_DEFAULTS);
    expect(restored.voicing).toEqual(VOICING_DEFAULTS);
  });
});
