// ABOUTME: One arrangement — scene, layers, voicing, visuals — held in state and pushed to an engine
// ABOUTME: Shared by the sound playground and the dev panel so both mean the same thing by a setting

import { useCallback, useEffect, useRef, useState } from "react";
import { SoundEngine } from "./SoundEngine";
import { GlobalSettings } from "./SceneSettings";
import { VoicingSettings, VOICING_DEFAULTS } from "./voicing";
import { VisualConfig, VISUAL_DEFAULTS } from "./soundVisuals";
import {
  buildPersistedConfig,
  clearSavedConfig,
  LayerConfig,
  LAYER_DEFAULTS,
  loadSavedConfig,
  restoreConfig,
  saveConfig,
  SCENE_DEFAULTS,
} from "./persistedConfig";

export { LAYER_DEFAULTS, SCENE_DEFAULTS };

/** Everything one arrangement decides, and the handles to change or persist it. */
export interface SoundArrangement {
  globals: GlobalSettings;
  layers: LayerConfig;
  voicing: VoicingSettings;
  visuals: VisualConfig;
  setGlobals: (next: Partial<GlobalSettings>) => void;
  setLayers: (next: Partial<LayerConfig>) => void;
  setVoicing: (next: Partial<VoicingSettings>) => void;
  setVisuals: (next: Partial<VisualConfig>) => void;
  /** ISO timestamp of the saved config in use, or null when none is saved. */
  savedAt: string | null;
  /**
   * Write the arrangement to storage as the default every page opens on. The
   * playground offers this as a button; an auto-persisting caller has it
   * called for it on every change and need not show one.
   */
  save: () => void;
  reset: () => void;
  /** The engine settings this arrangement's scene half amounts to. */
  applyTo: (engine: SoundEngine) => void;
}

/** The engine config an arrangement's scene and layer settings amount to. */
export const engineConfigFor = (
  globals: GlobalSettings,
  layers: LayerConfig,
) => ({
  mode: globals.mode,
  chordRotation: globals.chordRotation,
  progression: globals.progression,
  energyArc: globals.energyArc,
  trailVoices: globals.trailVoices,
  swells: globals.swells,
  choralTimbre: globals.choralTimbre,
  cursorInstruments: globals.cursorInstruments,
  soloistVoice: globals.soloistVoice,
  traceability: globals.traceability,
  bassPedal: layers.bassPedal,
  trailArrivals: layers.trailArrivals,
  navigationSounds: layers.navigationSounds,
  crossings: layers.crossings,
});

/**
 * Reads whatever arrangement is saved and holds it as state, pushing every
 * change onto the engine the caller hands back from `getEngine`.
 *
 * The saved config is read once at mount rather than per render: it only
 * changes through this hook's own save and reset, both of which set the state
 * they wrote.
 */
export interface ArrangementOptions {
  /**
   * Whether this arrangement is in charge. False on a page that did not ask
   * for the sound dev settings: nothing is read from storage and nothing is
   * pushed to the engine, so the page's own settings remain the only thing
   * shaping it.
   */
  active?: boolean;
  /**
   * Write every change straight to storage. The playground keeps its explicit
   * save and reset buttons, because a playground is where an arrangement is
   * tried out and thrown away; the archive's settings are the arrangement, so
   * turning one on is the act of keeping it.
   */
  autoPersist?: boolean;
}

export const useSoundArrangement = (
  engineRef: React.MutableRefObject<SoundEngine | null>,
  { active = true, autoPersist = false }: ArrangementOptions = {},
): SoundArrangement => {
  const [initial] = useState(() => {
    const saved = active ? loadSavedConfig() : null;
    return {
      restored: restoreConfig(saved?.config),
      savedAt: saved?.savedAt ?? null,
    };
  });

  const [globals, setGlobalsState] = useState<GlobalSettings>(
    initial.restored.globals,
  );
  const [layers, setLayersState] = useState<LayerConfig>(initial.restored.layers);
  const [voicing, setVoicingState] = useState<VoicingSettings>(
    initial.restored.voicing,
  );
  const [visuals, setVisualsState] = useState<VisualConfig>(
    initial.restored.visuals,
  );
  const [savedAt, setSavedAt] = useState<string | null>(initial.savedAt);

  const globalsRef = useRef(globals);
  const layersRef = useRef(layers);
  const voicingRef = useRef(voicing);
  const visualsRef = useRef(visuals);
  globalsRef.current = globals;
  layersRef.current = layers;
  voicingRef.current = voicing;
  visualsRef.current = visuals;

  useEffect(() => {
    const engine = engineRef.current;
    if (!active || !engine) return;
    engine.setConfig(engineConfigFor(globals, layers));
    engine.setCantus(layers.cantus);
    engine.setVolume(globals.volume);
  }, [active, engineRef, globals, layers]);

  const applyTo = useCallback(
    (engine: SoundEngine) => {
      if (!active) return;
      engine.setConfig(engineConfigFor(globalsRef.current, layersRef.current));
      engine.setCantus(layersRef.current.cantus);
      engine.setVolume(globalsRef.current.volume);
    },
    [active],
  );

  const setGlobals = useCallback(
    (next: Partial<GlobalSettings>) =>
      setGlobalsState((current) => ({ ...current, ...next })),
    [],
  );
  const setLayers = useCallback(
    (next: Partial<LayerConfig>) =>
      setLayersState((current) => ({ ...current, ...next })),
    [],
  );
  const setVoicing = useCallback(
    (next: Partial<VoicingSettings>) =>
      setVoicingState((current) => ({ ...current, ...next })),
    [],
  );
  const setVisuals = useCallback(
    (next: Partial<VisualConfig>) =>
      setVisualsState((current) => ({ ...current, ...next })),
    [],
  );

  const save = useCallback(() => {
    const config = buildPersistedConfig(
      globalsRef.current,
      layersRef.current,
      voicingRef.current,
      visualsRef.current,
    );
    if (saveConfig(config)) setSavedAt(new Date().toISOString());
  }, []);

  // An auto-persisting caller keeps every change without being asked. The
  // first run is skipped: opening a page is not a change, and writing on mount
  // would turn a visit into a save of whatever happened to be restored.
  const persistedOnceRef = useRef(false);
  useEffect(() => {
    if (!active || !autoPersist) return;
    if (!persistedOnceRef.current) {
      persistedOnceRef.current = true;
      return;
    }
    save();
  }, [active, autoPersist, globals, layers, voicing, visuals, save]);

  const reset = useCallback(() => {
    clearSavedConfig();
    setSavedAt(null);
    setGlobalsState(SCENE_DEFAULTS);
    setLayersState(LAYER_DEFAULTS);
    setVoicingState(VOICING_DEFAULTS);
    setVisualsState(VISUAL_DEFAULTS);
  }, []);

  return {
    globals,
    layers,
    voicing,
    visuals,
    setGlobals,
    setLayers,
    setVoicing,
    setVisuals,
    savedAt,
    save,
    reset,
    applyTo,
  };
};
