// ABOUTME: Sound playground — scene settings, the sound layers panel, the replay, the library
// ABOUTME: Owns the one SoundEngine every section on the page drives

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { SoundEngine } from "../shared/sound/SoundEngine";
import { CantusVariant } from "../shared/sound/types";
import { DEFAULT_PROGRESSION_ID } from "../shared/sound/scales";
import { SamplePlayback } from "./SamplePlayback";
import { SoundLayers } from "./SoundLayers";
import { SoundLibrary } from "./SoundLibrary";
import { GlobalSettings, Globals } from "./Globals";
import { VoicingSettings, VOICING_DEFAULTS } from "./voicing";

const styles = {
  page: {
    fontFamily: "'Atkinson Hyperlegible', sans-serif",
    background: "#faf7f2",
    color: "#3d3833",
    minHeight: "100vh",
    padding: "40px",
    maxWidth: "900px",
    margin: "0 auto",
  } as React.CSSProperties,
  title: {
    fontFamily: "'Source Serif 4', Georgia, serif",
    fontStyle: "italic" as const,
    fontWeight: 200,
    fontSize: "28px",
    marginBottom: "8px",
  } as React.CSSProperties,
  subtitle: {
    fontSize: "13px",
    color: "#8a8279",
    marginBottom: "32px",
    fontFamily: "'Martian Mono', monospace",
    lineHeight: 1.5,
  } as React.CSSProperties,
};

/**
 * The arrangement the playground opens on — the combination Spencer settled on
 * by ear. Playground-only: the live pages read their own settings defaults and
 * keep every experimental toggle off.
 */
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

/** What the Sound Layers panel switches on, and how loud each family sits. */
interface LayerConfig {
  bassPedal: boolean;
  trailArrivals: boolean;
  navigationSounds: boolean;
  crossings: "off" | "dissonance" | "merge";
  cantus: CantusVariant | null;
}

const LAYER_DEFAULTS: LayerConfig = {
  bassPedal: false,
  trailArrivals: true,
  navigationSounds: true,
  crossings: "off",
  /**
   * The cantus is off until asked for. It is a whole extra voice with nothing
   * in the scene prompting it, so it should be a deliberate addition rather
   * than something already sounding when the page opens.
   */
  cantus: null,
};

const SoundPlayground = () => {
  const engineRef = useRef<SoundEngine | null>(null);
  const [globals, setGlobals] = useState<GlobalSettings>(GLOBAL_DEFAULTS);
  const [layers, setLayers] = useState<LayerConfig>(LAYER_DEFAULTS);
  const [voicing, setVoicing] = useState<VoicingSettings>(VOICING_DEFAULTS);
  const [readout, setReadout] = useState({ chord: "Dm", energy: 0 });

  // Every section drives this one engine, so a setting means the same thing
  // wherever it is changed and whatever is currently making sound.
  const globalsRef = useRef(globals);
  const layersRef = useRef(layers);
  globalsRef.current = globals;
  layersRef.current = layers;

  const ensureEngine = useCallback(async () => {
    if (!engineRef.current) {
      const engine = new SoundEngine();
      await engine.init();
      const current = globalsRef.current;
      engine.setConfig({
        mode: current.mode,
        chordRotation: current.chordRotation,
        progression: current.progression,
        energyArc: current.energyArc,
        trailVoices: current.trailVoices,
        swells: current.swells,
        choralTimbre: current.choralTimbre,
        cursorInstruments: current.cursorInstruments,
        traceability: current.traceability,
        ...layersRef.current,
      });
      engine.setCantus(layersRef.current.cantus);
      engine.setVolume(current.volume);
      engine.setCanvasWidth(window.innerWidth);
      engineRef.current = engine;
    } else {
      await engineRef.current.resume();
    }
    return engineRef.current;
  }, []);

  useEffect(() => {
    engineRef.current?.setConfig({
      mode: globals.mode,
      chordRotation: globals.chordRotation,
      progression: globals.progression,
      energyArc: globals.energyArc,
      trailVoices: globals.trailVoices,
      swells: globals.swells,
      choralTimbre: globals.choralTimbre,
      cursorInstruments: globals.cursorInstruments,
      traceability: globals.traceability,
    });
    engineRef.current?.setVolume(globals.volume);
  }, [globals]);

  useEffect(() => {
    engineRef.current?.setConfig({
      bassPedal: layers.bassPedal,
      trailArrivals: layers.trailArrivals,
      navigationSounds: layers.navigationSounds,
      crossings: layers.crossings,
    });
    engineRef.current?.setCantus(layers.cantus);
  }, [layers]);

  // The chord and energy readout only changes on the engine's own clock, so it
  // is polled rather than pushed from whichever section happens to be ticking.
  useEffect(() => {
    const id = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      setReadout({
        chord: engine.getCurrentChordName(),
        energy: engine.getEnergy(),
      });
    }, 250);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleGlobalsChange = useCallback(
    (next: Partial<GlobalSettings>) =>
      setGlobals((current) => ({ ...current, ...next })),
    [],
  );

  const handleLayersChange = useCallback(
    (next: Partial<LayerConfig>) =>
      setLayers((current) => ({ ...current, ...next })),
    [],
  );

  const handleVoicingChange = useCallback(
    (next: Partial<VoicingSettings>) =>
      setVoicing((current) => ({ ...current, ...next })),
    [],
  );

  const layerConfig = useMemo(
    () => ({
      bassPedal: layers.bassPedal,
      trailArrivals: layers.trailArrivals,
      navigationSounds: layers.navigationSounds,
      crossings: layers.crossings,
      cantus: layers.cantus,
    }),
    [layers],
  );

  return (
    <div style={styles.page}>
      <div style={styles.title}>sound playground</div>
      <div style={styles.subtitle}>
        how browsing becomes sound. set the scene, decide what sounds and how,
        then play the replay and move your own cursor over it.
      </div>

      <Globals
        settings={globals}
        onChange={handleGlobalsChange}
        readout={readout}
      />

      <SoundLayers
        getEngine={ensureEngine}
        config={layerConfig}
        onConfigChange={handleLayersChange}
        voicing={voicing}
        onVoicingChange={handleVoicingChange}
      />

      <SamplePlayback getEngine={ensureEngine} voicing={voicing} />

      <SoundLibrary getEngine={ensureEngine} />
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<SoundPlayground />);
