// ABOUTME: The playground's one panel for what sounds and how loud it sits
// ABOUTME: Each row carries enable, an optional voice selector, and solo/mute

import React, { useCallback, useEffect, useState } from "react";
import { SoloistVoice, SOLOIST_VOICES, SoundEngine } from "./SoundEngine";
import { SoundLayer } from "./types";
import {
  CLICK_VOICES,
  ClickVoice,
  HOLD_VOICES,
  HoldVoice,
  VoicingSettings,
} from "./voicing";
import { VisualConfig } from "./soundVisuals";

const labelStyle: React.CSSProperties = {
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#8a8279",
};

/**
 * Every row uses the same column track, so Solo and Mute sit in one place down
 * the whole panel however different the rows are in what they offer.
 */
const rowStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "72px minmax(150px, 1fr) minmax(0, 1.35fr) 66px 62px",
  alignItems: "center",
  gap: "10px",
  padding: "7px 0",
  borderBottom: "1px solid #ece6dd",
};

const buttonBase: React.CSSProperties = {
  padding: "4px 8px",
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

const buttonOn: React.CSSProperties = {
  ...buttonBase,
  background: "#3d3833",
  borderColor: "#3d3833",
  color: "#faf7f2",
};

// The border is the longhand triple rather than the shorthand: the active
// variants change only the colour, and mixing shorthand with borderColor across
// a rerender makes React drop the property.
const toggleBase: React.CSSProperties = { ...buttonBase, width: "28px", padding: "4px 0" };

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

const selectStyle: React.CSSProperties = {
  ...buttonBase,
  padding: "4px 6px",
  appearance: "auto",
  maxWidth: "100%",
};

/**
 * One row of the panel. `enabled` is null for a family with nothing to switch
 * on — the bed is always present, and the replay-fed families are switched from
 * their own settings — which keeps the enable column aligned without inventing
 * a toggle that would not do anything.
 */
interface LayerRow {
  layer: SoundLayer;
  name: string;
  hint: string;
  enabled: boolean | null;
  onEnabledChange?: (next: boolean) => void;
  selector?: React.ReactNode;
}

interface SoundLayersProps {
  /** The pad's engine, so the panel gates the same graph everything else uses. */
  getEngine: () => Promise<SoundEngine>;
  /** Engine toggles the panel owns, lifted so one panel decides what sounds. */
  config: {
    bassPedal: boolean;
    trailArrivals: boolean;
    navigationSounds: boolean;
    crossings: "off" | "dissonance" | "merge";
    cantus: "tenor" | "soprano" | "duet" | null;
  };
  onConfigChange: (next: Partial<SoundLayersProps["config"]>) => void;
  /** How each event family is voiced, which the sample replay reads back. */
  voicing: VoicingSettings;
  onVoicingChange: (next: Partial<VoicingSettings>) => void;
  /** Which gesture the replay canvas draws for each sound it hears. */
  visuals: VisualConfig;
  onVisualsChange: (next: Partial<VisualConfig>) => void;
  /**
   * What the soloist speaks in. It lives with the scene rather than with the
   * layers — it is one setting on the spotlight, not a family of its own — but
   * it belongs on the soloist's row, which is here.
   */
  soloistVoice: SoloistVoice;
  onSoloistVoiceChange: (next: SoloistVoice) => void;
}

const SOLOIST_VOICE_LABELS: Record<SoloistVoice, string> = {
  bells: "bells",
  arpeggio: "arpeggio",
  presence: "presence",
};

/**
 * The visible half of a sound. Each gesture is fired by the sound it names,
 * from that sound's own trigger, so switching one on adds a thing to see at
 * the moment there is something to hear and nothing at any other moment.
 */
const VISUAL_ROWS: Array<{
  key: keyof VisualConfig;
  name: string;
  hint: string;
}> = [
  {
    key: "gathering",
    name: "gathering",
    hint: "specks drawing in on an arrival chime, out on a departure",
  },
  {
    key: "knot",
    name: "knot",
    hint: "a bead left on the trail at each navigation gong",
  },
  {
    key: "lightnessSurge",
    name: "lightness surge",
    hint: "the recent path brightening on the gong, then settling",
  },
  {
    key: "hueTilt",
    name: "hue tilt",
    hint: "the trail's hue leaning aside on the gong, then returning",
  },
];

/**
 * The single place that answers "what is sounding, and how loud". Enabling a
 * family, choosing the voice it speaks in, and soloing or muting it all live on
 * the same row, so there is one panel to read rather than a set of toggles in
 * one place and a mixer strip in another.
 *
 * Solo and mute keep desk semantics: any solo silences every layer without one,
 * mute silences a layer, and solo wins over mute. Both are playground
 * diagnostics — live pages never touch the layer mix.
 */
export const SoundLayers = ({
  getEngine,
  config,
  onConfigChange,
  voicing,
  onVoicingChange,
  visuals,
  onVisualsChange,
  soloistVoice,
  onSoloistVoiceChange,
}: SoundLayersProps) => {
  const [muted, setMuted] = useState<Set<SoundLayer>>(new Set());
  const [soloed, setSoloed] = useState<Set<SoundLayer>>(new Set());
  const [armed, setArmed] = useState(true);

  /**
   * Run one mixer command against the engine and read the result back. The
   * engine owns the mix, so the panel mirrors it rather than keeping a second
   * copy that could drift.
   */
  const apply = useCallback(
    async (command: (engine: SoundEngine) => void) => {
      try {
        const engine = await getEngine();
        command(engine);
        const mix = engine.getLayerMix();
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

  // Leaving the playground with a layer soloed would silence the next visit
  // with no visible cause, so drop the mix on unmount.
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

  const rows: LayerRow[] = [
    {
      layer: "bed",
      name: "bed",
      hint: "sustained trail voices",
      enabled: null,
    },
    {
      layer: "flourish",
      name: "soloist",
      hint: "what the spotlit trail speaks in",
      enabled: null,
      selector: (
        <select
          value={soloistVoice}
          onChange={(event) =>
            onSoloistVoiceChange(event.target.value as SoloistVoice)
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
      layer: "clickBell",
      name: "clicks",
      hint: "the voice a click speaks in",
      enabled: null,
      selector: (
        <select
          value={voicing.click}
          onChange={(event) =>
            onVoicingChange({ click: event.target.value as ClickVoice })
          }
          style={selectStyle}
          aria-label="Click voice"
        >
          {CLICK_VOICES.map(({ voice, label }) => (
            <option key={voice} value={voice}>
              {label}
            </option>
          ))}
        </select>
      ),
    },
    {
      layer: "clickBell",
      name: "holds",
      hint: "a click held down",
      enabled: null,
      selector: (
        <select
          value={voicing.hold}
          onChange={(event) =>
            onVoicingChange({ hold: event.target.value as HoldVoice })
          }
          style={selectStyle}
          aria-label="Hold voice"
        >
          {HOLD_VOICES.map(({ voice, label }) => (
            <option key={voice} value={voice}>
              {label}
            </option>
          ))}
        </select>
      ),
    },
    {
      layer: "chime",
      name: "chimes",
      hint: "trail arrivals and departures",
      enabled: config.trailArrivals,
      onEnabledChange: (trailArrivals) => onConfigChange({ trailArrivals }),
    },
    {
      layer: "navigation",
      name: "navigation",
      hint: "the deep gong on a page arrival",
      enabled: config.navigationSounds,
      onEnabledChange: (navigationSounds) => onConfigChange({ navigationSounds }),
    },
    {
      layer: "bassPedal",
      name: "bass pedal",
      hint: "low drone on the chord root",
      enabled: config.bassPedal,
      onEnabledChange: (bassPedal) => onConfigChange({ bassPedal }),
    },
    {
      layer: "crossing",
      name: "crossings",
      hint: "when two trails pass",
      enabled: config.crossings !== "off",
      // Turning the row on restores the usual flavour rather than picking one
      // at random; turning it off is what "off" already means to the engine.
      onEnabledChange: (on) =>
        onConfigChange({ crossings: on ? "dissonance" : "off" }),
      selector: (
        <select
          value={config.crossings}
          onChange={(event) =>
            onConfigChange({
              crossings: event.target.value as SoundLayersProps["config"]["crossings"],
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
      hint: "a slow voice belonging to no trail",
      enabled: config.cantus !== null,
      onEnabledChange: (on) => onConfigChange({ cantus: on ? "tenor" : null }),
      selector: (
        <select
          value={config.cantus ?? "off"}
          onChange={(event) =>
            onConfigChange({
              cantus:
                event.target.value === "off"
                  ? null
                  : (event.target.value as "tenor" | "soprano" | "duet"),
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
        Sound Layers
      </div>
      <div style={{ ...labelStyle, marginBottom: "12px" }}>
        Everything that sounds, and how. Switch a family on, choose the voice it
        speaks in, and solo or mute it to hear what it contributes. Any solo
        silences everything without one; solo wins over mute. Applies to the
        replay and your own cursor together.
      </div>

      <div style={{ ...rowStyle, borderBottom: "1px solid #d8d1c7", padding: "0 0 6px" }}>
        <div style={{ ...labelStyle, fontSize: "10px" }}>on</div>
        <div style={{ ...labelStyle, fontSize: "10px" }}>layer</div>
        <div style={{ ...labelStyle, fontSize: "10px" }}>voice</div>
        <div style={{ ...labelStyle, fontSize: "10px" }}>solo / mute</div>
        <div style={{ ...labelStyle, fontSize: "10px" }}>state</div>
      </div>

      <div>
        {rows.map((row) => {
          const isSoloed = soloed.has(row.layer);
          const isMuted = muted.has(row.layer);
          // What will actually be heard, which is not the button state once
          // anything is soloed — and a row switched off is silent regardless.
          const audible =
            (anySoloed ? isSoloed : !isMuted) && row.enabled !== false;
          const key = `${row.layer}-${row.name}`;

          return (
            <div key={key} style={rowStyle}>
              <div>
                {row.enabled === null ? (
                  <span style={{ ...labelStyle, fontSize: "10px" }}>always</span>
                ) : (
                  <button
                    onClick={() => row.onEnabledChange?.(!row.enabled)}
                    style={row.enabled ? buttonOn : buttonBase}
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
                    fontFamily: "'Martian Mono', monospace",
                    fontSize: "11px",
                    color: audible ? "#3d3833" : "#b8b0a6",
                  }}
                >
                  {row.name}
                </div>
                <div style={{ ...labelStyle, fontSize: "10px" }}>{row.hint}</div>
              </div>
              <div>{row.selector ?? null}</div>
              <div style={{ display: "flex", gap: "4px" }}>
                <button
                  onClick={() => toggleSolo(row.layer)}
                  style={isSoloed ? soloActive : toggleBase}
                  aria-pressed={isSoloed}
                  title={`Solo ${row.name}`}
                >
                  S
                </button>
                <button
                  onClick={() => toggleMute(row.layer)}
                  style={isMuted ? muteActive : toggleBase}
                  aria-pressed={isMuted}
                  title={`Mute ${row.name}`}
                >
                  M
                </button>
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
        <button onClick={clearAll} style={{ ...buttonBase, padding: "6px 12px" }}>
          clear mix
        </button>
        <span style={labelStyle}>
          {anySoloed
            ? `${soloed.size} soloed`
            : muted.size > 0
              ? `${muted.size} muted`
              : "full mix"}
        </span>
        {armed ? null : (
          <span style={{ ...labelStyle, color: "#c4724e" }}>
            start the replay to arm solo and mute
          </span>
        )}
      </div>

      <div
        style={{
          marginTop: "24px",
          paddingTop: "16px",
          borderTop: "1px solid #d8d1c7",
        }}
      >
        <div
          style={{
            fontFamily: "'Martian Mono', monospace",
            fontSize: "11px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "1px",
            marginBottom: "8px",
          }}
        >
          Sound Visuals
        </div>
        <div style={{ ...labelStyle, marginBottom: "12px" }}>
          What each sound looks like on the replay canvas. Every gesture is
          fired by its own sound, so a sound that is switched off or dropped
          draws nothing. The surge and the tilt are two flavours of the same
          moment — the navigation gong — and can be run together or compared.
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {VISUAL_ROWS.map((row) => {
            const on = visuals[row.key];
            return (
              <button
                key={row.key}
                onClick={() => onVisualsChange({ [row.key]: !on })}
                style={{
                  ...(on ? buttonOn : buttonBase),
                  padding: "8px 12px",
                  textAlign: "left",
                  maxWidth: "220px",
                }}
                aria-pressed={on}
                title={row.hint}
              >
                <div style={{ fontSize: "11px" }}>{row.name}</div>
                <div
                  style={{
                    fontSize: "9px",
                    opacity: 0.75,
                    marginTop: "2px",
                    whiteSpace: "normal",
                  }}
                >
                  {row.hint}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
