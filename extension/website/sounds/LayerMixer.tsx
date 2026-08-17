// ABOUTME: Solo/mute strip for each sound family in the playground
// ABOUTME: Diagnostic only — gates engine layer buses so one family can be heard alone

import React, { useCallback, useEffect, useState } from "react";
import { SoundEngine } from "../shared/sound/SoundEngine";
import { SOUND_LAYERS, SoundLayer } from "../shared/sound/types";

/** What each family is, in the terms the rest of the playground uses. */
const LAYER_LABELS: Record<SoundLayer, { name: string; hint: string }> = {
  bed: { name: "bed", hint: "sustained trail voices, swells, choral timbre" },
  flourish: { name: "soloist", hint: "spotlight flourish and its resolve" },
  clickBell: { name: "click bells", hint: "clicks and holds" },
  chime: { name: "chimes", hint: "trail arrivals and departures" },
  navigation: { name: "navigation", hint: "the deep gong on a page arrival" },
  bassPedal: { name: "bass pedal", hint: "low drone on the chord root" },
  crossing: { name: "crossings", hint: "dissonance and merged dyads" },
  typing: { name: "typing", hint: "keystroke ticks, from the sample replay" },
  brush: { name: "brush", hint: "scroll swishes, from the sample replay" },
  cantus: {
    name: "cantus",
    hint: "the slow autonomous voice, belonging to no trail",
  },
};

const labelStyle: React.CSSProperties = {
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#8a8279",
};

const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: "10px",
  padding: "6px 0",
  borderBottom: "1px solid #ece6dd",
};

// Border is written as the longhand triple rather than the `border` shorthand:
// the active variants only change the colour, and mixing shorthand with
// `borderColor` across a rerender makes React drop the property.
const toggleBase: React.CSSProperties = {
  width: "28px",
  padding: "4px 0",
  borderWidth: "1px",
  borderStyle: "solid",
  borderColor: "#e0dbd4",
  background: "#f5f0e8",
  cursor: "pointer",
  fontFamily: "'Martian Mono', monospace",
  fontSize: "10px",
  color: "#8a8279",
  lineHeight: 1.2,
};

const soloActive: React.CSSProperties = {
  ...toggleBase,
  background: "#d4b85c",
  borderColor: "#c4a94a",
  color: "#3d3833",
};

const muteActive: React.CSSProperties = {
  ...toggleBase,
  background: "#c4724e",
  borderColor: "#b06340",
  color: "#faf7f2",
};

const clearButton: React.CSSProperties = {
  ...toggleBase,
  width: "auto",
  padding: "6px 12px",
};

interface LayerMixerProps {
  /** The pad's engine, so the strip gates the same graph everything else uses. */
  getEngine: () => Promise<SoundEngine>;
}

/**
 * A mixer strip for the sound families, so what each one contributes can be
 * heard on its own. Standard desk semantics: any solo silences every layer
 * without one, mute silences a layer, and solo wins over mute.
 *
 * This is a playground diagnostic. Live pages never touch the layer mix, so
 * every family stays audible there.
 */
export const LayerMixer = ({ getEngine }: LayerMixerProps) => {
  const [muted, setMuted] = useState<Set<SoundLayer>>(new Set());
  const [soloed, setSoloed] = useState<Set<SoundLayer>>(new Set());
  const [error, setError] = useState<string | null>(null);

  /**
   * Run one mixer command against the engine and mirror the result locally.
   * The engine owns the state, so the strip reads it back rather than keeping
   * a second copy that could drift.
   */
  const apply = useCallback(
    async (command: (engine: SoundEngine) => void) => {
      try {
        const engine = await getEngine();
        command(engine);
        const mix = engine.getLayerMix();
        setMuted(new Set(mix.muted));
        setSoloed(new Set(mix.soloed));
        setError(null);
      } catch (err) {
        // The pad's engine only exists once the pad has been started, so this
        // is a normal "not yet" rather than a failure worth throwing on.
        setError(
          err instanceof Error ? err.message : "The sound engine is not ready",
        );
      }
    },
    [getEngine],
  );

  const toggleSolo = useCallback(
    (layer: SoundLayer) =>
      apply((engine) => engine.setLayerSoloed(layer, !soloed.has(layer))),
    [apply, soloed],
  );

  const toggleMute = useCallback(
    (layer: SoundLayer) =>
      apply((engine) => engine.setLayerMuted(layer, !muted.has(layer))),
    [apply, muted],
  );

  const clearAll = useCallback(
    () => apply((engine) => engine.clearLayerMix()),
    [apply],
  );

  // Leaving the playground with a layer soloed would silence the pad for the
  // next visit with no visible cause, so drop the mix on unmount.
  useEffect(() => {
    return () => {
      getEngine()
        .then((engine) => engine.clearLayerMix())
        .catch(() => {
          /* the engine was never started */
        });
    };
  }, [getEngine]);

  const anySoloed = soloed.size > 0;

  return (
    <div style={{ marginBottom: "32px" }}>
      <div
        style={{
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "1px",
          marginBottom: "12px",
          fontFamily: "'Martian Mono', monospace",
          fontSize: "11px",
        }}
      >
        Layer Mixer
      </div>
      <div style={{ ...labelStyle, marginBottom: "12px" }}>
        Solo or mute one family to hear what it contributes. Any solo silences
        everything without one; solo wins over mute. Applies to the pad and the
        sample replay together.
      </div>

      <div>
        {SOUND_LAYERS.map((layer) => {
          const isSoloed = soloed.has(layer);
          const isMuted = muted.has(layer);
          // What the listener will actually hear, which is not the same as the
          // button state once anything is soloed.
          const audible = anySoloed ? isSoloed : !isMuted;
          const { name, hint } = LAYER_LABELS[layer];

          return (
            <div key={layer} style={rowStyle}>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  onClick={() => toggleSolo(layer)}
                  style={isSoloed ? soloActive : toggleBase}
                  aria-pressed={isSoloed}
                  title={`Solo ${name}`}
                >
                  S
                </button>
                <button
                  onClick={() => toggleMute(layer)}
                  style={isMuted ? muteActive : toggleBase}
                  aria-pressed={isMuted}
                  title={`Mute ${name}`}
                >
                  M
                </button>
              </div>
              <div>
                <div
                  style={{
                    fontFamily: "'Martian Mono', monospace",
                    fontSize: "11px",
                    color: audible ? "#3d3833" : "#b8b0a6",
                  }}
                >
                  {name}
                </div>
                <div style={{ ...labelStyle, fontSize: "10px" }}>{hint}</div>
              </div>
              <div
                style={{
                  ...labelStyle,
                  fontSize: "10px",
                  color: audible ? "#4a9a8a" : "#b8b0a6",
                }}
              >
                {audible ? "audible" : "silent"}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginTop: "12px",
        }}
      >
        <button onClick={clearAll} style={clearButton}>
          clear mix
        </button>
        <span style={labelStyle}>
          {anySoloed
            ? `${soloed.size} soloed`
            : muted.size > 0
              ? `${muted.size} muted`
              : "full mix"}
        </span>
        {error ? (
          <span style={{ ...labelStyle, color: "#c4724e" }}>
            start the pad or the sample to arm the mixer
          </span>
        ) : null}
      </div>
    </div>
  );
};
