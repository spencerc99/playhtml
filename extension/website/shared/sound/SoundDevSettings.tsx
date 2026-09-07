// ABOUTME: The experimental sound settings, compact enough to live in the Controls panel
// ABOUTME: Scene essentials and the layer mixer, every change kept as it is made

import React, { useCallback, useEffect, useState } from "react";
import { SoloistVoice, SOLOIST_VOICES, SoundEngine, SoundMode } from "./SoundEngine";
import { PROGRESSION_IDS, PROGRESSIONS, ProgressionId } from "./scales";
import { SoundLayer } from "./types";
import { LayerConfig } from "./persistedConfig";
import { SoundArrangement } from "./useSoundArrangement";

/**
 * One row of the mixer. `enabled` is null for a family with nothing to switch
 * on: the bed is always present and the soloist is the spotlight itself, so
 * the column stays aligned without inventing a toggle that would do nothing.
 */
interface LayerRow {
  layer: SoundLayer;
  name: string;
  enabled: boolean | null;
  onEnabledChange?: (next: boolean) => void;
  selector?: React.ReactNode;
}

const SOLOIST_VOICE_LABELS: Record<SoloistVoice, string> = {
  bells: "bells",
  arpeggio: "arpeggio",
  descant: "descant",
};

const MODES: Array<[SoundMode, string]> = [
  ["sustained", "sustained"],
  ["spotlight", "spotlight"],
  ["notes", "notes"],
];

const hintStyle: React.CSSProperties = {
  fontSize: "11px",
  color: "#666",
  lineHeight: 1.4,
  marginBottom: "8px",
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "40px 1fr auto",
  alignItems: "center",
  gap: "6px",
  padding: "5px 0",
  borderBottom: "1px solid #eee",
};

const chipBase: React.CSSProperties = {
  padding: "3px 6px",
  border: "1px solid #e0e0e0",
  borderRadius: "3px",
  background: "white",
  color: "#666",
  cursor: "pointer",
  fontSize: "11px",
  fontWeight: 500,
  textTransform: "none",
  letterSpacing: 0,
  lineHeight: 1.2,
};

const chipOn: React.CSSProperties = {
  ...chipBase,
  background: "#333",
  borderColor: "#333",
  color: "white",
};

const toggleBase: React.CSSProperties = { ...chipBase, width: "24px", padding: "3px 0" };

const soloActive: React.CSSProperties = {
  ...toggleBase,
  background: "#d4b85c",
  borderColor: "#c4a94a",
  color: "#333",
};

const muteActive: React.CSSProperties = {
  ...toggleBase,
  background: "#c4724e",
  borderColor: "#b06340",
  color: "white",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "3px 4px",
  border: "1px solid #e0e0e0",
  borderRadius: "3px",
  background: "white",
  fontSize: "11px",
  color: "#333",
};

interface SoundDevSettingsProps {
  arrangement: SoundArrangement;
  /**
   * The page's engine, created only once sound is switched on. Asked for
   * rather than owned, so a mixer command lands on the graph the page is
   * already playing through.
   */
  getEngine: () => Promise<SoundEngine>;
  /** Whether the page currently has an engine running, for the standing notice. */
  engine: SoundEngine | null;
}

/**
 * The experimental sound settings, in the place the page's sound settings
 * already live.
 *
 * These replace the shipped sound controls rather than sitting beside them:
 * under the dev flag this arrangement is what the engine runs, so showing both
 * would be showing one set of controls that does nothing. Every change is kept
 * as it is made, in the same stored arrangement the sound playground reads and
 * writes, so a setting found here is already there on the next visit and on
 * the playground.
 */
export const SoundDevSettings = ({
  arrangement,
  getEngine,
  engine,
}: SoundDevSettingsProps) => {
  const [muted, setMuted] = useState<Set<SoundLayer>>(new Set());
  const [soloed, setSoloed] = useState<Set<SoundLayer>>(new Set());
  const [armed, setArmed] = useState(true);
  const [readout, setReadout] = useState({ chord: "Dm", energy: 0 });

  // The chord and energy readout moves on the engine's own clock, so it is
  // polled rather than pushed from whatever happens to be making sound.
  useEffect(() => {
    if (!engine) return;
    const id = window.setInterval(
      () =>
        setReadout({
          chord: engine.getCurrentChordName(),
          energy: engine.getEnergy(),
        }),
      250,
    );
    return () => window.clearInterval(id);
  }, [engine]);

  /**
   * Run one mixer command against the engine and read the result back. The
   * engine owns the mix, so this mirrors it rather than keeping a second copy
   * that could drift.
   */
  const apply = useCallback(
    async (command: (target: SoundEngine) => void) => {
      try {
        const target = await getEngine();
        command(target);
        const mix = target.getLayerMix();
        setMuted(new Set(mix.muted));
        setSoloed(new Set(mix.soloed));
        setArmed(true);
      } catch {
        // The engine only exists once something has been started, so this is a
        // normal "not yet" rather than a failure worth throwing on.
        setArmed(false);
      }
    },
    [getEngine],
  );

  // Leaving the page with a layer soloed would silence the next visit with no
  // visible cause, so drop the mix on unmount.
  useEffect(() => {
    return () => {
      getEngine()
        .then((target) => target.clearLayerMix())
        .catch(() => {
          /* the engine was never started */
        });
    };
  }, [getEngine]);

  const { globals, layers, setGlobals, setLayers } = arrangement;
  const anySoloed = soloed.size > 0;

  const setLayerConfig = (next: Partial<LayerConfig>) => setLayers(next);

  const rows: LayerRow[] = [
    { layer: "bed", name: "bed", enabled: null },
    {
      layer: "flourish",
      name: "soloist",
      enabled: null,
      selector: (
        <select
          value={globals.soloistVoice}
          onChange={(event) =>
            setGlobals({ soloistVoice: event.target.value as SoloistVoice })
          }
          style={selectStyle}
          aria-label="Soloist voice"
        >
          {SOLOIST_VOICES.map((voice) => (
            <option key={voice} value={voice}>
              {SOLOIST_VOICE_LABELS[voice]}
            </option>
          ))}
        </select>
      ),
    },
    {
      layer: "chime",
      name: "chimes",
      enabled: layers.trailArrivals,
      onEnabledChange: (trailArrivals) => setLayerConfig({ trailArrivals }),
    },
    {
      layer: "navigation",
      name: "navigation",
      enabled: layers.navigationSounds,
      onEnabledChange: (navigationSounds) => setLayerConfig({ navigationSounds }),
    },
    {
      layer: "bassPedal",
      name: "bass pedal",
      enabled: layers.bassPedal,
      onEnabledChange: (bassPedal) => setLayerConfig({ bassPedal }),
    },
    {
      layer: "crossing",
      name: "crossings",
      enabled: layers.crossings !== "off",
      // Turning the row on restores the usual flavour rather than picking one
      // at random; turning it off is what "off" already means to the engine.
      onEnabledChange: (on) =>
        setLayerConfig({ crossings: on ? "dissonance" : "off" }),
      selector: (
        <select
          value={layers.crossings}
          onChange={(event) =>
            setLayerConfig({
              crossings: event.target.value as LayerConfig["crossings"],
            })
          }
          style={selectStyle}
          aria-label="Crossing flavor"
        >
          <option value="off">off</option>
          <option value="dissonance">dissonance</option>
          <option value="merge">merge</option>
        </select>
      ),
    },
    {
      layer: "cantus",
      name: "cantus",
      enabled: layers.cantus !== null,
      onEnabledChange: (on) => setLayerConfig({ cantus: on ? "tenor" : null }),
      selector: (
        <select
          value={layers.cantus ?? "off"}
          onChange={(event) =>
            setLayerConfig({
              cantus:
                event.target.value === "off"
                  ? null
                  : (event.target.value as LayerConfig["cantus"]),
            })
          }
          style={selectStyle}
          aria-label="Cantus voice"
        >
          <option value="off">off</option>
          <option value="tenor">tenor</option>
          <option value="soprano">soprano</option>
          <option value="duet">duet</option>
        </select>
      ),
    },
  ];

  return (
    <>
      <div style={hintStyle}>
        Experimental sound settings, shared with the sound playground. Every
        change is kept as you make it.
        {engine ? null : " Turn sound on to hear any of it."}
      </div>

      <div className="control-group">
        <label>Mode</label>
        <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
          {MODES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setGlobals({ mode: value })}
              style={globals.mode === value ? chipOn : chipBase}
              aria-pressed={globals.mode === value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="control-group">
        <label htmlFor="sound-dev-progression">Progression</label>
        <select
          id="sound-dev-progression"
          value={globals.progression}
          onChange={(event) =>
            setGlobals({ progression: event.target.value as ProgressionId })
          }
        >
          {PROGRESSION_IDS.map((id) => (
            <option key={id} value={id}>
              {PROGRESSIONS[id].label}
            </option>
          ))}
        </select>
        <span>
          chord {readout.chord} | energy{" "}
          {globals.energyArc ? readout.energy.toFixed(2) : "off"}
        </span>
      </div>

      <div className="control-group">
        <label htmlFor="sound-dev-traceability">
          Story to traceable {globals.traceability.toFixed(2)}
        </label>
        <input
          id="sound-dev-traceability"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={globals.traceability}
          onChange={(event) =>
            setGlobals({ traceability: Number(event.target.value) })
          }
        />
      </div>

      <div className="control-group">
        <label htmlFor="sound-dev-volume">
          Volume {globals.volume.toFixed(2)}
        </label>
        <input
          id="sound-dev-volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={globals.volume}
          onChange={(event) => setGlobals({ volume: Number(event.target.value) })}
        />
      </div>

      <div className="control-group">
        <label>Sound layers</label>
        <div style={hintStyle}>
          Switch a family on, then solo or mute it to hear what it contributes.
          Any solo silences everything without one; solo wins over mute.
        </div>
        {rows.map((row) => {
          const isSoloed = soloed.has(row.layer);
          const isMuted = muted.has(row.layer);
          // What will actually be heard, which is not the button state once
          // anything is soloed — and a row switched off is silent regardless.
          const audible =
            (anySoloed ? isSoloed : !isMuted) && row.enabled !== false;

          return (
            <div key={`${row.layer}-${row.name}`} style={rowStyle}>
              <div>
                {row.enabled === null ? (
                  <span>always</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => row.onEnabledChange?.(!row.enabled)}
                    style={row.enabled ? chipOn : chipBase}
                    aria-pressed={row.enabled}
                    title={`Turn ${row.name} ${row.enabled ? "off" : "on"}`}
                  >
                    {row.enabled ? "on" : "off"}
                  </button>
                )}
              </div>
              <div>
                <div
                  style={{
                    fontSize: "11px",
                    color: audible ? "#333" : "#b0b0b0",
                    fontWeight: 500,
                  }}
                >
                  {row.name}
                </div>
                {row.selector}
              </div>
              <div style={{ display: "flex", gap: "3px" }}>
                <button
                  type="button"
                  onClick={() =>
                    apply((target) =>
                      target.setLayerSoloed(row.layer, !isSoloed),
                    )
                  }
                  style={isSoloed ? soloActive : toggleBase}
                  aria-pressed={isSoloed}
                  title={`Solo ${row.name}`}
                >
                  S
                </button>
                <button
                  type="button"
                  onClick={() =>
                    apply((target) => target.setLayerMuted(row.layer, !isMuted))
                  }
                  style={isMuted ? muteActive : toggleBase}
                  aria-pressed={isMuted}
                  title={`Mute ${row.name}`}
                >
                  M
                </button>
              </div>
            </div>
          );
        })}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "8px",
          }}
        >
          <button
            type="button"
            onClick={() => apply((target) => target.clearLayerMix())}
            style={chipBase}
          >
            clear mix
          </button>
          <span>
            {anySoloed
              ? `${soloed.size} soloed`
              : muted.size > 0
                ? `${muted.size} muted`
                : "full mix"}
          </span>
        </div>
        {armed ? null : (
          <span style={{ color: "#c4724e" }}>
            start the replay to arm solo and mute
          </span>
        )}
      </div>
    </>
  );
};
