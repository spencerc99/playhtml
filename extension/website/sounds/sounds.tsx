// ABOUTME: Sound playground — scene settings, the sound layers panel, the replay, the library
// ABOUTME: Owns the one SoundEngine every section on the page drives

import React, { useCallback, useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { SoundEngine } from "../shared/sound/SoundEngine";
import { SamplePlayback } from "./SamplePlayback";
import { SoundLayers } from "../shared/sound/SoundLayers";
import { SoundLibrary } from "./SoundLibrary";
import { SceneSettings } from "../shared/sound/SceneSettings";
import { useSoundArrangement } from "../shared/sound/useSoundArrangement";

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

const SoundPlayground = () => {
  const engineRef = useRef<SoundEngine | null>(null);
  const arrangement = useSoundArrangement(engineRef);
  const [readout, setReadout] = useState({ chord: "Dm", energy: 0 });

  const applyArrangement = arrangement.applyTo;
  const ensureEngine = useCallback(async () => {
    if (!engineRef.current) {
      const engine = new SoundEngine();
      await engine.init();
      applyArrangement(engine);
      engine.setCanvasWidth(window.innerWidth);
      engineRef.current = engine;
    } else {
      await engineRef.current.resume();
    }
    return engineRef.current;
  }, [applyArrangement]);

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

  return (
    <div style={styles.page}>
      <div style={styles.title}>sound playground</div>
      <div style={styles.subtitle}>
        how browsing becomes sound. set the scene, decide what sounds and how,
        then play the replay and move your own cursor over it.
      </div>

      <SceneSettings
        settings={arrangement.globals}
        onChange={arrangement.setGlobals}
        readout={readout}
        savedAt={arrangement.savedAt}
        onSaveDefault={arrangement.save}
        onResetDefault={arrangement.reset}
      />

      <SoundLayers
        getEngine={ensureEngine}
        config={arrangement.layers}
        onConfigChange={arrangement.setLayers}
        voicing={arrangement.voicing}
        onVoicingChange={arrangement.setVoicing}
        visuals={arrangement.visuals}
        onVisualsChange={arrangement.setVisuals}
        soloistVoice={arrangement.globals.soloistVoice}
        onSoloistVoiceChange={(soloistVoice) =>
          arrangement.setGlobals({ soloistVoice })
        }
      />

      <SamplePlayback
        getEngine={ensureEngine}
        voicing={arrangement.voicing}
        visuals={arrangement.visuals}
      />

      <SoundLibrary getEngine={ensureEngine} />
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<SoundPlayground />);
