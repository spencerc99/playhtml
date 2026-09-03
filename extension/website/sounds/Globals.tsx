// ABOUTME: Scene-wide settings above the Sound Layers panel
// ABOUTME: Mode, harmony, the story-to-traceable dial and volume — what the whole mix sits in

import React from "react";
import { SoundMode } from "../shared/sound/SoundEngine";
import {
  PROGRESSION_IDS,
  PROGRESSIONS,
  ProgressionId,
} from "../shared/sound/scales";

const labelStyle: React.CSSProperties = {
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#8a8279",
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #e0dbd4",
  background: "#f5f0e8",
  cursor: "pointer",
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#3d3833",
};

const buttonActiveStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#3d3833",
  color: "#faf7f2",
  border: "1px solid #3d3833",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  gap: "8px",
  flexWrap: "wrap",
  alignItems: "center",
  marginBottom: "12px",
};

export interface GlobalSettings {
  mode: SoundMode;
  chordRotation: boolean;
  progression: ProgressionId;
  energyArc: boolean;
  trailVoices: boolean;
  swells: boolean;
  choralTimbre: boolean;
  cursorInstruments: boolean;
  traceability: number;
  volume: number;
}

interface GlobalsProps {
  settings: GlobalSettings;
  onChange: (next: Partial<GlobalSettings>) => void;
  /** Chord and energy readout, so the harmony row shows where it currently is. */
  readout: { chord: string; energy: number };
}

/**
 * The settings the whole scene sits in, as opposed to what any one family
 * sounds like. These shape every layer at once, so they sit above the panel
 * rather than as a row inside it.
 */
export const Globals = ({ settings, onChange, readout }: GlobalsProps) => (
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
      Scene
    </div>

    <div style={rowStyle}>
      <span style={labelStyle}>mode</span>
      {(
        [
          ["sustained", "sustained"],
          ["spotlight", "sustained + spotlight"],
          ["notes", "notes"],
        ] as Array<[SoundMode, string]>
      ).map(([value, label]) => (
        <button
          key={value}
          onClick={() => onChange({ mode: value })}
          style={settings.mode === value ? buttonActiveStyle : buttonStyle}
        >
          {label}
        </button>
      ))}
      <span style={labelStyle}>
        the fastest clear outlier becomes the soloist: spotlight lifts and
        brightens it while the rest duck; notes drops the crowd to a sparser
        register.
      </span>
    </div>

    <div style={rowStyle}>
      <span style={labelStyle}>voices</span>
      {(
        [
          ["trailVoices", "trail voices"],
          ["swells", "swells"],
          ["choralTimbre", "choral timbre"],
          ["cursorInstruments", "cursor instruments"],
        ] as Array<[keyof GlobalSettings, string]>
      ).map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange({ [key]: !settings[key] } as Partial<GlobalSettings>)}
          style={settings[key] ? buttonActiveStyle : buttonStyle}
        >
          {label}
        </button>
      ))}
    </div>
    <div style={{ ...labelStyle, marginTop: "-6px", marginBottom: "12px", lineHeight: 1.4 }}>
      trail voices gives each trail a home chord tone and sets its register from
      its colour (cool low, warm high). cursor instruments gives each cursor
      type its own timbre — with both on, the timbre comes from the cursor and
      the detune and vibrato from the trail.
    </div>

    <div style={rowStyle}>
      <span style={labelStyle}>harmony</span>
      <button
        onClick={() => onChange({ chordRotation: !settings.chordRotation })}
        style={settings.chordRotation ? buttonActiveStyle : buttonStyle}
      >
        chord rotation
      </button>
      <button
        onClick={() => onChange({ energyArc: !settings.energyArc })}
        style={settings.energyArc ? buttonActiveStyle : buttonStyle}
      >
        energy arc
      </button>
      <select
        value={settings.progression}
        onChange={(event) =>
          onChange({ progression: event.target.value as ProgressionId })
        }
        style={{ ...buttonStyle, appearance: "auto" }}
      >
        {PROGRESSION_IDS.map((id) => (
          <option key={id} value={id}>
            {PROGRESSIONS[id].label} — {PROGRESSIONS[id].description}
          </option>
        ))}
      </select>
      <span style={labelStyle}>
        chord: {readout.chord}
        {settings.chordRotation ? "" : " (fixed)"} | energy:{" "}
        {settings.energyArc ? readout.energy.toFixed(3) : "off"}
      </span>
    </div>

    <div style={{ marginBottom: "12px" }}>
      <label style={labelStyle}>
        <span style={{ marginRight: "12px" }}>story</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings.traceability}
          onChange={(event) =>
            onChange({ traceability: Number(event.target.value) })
          }
          style={{ verticalAlign: "middle", width: "200px" }}
        />
        <span style={{ marginLeft: "12px" }}>traceable</span>
        <span style={{ marginLeft: "12px" }}>
          {settings.traceability.toFixed(2)}
        </span>
      </label>
      <div style={{ ...labelStyle, marginTop: "6px", lineHeight: 1.4 }}>
        how far the mix leans toward following one cursor rather than telling
        one story. at story the crowd settles onto the chord and swells take
        their time; turning it up lets each trail's own motion through and
        shortens the swell, so a single cursor is easier to pick out.
      </div>
    </div>

    <div>
      <label style={labelStyle}>
        volume {settings.volume.toFixed(2)}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={settings.volume}
          onChange={(event) => onChange({ volume: Number(event.target.value) })}
          style={{
            marginLeft: "12px",
            verticalAlign: "middle",
            width: "200px",
          }}
        />
      </label>
    </div>
  </div>
);
