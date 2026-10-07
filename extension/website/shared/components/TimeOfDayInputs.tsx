// ABOUTME: Center-time and ± minutes inputs for a recurring time-of-day window in local time.
// ABOUTME: Shared by the portrait's activity strip and the scraps page's "when" filter.

import React from "react";
import type { TimeOfDayFilter } from "../config";
import { hhmmToMinutes, minutesToHHMM } from "../utils/timeOfDay";

const TEXT = "#3d3833";
const TEXT_MUTED = "rgba(61,56,51,0.55)";

const inputStyle: React.CSSProperties = {
  font: "inherit",
  fontSize: 10,
  padding: "1px 3px",
  border: "1px solid rgba(61,56,51,0.25)",
  borderRadius: 3,
  background: "rgba(255,255,255,0.6)",
  color: TEXT,
};

interface TimeOfDayInputsProps {
  value: TimeOfDayFilter;
  onChange: (value: TimeOfDayFilter) => void;
}

export function TimeOfDayInputs({ value, onChange }: TimeOfDayInputsProps) {
  return (
    <>
      <input
        type="time"
        aria-label="Time of day"
        value={minutesToHHMM(value.centerMinutes)}
        onChange={(e) => {
          const mins = hhmmToMinutes(e.target.value);
          if (mins !== null) onChange({ ...value, centerMinutes: mins });
        }}
        style={inputStyle}
      />
      <span style={{ color: TEXT_MUTED }}>±</span>
      <input
        type="number"
        aria-label="Minutes either side"
        min={1}
        max={720}
        value={value.radiusMinutes}
        onChange={(e) => {
          const r = Number(e.target.value);
          if (Number.isFinite(r) && r > 0)
            onChange({ ...value, radiusMinutes: Math.min(720, r) });
        }}
        style={{ ...inputStyle, width: 38 }}
      />
      <span style={{ color: TEXT_MUTED }}>min</span>
    </>
  );
}
