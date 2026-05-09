// ABOUTME: Horizontal density strip for picking time ranges in the dev tool
// ABOUTME: Supports multi-day overview + drilldown, zoom levels, and horizontal scroll

import React, { useMemo, useRef, useState, useEffect } from "react";
import type { CollectionEvent, DayCounts } from "../types";
import {
  computeHotspots,
  computeSustainScores,
  type HotspotBucket,
} from "../utils/hotspots";

interface ActivityStripProps {
  /** Single-day events (or all events if no day is selected). Used for any
   * zoom level finer than `week`. */
  events: CollectionEvent[];
  /** Per-day event counts across the entire dataset, regardless of which
   * day is currently loaded. Used for the `week` zoom level. */
  dayCounts?: DayCounts;
  /** Currently selected day from DaySelector (date string or null). */
  selectedDay: string | null;
  /** Set the parent's selected day — clicking a day-bar in week mode. */
  onSelectDay?: (day: string | null) => void;
  /** Selected window highlight; matches the canvas-scope range. */
  selectedRange: { startMs: number; endMs: number } | null;
  onSelectRange: (range: { startMs: number; endMs: number } | null) => void;
  /** Optional event-type allowlist matching the controls panel. */
  allowedTypes?: Set<string>;
  /** When the Controls panel is open, the strip needs to leave room. */
  leftOffset: number;
  rightOffset?: number;
  bottomOffset?: number;
}

const TEAL_RGB: [number, number, number] = [74, 154, 138];
const RUST = "#c4724e";
const TEXT = "#3d3833";
const TEXT_MUTED = "rgba(61,56,51,0.55)";
const SURFACE = "rgba(250,247,242,0.95)";

// Zoom levels (coarsest → finest).
// - "weeks": multi-day view, 1 bar = 7 days (sums dayCounts)
// - "days": multi-day view, 1 bar = 1 day (dayCounts + events for unique pids)
// - "quarter": multi-day view, 1 bar = 6 hours (events only — covers the
//   loaded slice; days outside the slice show no data)
// - "hours": multi-day view, 1 bar = 1 hour (events only)
// - "15m": multi-day view, 1 bar = 15 min (events only)
//
// Hours and 15m used to require a `selectedDay` but now span the full
// loaded event window. Picking a day in Days mode is still useful — it
// narrows the parent's fetch so that day has higher event resolution —
// but it doesn't gate which views render.
type ZoomLevel = "weeks" | "days" | "quarter" | "hours" | "15m";

const ZOOM_ORDER: ZoomLevel[] = [
  "weeks",
  "days",
  "quarter",
  "hours",
  "15m",
];

const ZOOM_BUCKET_MS: Record<Exclude<ZoomLevel, "weeks" | "days">, number> = {
  quarter: 6 * 60 * 60 * 1000,
  hours: 60 * 60 * 1000,
  "15m": 15 * 60 * 1000,
};

const ZOOM_LABEL: Record<ZoomLevel, string> = {
  weeks: "Weeks",
  days: "Days",
  quarter: "6-hour",
  hours: "Hours",
  "15m": "15-min",
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const BAR_PX = 8;
const STRIP_HEIGHT = 56;
const AXIS_HEIGHT = 14;

const formatBucketLabel = (
  startMs: number,
  endMs: number,
  zoom: ZoomLevel,
): string => {
  const start = new Date(startMs);
  if (zoom === "weeks") {
    const end = new Date(endMs - 1);
    const sameMonth = start.getMonth() === end.getMonth();
    if (sameMonth) {
      return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })}–${end.getDate()}`;
    }
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  if (zoom === "days") {
    return start.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  if (zoom === "quarter") {
    // Quarter labels: M/d 12a/6a/12p/6p, with the date prefix only on the
    // first quarter of each day so the axis isn't visually noisy.
    const hour = start.getHours();
    const isDayStart = hour === 0;
    const dateStr = isDayStart
      ? start.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }) + " "
      : "";
    const period =
      hour === 0
        ? "12a"
        : hour === 6
          ? "6a"
          : hour === 12
            ? "12p"
            : "6p";
    return `${dateStr}${period}`;
  }
  if (zoom === "hours") {
    return start.toLocaleTimeString(undefined, { hour: "numeric" });
  }
  return start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
};

/** "YYYY-MM-DD" → epoch midnight in local time. */
const dayKeyToMs = (day: string): number => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
};

const msToDayKey = (ms: number): string => {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const ActivityStrip: React.FC<ActivityStripProps> = ({
  events,
  dayCounts,
  selectedDay,
  onSelectDay,
  selectedRange,
  onSelectRange,
  allowedTypes,
  leftOffset,
  rightOffset = 16,
  bottomOffset = 16,
}) => {
  // Default zoom level on mount.
  const [zoom, setZoom] = useState<ZoomLevel>(selectedDay ? "hours" : "days");

  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<
    { startMs: number; currentMs: number } | null
  >(null);
  const [hoverMs, setHoverMs] = useState<number | null>(null);

  // ── Bucket computation per zoom level ──────────────────────────────────────
  type Bar = {
    startMs: number;
    endMs: number;
    /** Headline metric — height. */
    primary: number;
    /** Secondary metric — color saturation (sustained-ness). 0..1 */
    sustainFrac: number;
    /** Bucket payload for tooltip. */
    label: string;
    sublabel: string;
    dayKey?: string;
  };

  // Per-day stats derived from the loaded event slice. When no day is
  // selected the parent fetches up to ~5000 most-recent events, which
  // typically spans many days — enough to compute a real unique-people
  // signal across recent days. Days outside this slice fall back to the
  // dayCounts event total.
  const dayStats = useMemo(() => {
    const m = new Map<
      string,
      { events: number; pids: Set<string> }
    >();
    for (const e of events) {
      const key = msToDayKey(e.ts);
      let entry = m.get(key);
      if (!entry) {
        entry = { events: 0, pids: new Set() };
        m.set(key, entry);
      }
      entry.events++;
      if (e.meta?.pid) entry.pids.add(e.meta.pid);
    }
    return m;
  }, [events]);

  const bars: Bar[] = useMemo(() => {
    if (zoom === "weeks" || zoom === "days") {
      // dayCounts gives event totals across the full dataset. dayStats
      // (from loaded events) gives unique pids — but only for days the
      // loader pulled. We use unique pids as the primary metric when
      // available, falling back to event counts. Crucially the maximum
      // for normalisation is computed from whichever metric a bar uses,
      // so both scales co-exist without one drowning the other.
      if (!dayCounts || dayCounts.size === 0) return [];
      const entries = Array.from(dayCounts.entries())
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => a.day.localeCompare(b.day));
      const filled: Array<{
        day: string;
        ms: number;
        events: number;
        pids: number;
      }> = [];
      if (entries.length > 0) {
        const startMs = dayKeyToMs(entries[0].day);
        const endMs = dayKeyToMs(entries[entries.length - 1].day);
        for (let t = startMs; t <= endMs; t += DAY_MS) {
          const k = msToDayKey(t);
          const dayCount =
            entries.find((e) => e.day === k)?.count ?? 0;
          const stats = dayStats.get(k);
          filled.push({
            day: k,
            ms: t,
            events: dayCount || stats?.events || 0,
            pids: stats?.pids.size ?? 0,
          });
        }
      }
      const maxPids = filled.reduce((m, e) => Math.max(m, e.pids), 0);
      const maxEvents = filled.reduce((m, e) => Math.max(m, e.events), 0);
      const formatSublabel = (pids: number, ev: number) =>
        pids > 0
          ? `${pids}p · ${ev.toLocaleString()} ev`
          : `${ev.toLocaleString()} ev`;

      if (zoom === "days") {
        return filled.map((e) => ({
          startMs: e.ms,
          endMs: e.ms + DAY_MS,
          // Prefer unique-pid scale when we have any data; else event scale.
          primary: e.pids > 0 ? e.pids : e.events,
          sustainFrac:
            e.pids > 0
              ? maxPids > 0
                ? e.pids / maxPids
                : 0
              : maxEvents > 0
                ? e.events / maxEvents
                : 0,
          label: new Date(e.ms).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
          sublabel: formatSublabel(e.pids, e.events),
          dayKey: e.day,
        }));
      }
      // Weeks: bundle 7 days at a time. Sum events; sum pids per day (a
      // person who shows up on multiple days within a week counts once
      // per day, which is what we want — a "person-day" attendance count).
      if (filled.length === 0) return [];
      const groups: Bar[] = [];
      let i = 0;
      while (i < filled.length) {
        const groupStart = filled[i].ms;
        const groupEnd = groupStart + WEEK_MS;
        let evSum = 0;
        let pidSum = 0;
        while (i < filled.length && filled[i].ms < groupEnd) {
          evSum += filled[i].events;
          pidSum += filled[i].pids;
          i++;
        }
        groups.push({
          startMs: groupStart,
          endMs: groupEnd,
          primary: pidSum > 0 ? pidSum : evSum,
          sustainFrac: 0,
          label: formatBucketLabel(groupStart, groupEnd, "weeks"),
          sublabel: formatSublabel(pidSum, evSum),
        });
      }
      const maxGroup = groups.reduce((m, g) => Math.max(m, g.primary), 0);
      return groups.map((g) => ({
        ...g,
        sustainFrac: maxGroup > 0 ? g.primary / maxGroup : 0,
      }));
    }
    if (zoom === "quarter") {
      // 6-hour bars across the loaded events. Multi-day, no selected-day
      // requirement. This is the "scrub for hotspots without committing
      // to a day" view — densest 6-hour blocks pop visually.
      if (events.length === 0) return [];
      const buckets = computeHotspots(events, {
        bucketMs: ZOOM_BUCKET_MS.quarter,
        allowedTypes,
      });
      if (buckets.length === 0) return [];
      const max = buckets.reduce((m, b) => Math.max(m, b.uniquePids), 0);
      const sustain = computeSustainScores(buckets, 4);
      const maxSustain = sustain.reduce((m, s) => Math.max(m, s), 0);
      void max; // satisfies linter when only sustain drives saturation
      return buckets.map((b, i) => ({
        startMs: b.startMs,
        endMs: b.endMs,
        primary: b.uniquePids,
        sustainFrac: maxSustain > 0 ? sustain[i] / maxSustain : 0,
        label: formatBucketLabel(b.startMs, b.endMs, "quarter"),
        sublabel: `${b.uniquePids}p · ${b.eventCount.toLocaleString()} ev`,
      }));
    }
    if (events.length === 0) return [];
    const bucketMs = ZOOM_BUCKET_MS[zoom as "hours" | "15m"];
    const buckets = computeHotspots(events, { bucketMs, allowedTypes });
    if (buckets.length === 0) return [];
    const max = buckets.reduce((m, b) => Math.max(m, b.uniquePids), 0);
    const sustain = computeSustainScores(buckets, 5);
    const maxSustain = sustain.reduce((m, s) => Math.max(m, s), 0);
    return buckets.map((b, i) => ({
      startMs: b.startMs,
      endMs: b.endMs,
      primary: b.uniquePids,
      sustainFrac: maxSustain > 0 ? sustain[i] / maxSustain : 0,
      label: formatBucketLabel(b.startMs, b.endMs, zoom),
      sublabel: `${b.uniquePids}p · ${b.eventCount} ev`,
    }));
  }, [zoom, dayCounts, events, allowedTypes, dayStats]);

  const totalContentWidth = bars.length * BAR_PX;

  // ── Geometry helpers ───────────────────────────────────────────────────────
  const indexFromX = (x: number): number => {
    if (bars.length === 0) return -1;
    return Math.max(0, Math.min(bars.length - 1, Math.floor(x / BAR_PX)));
  };
  const msToX = (ms: number): number => {
    if (bars.length === 0) return 0;
    // Find the bar whose [start, end) contains ms; otherwise interpolate.
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (ms >= b.startMs && ms < b.endMs) {
        const frac = (ms - b.startMs) / (b.endMs - b.startMs);
        return (i + frac) * BAR_PX;
      }
    }
    if (ms < bars[0].startMs) return 0;
    return bars.length * BAR_PX;
  };
  const xToMs = (x: number): number => {
    if (bars.length === 0) return 0;
    const idx = Math.max(0, Math.min(bars.length - 1, Math.floor(x / BAR_PX)));
    const b = bars[idx];
    const frac = Math.max(0, Math.min(1, (x - idx * BAR_PX) / BAR_PX));
    return b.startMs + frac * (b.endMs - b.startMs);
  };

  // ── Mouse interaction ──────────────────────────────────────────────────────
  // Weeks/Days are "click to navigate" modes; Hours/15m are "drag to scope"
  // modes. Drag selection only happens when the user is already at a
  // single-day zoom.
  const isClickNavMode = zoom === "weeks" || zoom === "days";

  const onMouseDown = (e: React.MouseEvent) => {
    if (isClickNavMode) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) + (scrollRef.current?.scrollLeft ?? 0);
    const ms = xToMs(x);
    setDrag({ startMs: ms, currentMs: ms });
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = (e.clientX - rect.left) + (scrollRef.current?.scrollLeft ?? 0);
    const ms = xToMs(x);
    setHoverMs(ms);
    if (drag) setDrag({ ...drag, currentMs: ms });
  };

  const onMouseLeave = () => {
    setHoverMs(null);
    if (drag) setDrag(null);
  };

  const onMouseUp = (e: React.MouseEvent) => {
    if (isClickNavMode) {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) + (scrollRef.current?.scrollLeft ?? 0);
      const idx = indexFromX(x);
      const bar = bars[idx];
      if (!bar) return;
      if (zoom === "days" && bar.dayKey && onSelectDay) {
        // Pick the specific day → parent fetches that day's events with
        // higher resolution. Auto-zoom into Hours so the user sees the
        // hourly breakdown of the day they just picked.
        onSelectDay(bar.dayKey);
        setZoom("hours");
      } else if (zoom === "weeks") {
        // Drill into Days view; auto-scroll will center on the clicked week.
        // Pick the *first* day in the week so the scroll target is sensible.
        const firstDay = msToDayKey(bar.startMs);
        // Don't actually fetch yet — just zoom into the Days level so the
        // user can pick a specific day. (Selecting the first day would feel
        // arbitrary.) We achieve "scroll to" by relying on the auto-scroll
        // effect against selectedRange — but range is null. Instead, set
        // a transient hint by stashing the target in selectedDay would
        // re-trigger fetch. Simplest: just zoom level and let the user
        // pick a day from the closer grid.
        void firstDay;
        setZoom("days");
      }
      return;
    }
    if (!drag) return;
    const a = Math.min(drag.startMs, drag.currentMs);
    const b = Math.max(drag.startMs, drag.currentMs);
    setDrag(null);
    const minBucket = bars[0].endMs - bars[0].startMs;
    if (b - a < minBucket) {
      const bucketStart = Math.floor(a / minBucket) * minBucket;
      onSelectRange({ startMs: bucketStart, endMs: bucketStart + minBucket });
    } else {
      onSelectRange({ startMs: a, endMs: b });
    }
  };

  const onDoubleClick = () => {
    if (!isClickNavMode) onSelectRange(null);
  };

  // ── Zoom handling ──────────────────────────────────────────────────────────
  const zoomIdx = ZOOM_ORDER.indexOf(zoom);
  const canZoomOut = zoomIdx > 0;
  const canZoomIn = zoomIdx < ZOOM_ORDER.length - 1;

  const zoomOut = () => {
    if (!canZoomOut) return;
    setZoom(ZOOM_ORDER[zoomIdx - 1]);
  };

  const zoomIn = () => {
    if (!canZoomIn) return;
    setZoom(ZOOM_ORDER[zoomIdx + 1]);
  };

  // Wheel-zoom (cmd/ctrl + wheel) — feels native in this register.
  const onWheel = (e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  };

  // Auto-scroll selection or current day into view when bars change.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || bars.length === 0) return;
    let targetMs: number | null = null;
    if (selectedRange) targetMs = selectedRange.startMs;
    else if ((zoom === "weeks" || zoom === "days") && selectedDay)
      targetMs = dayKeyToMs(selectedDay);
    if (targetMs === null) return;
    const x = msToX(targetMs);
    const visibleW = el.clientWidth;
    if (x < el.scrollLeft || x > el.scrollLeft + visibleW) {
      el.scrollTo({ left: Math.max(0, x - visibleW / 2), behavior: "smooth" });
    }
  }, [bars.length, selectedRange?.startMs, selectedDay, zoom]);

  // ── Render ─────────────────────────────────────────────────────────────────
  if (bars.length === 0) return null;

  const dragRange = drag
    ? {
        startMs: Math.min(drag.startMs, drag.currentMs),
        endMs: Math.max(drag.startMs, drag.currentMs),
      }
    : null;
  const overlayRange = dragRange ?? selectedRange;

  // Day-mode highlight: when in week zoom and a day is picked, mark the
  // corresponding bar.
  // Mark the bar containing the selected day. In Days mode each bar has a
  // dayKey; in Weeks mode a week-bar covers the selected day if its
  // [start, end) span includes it.
  let highlightedDayIdx = -1;
  if (selectedDay && (zoom === "weeks" || zoom === "days")) {
    const targetMs = dayKeyToMs(selectedDay);
    highlightedDayIdx = bars.findIndex(
      (b) => targetMs >= b.startMs && targetMs < b.endMs,
    );
  }

  // Tick spacing on the axis: aim for ~6 visible ticks regardless of zoom.
  const desiredTickPx = 140;
  const tickStride = Math.max(
    1,
    Math.round(desiredTickPx / BAR_PX),
  );
  const tickIndices: number[] = [];
  for (let i = 0; i < bars.length; i += tickStride) tickIndices.push(i);
  if (tickIndices[tickIndices.length - 1] !== bars.length - 1)
    tickIndices.push(bars.length - 1);

  return (
    <div
      style={{
        position: "absolute",
        bottom: bottomOffset,
        left: leftOffset,
        right: rightOffset,
        zIndex: 99,
        background: SURFACE,
        border: "1px solid rgba(61,56,51,0.12)",
        borderRadius: 4,
        backdropFilter: "blur(8px)",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        fontFamily: '"Atkinson Hyperlegible", system-ui, sans-serif',
        userSelect: "none",
      }}
    >
      {/* Header: zoom controls + label */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px",
          fontSize: 10,
          fontFamily: '"Martian Mono", "Space Mono", monospace',
          color: TEXT_MUTED,
          letterSpacing: "0.5px",
          textTransform: "uppercase",
          borderBottom: "1px solid rgba(61,56,51,0.06)",
        }}
      >
        <span>
          Activity · {ZOOM_LABEL[zoom]}
          {selectedDay && !isClickNavMode && (
            <span style={{ color: TEXT, marginLeft: 6 }}>
              {new Date(dayKeyToMs(selectedDay)).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
        </span>
        <span style={{ display: "flex", gap: 4 }}>
          <button
            type="button"
            onClick={zoomOut}
            disabled={!canZoomOut}
            title="Zoom out (⌘ + scroll)"
            style={zoomBtnStyle(canZoomOut)}
          >
            −
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={!canZoomIn}
            title="Zoom in (⌘ + scroll)"
            style={zoomBtnStyle(canZoomIn)}
          >
            +
          </button>
        </span>
      </div>

      {/* Scrollable bar area */}
      <div
        ref={scrollRef}
        onWheel={onWheel}
        style={{
          overflowX: "auto",
          overflowY: "hidden",
          cursor: isClickNavMode
            ? "pointer"
            : drag
              ? "grabbing"
              : "crosshair",
        }}
      >
        <div
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onDoubleClick={onDoubleClick}
          style={{
            position: "relative",
            width: totalContentWidth,
            height: STRIP_HEIGHT + AXIS_HEIGHT,
          }}
          title={
            zoom === "weeks"
              ? "Click a week to drill into days"
              : zoom === "days"
                ? "Click a day to drill into hours"
                : "Drag to pick a range, double-click to clear"
          }
        >
          <svg
            width={totalContentWidth}
            height={STRIP_HEIGHT}
            style={{ display: "block" }}
          >
            {bars.map((b, i) => {
              if (b.primary === 0) return null;
              const heightFrac =
                bars.reduce((m, x) => Math.max(m, x.primary), 0) > 0
                  ? b.primary /
                    bars.reduce((m, x) => Math.max(m, x.primary), 0)
                  : 0;
              const alpha = 0.25 + b.sustainFrac * 0.65;
              const h = Math.max(2, heightFrac * (STRIP_HEIGHT - 4));
              const isHighlightedDay = i === highlightedDayIdx;
              return (
                <rect
                  key={b.startMs}
                  x={i * BAR_PX + 1}
                  y={STRIP_HEIGHT - h - 2}
                  width={BAR_PX - 2}
                  height={h}
                  fill={
                    isHighlightedDay
                      ? RUST
                      : `rgba(${TEAL_RGB[0]}, ${TEAL_RGB[1]}, ${TEAL_RGB[2]}, ${alpha})`
                  }
                />
              );
            })}

            {overlayRange && !isClickNavMode && (
              <rect
                x={msToX(overlayRange.startMs)}
                y={0}
                width={Math.max(
                  2,
                  msToX(overlayRange.endMs) - msToX(overlayRange.startMs),
                )}
                height={STRIP_HEIGHT}
                fill="rgba(196,114,78,0.18)"
                stroke="rgba(196,114,78,0.7)"
                strokeWidth={1}
              />
            )}

            {hoverMs !== null && !drag && (
              <line
                x1={msToX(hoverMs)}
                x2={msToX(hoverMs)}
                y1={0}
                y2={STRIP_HEIGHT}
                stroke="rgba(61,56,51,0.4)"
                strokeWidth={1}
                pointerEvents="none"
              />
            )}
          </svg>

          {/* Axis labels */}
          <div
            style={{
              position: "relative",
              height: AXIS_HEIGHT,
              fontFamily: '"Martian Mono", "Space Mono", monospace',
              fontSize: 9,
              color: TEXT_MUTED,
              borderTop: "1px solid rgba(61,56,51,0.08)",
            }}
          >
            {tickIndices.map((idx) => {
              const b = bars[idx];
              const x = idx * BAR_PX;
              return (
                <span
                  key={idx}
                  style={{
                    position: "absolute",
                    left: x,
                    top: 1,
                    paddingLeft: 2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatBucketLabel(b.startMs, b.endMs, zoom)}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      {hoverMs !== null && !drag && (
        <HoverTooltip
          bars={bars}
          hoverMs={hoverMs}
          msToX={msToX}
          scrollLeft={scrollRef.current?.scrollLeft ?? 0}
        />
      )}
    </div>
  );
};

const zoomBtnStyle = (enabled: boolean): React.CSSProperties => ({
  background: "transparent",
  border: "1px solid rgba(61,56,51,0.18)",
  borderRadius: 2,
  padding: "0 6px",
  fontSize: 12,
  fontFamily: '"Martian Mono", monospace',
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.35,
  color: TEXT,
  lineHeight: "16px",
});

const HoverTooltip: React.FC<{
  bars: Array<{ startMs: number; endMs: number; label: string; sublabel: string }>;
  hoverMs: number;
  msToX: (ms: number) => number;
  scrollLeft: number;
}> = ({ bars, hoverMs, msToX, scrollLeft }) => {
  const idx = bars.findIndex(
    (b) => hoverMs >= b.startMs && hoverMs < b.endMs,
  );
  if (idx < 0) return null;
  const b = bars[idx];
  const x = msToX(hoverMs) - scrollLeft + 8;
  return (
    <div
      style={{
        position: "absolute",
        bottom: STRIP_HEIGHT + AXIS_HEIGHT + 4,
        left: Math.max(8, x),
        background: "rgba(61,56,51,0.92)",
        color: "#faf9f6",
        padding: "3px 6px",
        fontSize: 10,
        fontFamily: '"Martian Mono", "Space Mono", monospace',
        borderRadius: 2,
        pointerEvents: "none",
        whiteSpace: "nowrap",
      }}
    >
      {b.label} · {b.sublabel}
    </div>
  );
};
