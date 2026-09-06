// ABOUTME: The playground's scene and layer panels, mounted on a live page as a collapsible drawer
// ABOUTME: Drives the page's own engine and reads and writes the same saved arrangement

import React, { useEffect, useState } from "react";
import { SoundEngine } from "./SoundEngine";
import { SceneSettings } from "./SceneSettings";
import { SoundLayers } from "./SoundLayers";
import { SoundArrangement } from "./useSoundArrangement";

export { isSoundDevEnabled, SOUND_DEV_PARAM } from "./soundDevFlag";

const drawerStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 20,
  right: 20,
  zIndex: 101,
  background: "rgba(255, 255, 255, 0.92)",
  backdropFilter: "blur(8px)",
  borderRadius: "8px",
  boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
  pointerEvents: "auto",
  // The panel carries the playground's own rows, whose column track needs the
  // room the playground gives them. Narrower and the voice selectors collapse
  // to a stub with no label showing.
  width: 700,
  maxWidth: "calc(100vw - 40px)",
  boxSizing: "border-box",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  padding: "12px 16px",
  cursor: "pointer",
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "1px",
  color: "#3d3833",
  border: "none",
  background: "none",
  width: "100%",
  textAlign: "left",
};

const bodyStyle: React.CSSProperties = {
  padding: "0 16px 16px",
  maxHeight: "calc(100vh - 120px)",
  overflowY: "auto",
  fontFamily: "'Atkinson Hyperlegible', sans-serif",
  color: "#3d3833",
};

interface SoundDevPanelProps {
  arrangement: SoundArrangement;
  /**
   * The page's engine, created only once sound is switched on. The panel asks
   * for it rather than owning it, so every setting lands on the graph the page
   * is already playing through.
   */
  getEngine: () => Promise<SoundEngine>;
  /** Whether the page currently has an engine running, for the standing notice. */
  engine: SoundEngine | null;
}

/**
 * The sound playground's settings, on the page whose sound they are shaping.
 *
 * While this is mounted it supersedes the page's own sound settings: the
 * arrangement it holds is pushed onto the engine on every change and on
 * creation, so the Controls panel's sound rows are no longer what the engine
 * is running. Dropping the `?sounddev=1` parameter hands the engine back to
 * the page's settings on the next load.
 */
export const SoundDevPanel = ({
  arrangement,
  getEngine,
  engine,
}: SoundDevPanelProps) => {
  const [open, setOpen] = useState(false);
  const [readout, setReadout] = useState({ chord: "Dm", energy: 0 });

  // The chord and energy readout moves on the engine's own clock, so it is
  // polled rather than pushed from whatever happens to be making sound.
  useEffect(() => {
    if (!engine || !open) return;
    const id = window.setInterval(
      () =>
        setReadout({
          chord: engine.getCurrentChordName(),
          energy: engine.getEnergy(),
        }),
      250,
    );
    return () => window.clearInterval(id);
  }, [engine, open]);

  return (
    <div style={drawerStyle}>
      <button
        style={headerStyle}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span>sound dev</span>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      </button>
      {open ? (
        <div style={bodyStyle}>
          <div
            style={{
              fontFamily: "'Martian Mono', monospace",
              fontSize: "10px",
              lineHeight: 1.5,
              color: "#8a8279",
              marginBottom: "16px",
            }}
          >
            these settings supersede the page's own sound settings while this
            panel is here, and are the same saved arrangement the sound
            playground reads and writes.
            {engine ? null : " turn sound on to hear any of it."}
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
            getEngine={getEngine}
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
        </div>
      ) : null}
    </div>
  );
};
