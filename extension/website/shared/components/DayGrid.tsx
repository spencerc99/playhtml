// ABOUTME: Month-grouped grid of day cells with a stroke texture whose density follows each day's count.
// ABOUTME: Picks a day, a span between two clicked days, or a whole month from its header; shared by every "when" panel.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dayRangeContains,
  isSingleDay,
  isWholeMonth,
  monthOf,
  sameDayRange,
  singleDay,
  spanBetween,
  type DayRange,
} from "../utils/dayRange";

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

/** Width of the grid's cells and gaps, without the scroll area's padding. */
export const DAY_GRID_WIDTH = COLS * CELL_W + (COLS - 1) * GRID_GAP;

const SURFACE = "#f5f0e8";
const ACCENT_TEAL = "#4a9a8a";
const ACCENT_TEAL_TEXT = "#2f6f62";
const TEXT = "#3d3833";
const TEXT_FAINT = "rgba(61,56,51,0.6)";
const RANGE_WASH = "rgba(74,154,138,0.16)";
const RANGE_BORDER = "1px solid rgba(74,154,138,0.5)";

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

function formatMonthName(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatMonthHeader(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/** Format a single date in portrait-card style: "Mar 3, 2026" */
export function formatSingleDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Format a date range in portrait-card style: "Mar 2026" or "Feb–Mar 2026" */
export function formatDateRange(oldest: string, newest: string): string {
  const start = new Date(oldest + "T00:00:00");
  const end = new Date(newest + "T00:00:00");
  const startMonth = MONTH_NAMES[start.getMonth()];
  const endMonth = MONTH_NAMES[end.getMonth()];
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  if (startYear === endYear && start.getMonth() === end.getMonth()) return `${endMonth} ${endYear}`;
  if (startYear === endYear) return `${startMonth}–${endMonth} ${endYear}`;
  return `${startMonth} ${startYear}–${endMonth} ${endYear}`;
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

interface DayGridProps {
  /** Every day to show, keyed "YYYY-MM-DD" in local time, with its count. */
  dayCounts: Map<string, number>;
  selected: DayRange | null;
  /**
   * Receives a single day on a first click and the span to the day of a
   * second click. Clicking a lone selected day again clears it (null).
   */
  onSelect: (range: DayRange | null) => void;
  /** Overrides for the scrolling area, such as a height cap. */
  style?: React.CSSProperties;
}

export const DayGrid: React.FC<DayGridProps> = ({
  dayCounts,
  selected,
  onSelect,
  style,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // The day a span starts from, while the viewer picks where it ends.
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  // A selection made elsewhere (a preset, a month, clearing) ends the pick.
  useEffect(() => {
    if (anchor !== null && !sameDayRange(selected, singleDay(anchor))) {
      setAnchor(null);
    }
  }, [anchor, selected]);

  const shown =
    anchor !== null && hovered !== null ? spanBetween(anchor, hovered) : selected;
  const wholeMonth = shown !== null && isWholeMonth(shown);

  const { groups, maxCount } = useMemo(() => {
    const sortedDays = [...dayCounts.keys()].sort();
    let maxCount = 0;
    for (const c of dayCounts.values()) {
      if (c > maxCount) maxCount = c;
    }
    return { groups: groupByMonth(sortedDays), maxCount };
  }, [dayCounts]);

  // Draw textures once mounted and whenever the counts change
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      canvasRefs.current.forEach((canvas, dateStr) => {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const count = dayCounts.get(dateStr) ?? 0;
        drawDayTexture(ctx, CELL_W, CELL_H, count, maxCount, dateStr);
      });
    });
    return () => cancelAnimationFrame(id);
  }, [dayCounts, maxCount]);

  // Start at the bottom, where the most recent days are
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  const handleDayClick = useCallback(
    (dateStr: string) => {
      if (anchor !== null) {
        onSelect(spanBetween(anchor, dateStr));
        setAnchor(null);
        return;
      }
      if (selected && isSingleDay(selected) && selected.start === dateStr) {
        onSelect(null);
        return;
      }
      onSelect(singleDay(dateStr));
      setAnchor(dateStr);
    },
    [anchor, selected, onSelect],
  );

  return (
    <div
      ref={scrollRef}
      onMouseLeave={() => setHovered(null)}
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "4px 10px 6px",
        ...style,
      }}
    >
      {groups.map((group) => (
        <div key={group.header} style={{ marginBottom: 4 }}>
          {/* Month header picks the whole month */}
          {(() => {
            const month = monthOf(group.dates[0]);
            const on = sameDayRange(selected, month);
            return (
              <button
                type="button"
                aria-pressed={on}
                aria-label={`All of ${formatMonthName(group.dates[0])}`}
                onClick={() => {
                  setAnchor(null);
                  onSelect(on ? null : month);
                }}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  margin: 0,
                  border: "none",
                  fontFamily: "'Martian Mono', monospace",
                  fontSize: 8,
                  color: on ? ACCENT_TEAL_TEXT : TEXT_FAINT,
                  fontWeight: on ? 500 : 400,
                  padding: "5px 0 3px",
                  letterSpacing: "0.5px",
                  textTransform: "uppercase",
                  position: "sticky",
                  top: 0,
                  background: "rgba(250,249,246,0.98)",
                  zIndex: 2,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span
                  style={{
                    textDecoration: "underline",
                    textDecorationColor: on
                      ? ACCENT_TEAL
                      : "rgba(61,56,51,0.25)",
                    textUnderlineOffset: 2,
                  }}
                >
                  {group.header}
                </span>
                {on && <span aria-hidden="true">{"\u25CF"}</span>}
              </button>
            );
          })()}
          {/* Day cells in grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${COLS}, ${CELL_W}px)`,
              gap: GRID_GAP,
            }}
          >
            {group.dates.map((dateStr) => {
              const isSelected =
                selected !== null && dayRangeContains(selected, dateStr);
              const inShown =
                shown !== null && dayRangeContains(shown, dateStr);
              const isEdge =
                inShown &&
                !wholeMonth &&
                (dateStr === shown.start || dateStr === shown.end);
              return (
                <div
                  key={dateStr}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={formatSingleDate(dateStr)}
                  data-day={dateStr}
                  onClick={() => handleDayClick(dateStr)}
                  onMouseEnter={() => setHovered(dateStr)}
                  onFocus={() => setHovered(dateStr)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleDayClick(dateStr);
                    }
                  }}
                  style={{
                    position: "relative",
                    width: CELL_W,
                    height: CELL_H,
                    cursor: "pointer",
                    borderRadius: 3,
                    overflow: "hidden",
                    border: isEdge
                      ? `2px solid ${ACCENT_TEAL}`
                      : inShown
                        ? RANGE_BORDER
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
                  {inShown && (
                    <div
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: RANGE_WASH,
                      }}
                    />
                  )}
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
                        fontWeight: isEdge ? 700 : 500,
                        color: inShown ? ACCENT_TEAL_TEXT : TEXT,
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
  );
};
