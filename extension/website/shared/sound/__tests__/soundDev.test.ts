// ABOUTME: The ?sounddev=1 gate, and the arrangement a live page reads and writes behind it
// ABOUTME: Absent the flag a page must behave exactly as it shipped

import { beforeEach, describe, expect, it } from "vitest";
import { isSoundDevEnabled } from "../soundDevFlag";
import {
  engineConfigFor,
  LAYER_DEFAULTS,
  SCENE_DEFAULTS,
} from "../useSoundArrangement";
import {
  buildPersistedConfig,
  loadSavedConfig,
  restoreConfig,
  saveConfig,
} from "../persistedConfig";
import { VOICING_DEFAULTS } from "../voicing";
import { VISUAL_DEFAULTS } from "../soundVisuals";

describe("sounddev gating", () => {
  it("is on only for the exact flag", () => {
    expect(isSoundDevEnabled("?sounddev=1")).toBe(true);
    expect(isSoundDevEnabled("?viz=trails&sounddev=1")).toBe(true);
  });

  it("is off for an absent, empty or any other value", () => {
    expect(isSoundDevEnabled("")).toBe(false);
    expect(isSoundDevEnabled("?viz=trails")).toBe(false);
    expect(isSoundDevEnabled("?sounddev=")).toBe(false);
    expect(isSoundDevEnabled("?sounddev=0")).toBe(false);
    // Truthy-looking values are still not the flag: the gate is exact so a
    // page cannot fall into dev mode by accident.
    expect(isSoundDevEnabled("?sounddev=true")).toBe(false);
    expect(isSoundDevEnabled("?sounddev=yes")).toBe(false);
  });
});

describe("the live page's arrangement", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips through the same storage the playground writes", () => {
    // Saved as the playground would save it, then read back the way a live
    // page reads it. One key, one shape — a setting means the same thing on
    // both pages or the panel is not the playground's panel at all.
    const globals = { ...SCENE_DEFAULTS, soloistVoice: "presence" as const };
    const layers = { ...LAYER_DEFAULTS, bassPedal: true };
    const voicing = { ...VOICING_DEFAULTS, click: "crisp" as const };
    const visuals = { ...VISUAL_DEFAULTS, hueTilt: true };
    saveConfig(buildPersistedConfig(globals, layers, voicing, visuals));

    const saved = loadSavedConfig();
    expect(saved).not.toBeNull();
    const restored = restoreConfig(saved?.config);
    expect(restored.globals).toEqual(globals);
    expect(restored.layers).toEqual(layers);
    expect(restored.voicing).toEqual(voicing);
    expect(restored.visuals).toEqual(visuals);
  });

  it("restores a saved descant as presence", () => {
    // The voice was renamed when it stopped lifting an octave and started
    // stepping a voice forward in place. The merge copies saved values through
    // without checking them against the type, so without the migration an old
    // save would hand the engine a soloist voice matching nothing and silently
    // play no soloist at all.
    saveConfig(
      buildPersistedConfig(
        { ...SCENE_DEFAULTS, soloistVoice: "descant" as never },
        LAYER_DEFAULTS,
        VOICING_DEFAULTS,
        VISUAL_DEFAULTS,
      ),
    );

    const restored = restoreConfig(loadSavedConfig()?.config);
    expect(restored.globals.soloistVoice).toBe("presence");
  });

  it("restores an identical arrangement on the archive and the playground", () => {
    // Both pages restore the same stored value through the same call, with no
    // defaults of their own to supply. The archive used to come up missing
    // bassPedal and cantus, because the defaults arrived as a caller argument
    // and the merge only keeps the keys the defaults name — a caller passing a
    // narrower set silently dropped whatever it left out. `restoreConfig` now
    // owns the defaults, so there is no argument left to get wrong.
    const globals = {
      ...SCENE_DEFAULTS,
      mode: "notes" as const,
      volume: 0.31,
    };
    const layers = {
      ...LAYER_DEFAULTS,
      bassPedal: true,
      cantus: "duet" as const,
    };
    saveConfig(
      buildPersistedConfig(globals, layers, VOICING_DEFAULTS, VISUAL_DEFAULTS),
    );

    const stored = loadSavedConfig()?.config;
    const onArchive = restoreConfig(stored);
    const onPlayground = restoreConfig(stored);

    expect(onArchive).toEqual(onPlayground);
    // And it is the arrangement that was saved, not a default wearing its name.
    expect(onArchive.layers.bassPedal).toBe(true);
    expect(onArchive.layers.cantus).toBe("duet");
    expect(onArchive.globals.volume).toBe(0.31);
    // Every key of the shipped shape survives on both, so neither page can be
    // the one with a field missing.
    expect(Object.keys(onArchive.layers).sort()).toEqual(
      Object.keys(LAYER_DEFAULTS).sort(),
    );
    expect(Object.keys(onArchive.globals).sort()).toEqual(
      Object.keys(SCENE_DEFAULTS).sort(),
    );
  });

  it("becomes the engine config the panel's settings describe", () => {
    const config = engineConfigFor(
      { ...SCENE_DEFAULTS, soloistVoice: "arpeggio", traceability: 0.4 },
      { ...LAYER_DEFAULTS, navigationSounds: false, crossings: "merge" },
    );
    expect(config.soloistVoice).toBe("arpeggio");
    expect(config.traceability).toBe(0.4);
    expect(config.navigationSounds).toBe(false);
    expect(config.crossings).toBe("merge");
  });

  it("hueTilt is off by default but survives being switched on", () => {
    // It is off so the surge and the tilt can be judged one at a time, not
    // because it does not work.
    expect(VISUAL_DEFAULTS.hueTilt).toBe(false);
    saveConfig(
      buildPersistedConfig(SCENE_DEFAULTS, LAYER_DEFAULTS, VOICING_DEFAULTS, {
        ...VISUAL_DEFAULTS,
        hueTilt: true,
      }),
    );
    const restored = restoreConfig(loadSavedConfig()?.config);
    expect(restored.visuals.hueTilt).toBe(true);
  });
});
