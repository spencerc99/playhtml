// ABOUTME: Day selector panel for the movement page with calendar heatmap.
// ABOUTME: Collapsed shows current day; expanded shows compact grid of day cells with texture backgrounds.

import React, { useRef, useEffect, useMemo, useCallback, useState } from "react";

// RISO palette as [r,g,b] for canvas rendering
const PALETTE: [number, number, number][] = [
  [210, 51, 35], // warm red
  [180, 148, 34], // amber
  [92, 158, 46], // moss green
  [39, 155, 130], // teal
  [40, 110, 189], // steel blue
  [80, 55, 189], // violet
  [184, 48, 151], // magenta
  [195, 115, 35], // burnt orange
];

const CELL_W = 62;
const CELL_H = 36;
const GRID_GAP = 3;
const COLS = 3;

const SURFACE = "#f5f0e8";
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

function seededRand(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) & 0xffffffff;
    return (seed >>> 0) / 0xffffffff;
  };
}

function hashDate(dateStr: string): number {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) {
    h = ((h << 5) - h + dateStr.charCodeAt(i)) & 0xffffffff;
  }
  return h;
}

/** Draw vertical-stroke texture into a cell canvas */
function drawDayTexture(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  eventCount: number,
  maxCount: number,
  dateStr: string,
) {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = SURFACE;
  ctx.fillRect(0, 0, w, h);

  if (eventCount === 0 || maxCount === 0) return;

  const density = eventCount / maxCount;
  const strokeCount = Math.max(1, Math.round(density * 30));
  const rand = seededRand(hashDate(dateStr));

  for (let i = 0; i < strokeCount; i++) {
    const [cr, cg, cb] = PALETTE[(i + hashDate(dateStr)) % PALETTE.length];
    const x = rand() * w;
    const sw = 0.5 + rand() * 2;
    const sh = h * (0.3 + rand() * 0.7);
    const opacity = 0.08 + density * 0.15 + rand() * 0.05;
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${opacity.toFixed(3)})`;
    ctx.fillRect(x - sw / 2, 0, sw, sh);
  }
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getDate()}`;
}

function formatDayDow(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return DAY_NAMES[d.getDay()];
}

function formatMonthHeader(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Format a single date in portrait-card style: "Mar 3, 2026" */
function formatSingleDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Format a date range in portrait-card style: "Mar 2026" or "Feb\u2013Mar 2026" */
function formatDateRange(oldest: string, newest: string): string {
  const start = new Date(oldest + "T00:00:00");
  const end = new Date(newest + "T00:00:00");
  const startMonth = MONTH_NAMES[start.getMonth()];
  const endMonth = MONTH_NAMES[end.getMonth()];
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  if (startYear === endYear && start.getMonth() === end.getMonth()) return `${endMonth} ${endYear}`;
  if (startYear === endYear) return `${startMonth}\u2013${endMonth} ${endYear}`;
  return `${startMonth} ${startYear}\u2013${endMonth} ${endYear}`;
}

/** Group sorted date strings by month */
function groupByMonth(
  sortedDays: string[],
): { header: string; dates: string[] }[] {
  const groups: { header: string; dates: string[] }[] = [];
  let current: { header: string; dates: string[] } | null = null;

  for (const ds of sortedDays) {
    const header = formatMonthHeader(ds);
    if (!current || current.header !== header) {
      current = { header, dates: [] };
      groups.push(current);
    }
    current.dates.push(ds);
  }

  return groups;
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const panelRef = useRef<HTMLDivElement>(null);

  const { sortedDays, groups, maxCount } = useMemo(() => {
    if (dayCounts.size === 0) {
      return { sortedDays: [], groups: [], maxCount: 0 };
    }
    const sortedDays = [...dayCounts.keys()].sort();
    const groups = groupByMonth(sortedDays);
    let maxCount = 0;
    for (const c of dayCounts.values()) {
      if (c > maxCount) maxCount = c;
    }
    return { sortedDays, groups, maxCount };
  }, [dayCounts]);

  // Draw textures when panel opens or data changes
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => {
      canvasRefs.current.forEach((canvas, dateStr) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const count = dayCounts.get(dateStr) ?? 0;
        drawDayTexture(ctx, CELL_W, CELL_H, count, maxCount, dateStr);
      });
    });
    return () => cancelAnimationFrame(id);
  }, [open, dayCounts, maxCount]);

  // Scroll to bottom (most recent) when opened
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open]);

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

  const handleDayClick = useCallback(
    (dateStr: string) => {
      if (selectedDay === dateStr) {
        onSelectDay(null);
      } else {
        onSelectDay(dateStr);
      }
    },
    [selectedDay, onSelectDay],
  );

  const collapsedLabel = selectedDay
    ? formatSingleDate(selectedDay)
    : sortedDays.length > 0
      ? formatDateRange(sortedDays[0], sortedDays[sortedDays.length - 1])
      : "";

  if (sortedDays.length === 0) return null;

  const panelWidth = COLS * CELL_W + (COLS - 1) * GRID_GAP + 24;

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
          <div
            ref={scrollRef}
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "4px 10px 6px",
            }}
          >
            {groups.map((group) => (
              <div key={group.header} style={{ marginBottom: 4 }}>
                {/* Month header */}
                <div
                  style={{
                    fontFamily: "'Martian Mono', monospace",
                    fontSize: 8,
                    color: TEXT_FAINT,
                    padding: "3px 0 2px",
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                    position: "sticky",
                    top: 0,
                    background: "rgba(250,249,246,0.95)",
                    zIndex: 1,
                  }}
                >
                  {group.header}
                </div>
                {/* Day cells in grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: `repeat(${COLS}, ${CELL_W}px)`,
                    gap: GRID_GAP,
                  }}
                >
                  {group.dates.map((dateStr) => {
                    const isSelected = selectedDay === dateStr;
                    return (
                      <div
                        key={dateStr}
                        onClick={() => handleDayClick(dateStr)}
                        style={{
                          position: "relative",
                          width: CELL_W,
                          height: CELL_H,
                          cursor: "pointer",
                          borderRadius: 3,
                          overflow: "hidden",
                          border: isSelected
                            ? `2px solid ${ACCENT_TEAL}`
                            : "1px solid rgba(61,56,51,0.08)",
                          boxSizing: "border-box",
                        }}
                      >
                        {/* Texture background */}
                        <canvas
                          ref={(el) => {
                            if (el) canvasRefs.current.set(dateStr, el);
                            else canvasRefs.current.delete(dateStr);
                          }}
                          width={CELL_W}
                          height={CELL_H}
                          style={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                          }}
                        />
                        {/* Day number + dow overlay */}
                        <div
                          style={{
                            position: "relative",
                            zIndex: 1,
                            display: "flex",
                            alignItems: "baseline",
                            gap: 3,
                            padding: "4px 5px",
                          }}
                        >
                          <span
                            style={{
                              fontFamily: "'Lora', Georgia, serif",
                              fontSize: 14,
                              fontWeight: isSelected ? 700 : 500,
                              color: isSelected ? ACCENT_TEAL : TEXT,
                              lineHeight: 1,
                            }}
                          >
                            {formatDayLabel(dateStr)}
                          </span>
                          <span
                            style={{
                              fontFamily: "'Martian Mono', monospace",
                              fontSize: 7,
                              color: TEXT_FAINT,
                              lineHeight: 1,
                            }}
                          >
                            {formatDayDow(dateStr)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

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
