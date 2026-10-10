// ABOUTME: Day selector panel for the movement page with calendar heatmap.
// ABOUTME: Collapsed shows current day; expanded shows the shared textured DayGrid plus playback controls.

import React, { useRef, useEffect, useMemo, useState } from "react";
import {
  DAY_GRID_WIDTH,
  DayGrid,
  formatDateRange,
  formatSingleDate,
} from "./DayGrid";

const ACCENT_TEAL = "#4a9a8a";
const TEXT = "#3d3833";
const TEXT_MUTED = "rgba(61,56,51,0.55)";
const TEXT_FAINT = "rgba(61,56,51,0.35)";

interface DaySelectorProps {
  dayCounts: Map<string, number>;
  selectedDay: string | null;
  onSelectDay: (day: string | null) => void;
  playbackMode: "cycle" | "loop";
  onTogglePlaybackMode: () => void;
  onCapture: () => void;
}

export const DaySelector: React.FC<DaySelectorProps> = ({
  dayCounts,
  selectedDay,
  onSelectDay,
  playbackMode,
  onTogglePlaybackMode,
  onCapture,
}) => {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const sortedDays = useMemo(() => [...dayCounts.keys()].sort(), [dayCounts]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const collapsedLabel = selectedDay
    ? formatSingleDate(selectedDay)
    : sortedDays.length > 0
      ? formatDateRange(sortedDays[0], sortedDays[sortedDays.length - 1])
      : "";

  if (sortedDays.length === 0) return null;

  const panelWidth = DAY_GRID_WIDTH + 24;

  return (
    <div
      ref={panelRef}
      style={{
        position: "absolute",
        bottom: 16,
        left: 16,
        zIndex: 100,
        pointerEvents: "auto",
      }}
    >
      {open ? (
        <div
          style={{
            background: "rgba(250,249,246,0.95)",
            border: "1px solid rgba(61,56,51,0.12)",
            borderRadius: 6,
            backdropFilter: "blur(8px)",
            display: "flex",
            flexDirection: "column",
            width: panelWidth,
            maxHeight: "min(400px, calc(100vh - 64px))",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "6px 10px 4px",
              borderBottom: "1px solid rgba(61,56,51,0.08)",
            }}
          >
            <span
              style={{
                fontFamily: "'Lora', Georgia, serif",
                fontSize: 12,
                fontWeight: 600,
                color: TEXT,
              }}
            >
              select day
            </span>
            <button
              onClick={() => setOpen(false)}
              style={{
                ...btnStyle,
                padding: "1px 5px",
                fontSize: 11,
                lineHeight: 1,
              }}
            >
              {"\u00D7"}
            </button>
          </div>

          {/* Scrollable day grid */}
          <DayGrid
            dayCounts={dayCounts}
            selectedDay={selectedDay}
            onSelectDay={onSelectDay}
          />

          {/* Controls row */}
          <div
            style={{
              display: "flex",
              gap: 6,
              padding: "5px 10px 6px",
              borderTop: "1px solid rgba(61,56,51,0.08)",
              alignItems: "center",
            }}
          >
            <button
              onClick={() => onSelectDay(null)}
              style={{
                ...btnStyle,
                fontWeight: selectedDay === null ? 700 : 400,
                color: selectedDay === null ? ACCENT_TEAL : undefined,
              }}
            >
              all
            </button>
            <button onClick={onTogglePlaybackMode} style={btnStyle}>
              {playbackMode === "loop" ? "loop" : "cycle"}
            </button>
            <button onClick={onCapture} style={btnStyle}>
              capture
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          style={{
            background: "rgba(250,249,246,0.92)",
            border: "1px solid rgba(61,56,51,0.12)",
            borderRadius: 4,
            padding: "6px 12px",
            backdropFilter: "blur(6px)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span
            style={{
              fontFamily: "'Martian Mono', monospace",
              fontSize: 10,
              fontWeight: 500,
              color: selectedDay ? ACCENT_TEAL : TEXT_MUTED,
            }}
          >
            {collapsedLabel}
          </span>
          <span
            style={{
              fontFamily: "'Martian Mono', monospace",
              fontSize: 8,
              color: TEXT_FAINT,
            }}
          >
            {"\u25BC"}
          </span>
        </button>
      )}
    </div>
  );
};

const btnStyle: React.CSSProperties = {
  background: "rgba(250,249,246,0.92)",
  border: "1px solid rgba(61,56,51,0.12)",
  borderRadius: 3,
  padding: "3px 8px",
  fontFamily: "'Martian Mono', monospace",
  fontSize: 9,
  cursor: "pointer",
  color: TEXT_MUTED,
  letterSpacing: "0.3px",
};
