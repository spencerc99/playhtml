// ABOUTME: The shared "when" picker: recent-day presets, the textured day grid with month headers, and a time-of-day strip.
// ABOUTME: Used inside the movement page's day selector and the scraps page's "when" filter.

import React from "react";
import type { TimeOfDayFilter } from "../config";
import {
  dayRangeLength,
  formatDayRange,
  recentDays,
  sameDayRange,
  type DayRange,
} from "../utils/dayRange";
import {
  formatTimeOfDay,
  localDayKey,
  QUARTER_DAYS,
  quarterDayOf,
} from "../utils/timeOfDay";
import { DAY_GRID_WIDTH, DayGrid } from "./DayGrid";
import { TimeOfDayInputs } from "./TimeOfDayInputs";

const ACCENT_TEAL = "#4a9a8a";
const ACCENT_TEAL_TEXT = "#2f6f62";
const TEXT = "#3d3833";
const TEXT_MUTED = "rgba(61,56,51,0.68)";
const MONO = "'Martian Mono', monospace";

/** Each quarter of the day's color in the strip, night through evening. */
const QUARTER_COLORS: Record<string, { rgb: string; ink: string }> = {
  night: { rgb: "64,82,140", ink: "#faf7f2" },
  morning: { rgb: "212,184,92", ink: TEXT },
  afternoon: { rgb: "226,150,78", ink: TEXT },
  evening: { rgb: "170,86,70", ink: "#faf7f2" },
};

const QUARTER_GLYPHS: Record<string, string> = {
  night: "☾",
  morning: "◒",
  afternoon: "○",
  evening: "◓",
};

const PRESET_DAYS = [7, 30];

interface WhenPanelProps {
  /** Every day with data, keyed "YYYY-MM-DD" in local time, with its count. */
  dayCounts: Map<string, number>;
  days: DayRange | null;
  onDays: (days: DayRange | null) => void;
  timeOfDay: TimeOfDayFilter | null;
  onTimeOfDay: (timeOfDay: TimeOfDayFilter | null) => void;
  /** Overrides for the day grid's scrolling area, such as a height cap. */
  gridStyle?: React.CSSProperties;
}

/** The readout's words for a time-of-day window: "mornings" or "13:00–15:00". */
export function describeTimeOfDay(window: TimeOfDayFilter): string {
  return quarterDayOf(window)?.plural ?? formatTimeOfDay(window);
}

/** The short summary a closed picker shows: "Oct 3 – 11, 2026 · mornings". */
export function describeWhen(
  days: DayRange | null,
  timeOfDay: TimeOfDayFilter | null,
  allDaysLabel: string,
): string {
  const dayText = days ? formatDayRange(days, true) : allDaysLabel;
  return timeOfDay ? `${dayText} · ${describeTimeOfDay(timeOfDay)}` : dayText;
}

export const WhenPanel: React.FC<WhenPanelProps> = ({
  dayCounts,
  days,
  onDays,
  timeOfDay,
  onTimeOfDay,
  gridStyle,
}) => {
  const today = localDayKey(Date.now());
  const presets = [
    ...PRESET_DAYS.map((count) => ({
      label: `${count} days`,
      range: recentDays(today, count) as DayRange | null,
    })),
    { label: "all", range: null },
  ];

  let tracedDays = 0;
  for (const [day, count] of dayCounts) {
    if (count > 0 && (days === null || (day >= days.start && day <= days.end)))
      tracedDays++;
  }
  const meta = [
    days
      ? `${dayRangeLength(days)} ${dayRangeLength(days) === 1 ? "day" : "days"} · ${tracedDays} traced`
      : `${tracedDays} days traced`,
    timeOfDay ? `${describeTimeOfDay(timeOfDay)} only` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const quarter = timeOfDay ? quarterDayOf(timeOfDay) : undefined;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 6,
          padding: "8px 10px 2px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span
            style={{
              fontFamily: "'Lora', Georgia, serif",
              fontSize: 15,
              fontWeight: 600,
              lineHeight: 1.15,
              color: days ? ACCENT_TEAL_TEXT : TEXT,
            }}
          >
            {days ? formatDayRange(days) : "all days"}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 9, color: TEXT_MUTED }}>
            {meta}
          </span>
        </div>
        {(days !== null || timeOfDay !== null) && (
          <button
            type="button"
            onClick={() => {
              onDays(null);
              onTimeOfDay(null);
            }}
            style={linkStyle}
          >
            clear
          </button>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))`,
          gap: 4,
          padding: "6px 10px 2px",
        }}
      >
        {presets.map((preset) => {
          const on = sameDayRange(days, preset.range);
          return (
            <button
              key={preset.label}
              type="button"
              aria-pressed={on}
              onClick={() => onDays(preset.range)}
              style={{
                padding: "5px 0",
                background: on
                  ? "rgba(74,154,138,0.12)"
                  : "rgba(250,249,246,0.92)",
                border: on
                  ? `1px solid ${ACCENT_TEAL}`
                  : "1px solid rgba(61,56,51,0.12)",
                borderRadius: 3,
                fontFamily: MONO,
                fontSize: 9,
                fontWeight: on ? 500 : 400,
                color: on ? ACCENT_TEAL_TEXT : TEXT_MUTED,
                cursor: "pointer",
              }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {dayCounts.size === 0 ? (
        <p
          style={{
            margin: "8px 10px",
            fontFamily: MONO,
            fontSize: 9,
            color: TEXT_MUTED,
          }}
        >
          no days yet
        </p>
      ) : (
        <DayGrid
          dayCounts={dayCounts}
          selected={days}
          onSelect={onDays}
          style={gridStyle}
        />
      )}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 5,
          padding: "7px 10px 8px",
          borderTop: "1px solid rgba(61,56,51,0.08)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            fontFamily: MONO,
          }}
        >
          <span
            style={{
              fontSize: 8,
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              color: TEXT_MUTED,
            }}
          >
            time of day
          </span>
          <span
            style={{
              fontSize: 9,
              color: timeOfDay ? ACCENT_TEAL_TEXT : TEXT_MUTED,
            }}
          >
            {timeOfDay ? formatTimeOfDay(timeOfDay) : "any time"}
          </span>
        </div>
        <div
          role="group"
          aria-label="Time of day"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${QUARTER_DAYS.length}, minmax(0, 1fr))`,
            borderRadius: 3,
            overflow: "hidden",
            border: "1px solid rgba(61,56,51,0.14)",
          }}
        >
          {QUARTER_DAYS.map((option) => {
            const on = quarter?.label === option.label;
            const dim = timeOfDay !== null && !on;
            const color = QUARTER_COLORS[option.label];
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={on}
                aria-label={`${option.label}, ${formatTimeOfDay(option.window)}`}
                title={`${option.label} ${formatTimeOfDay(option.window)}`}
                onClick={() => onTimeOfDay(on ? null : option.window)}
                style={{
                  height: 22,
                  padding: 0,
                  margin: 0,
                  border: "none",
                  borderRight: "1px solid rgba(250,249,246,0.7)",
                  background: `rgba(${color.rgb},${on ? 0.95 : dim ? 0.22 : 0.5})`,
                  boxShadow: on
                    ? `inset 0 0 0 2px ${ACCENT_TEAL_TEXT}`
                    : "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: MONO,
                  fontSize: 10,
                  lineHeight: 1,
                  color: on ? color.ink : "rgba(61,56,51,0.55)",
                }}
              >
                <span aria-hidden="true">{QUARTER_GLYPHS[option.label]}</span>
              </button>
            );
          })}
        </div>
        <div
          aria-hidden="true"
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: MONO,
            fontSize: 7,
            color: "rgba(61,56,51,0.6)",
          }}
        >
          <span>12a</span>
          <span>6a</span>
          <span>12p</span>
          <span>6p</span>
          <span>12a</span>
        </div>
        {timeOfDay && (
          <div
            title="Recurring time-of-day window (local time), across every day"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontFamily: MONO,
              fontSize: 10,
            }}
          >
            <TimeOfDayInputs value={timeOfDay} onChange={onTimeOfDay} />
          </div>
        )}
      </div>
    </div>
  );
};

/** Width of the panel's content, matching the day grid plus its padding. */
export const WHEN_PANEL_WIDTH = DAY_GRID_WIDTH + 24;

const linkStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "2px 0",
  fontFamily: MONO,
  fontSize: 9,
  color: ACCENT_TEAL_TEXT,
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: 2,
};
