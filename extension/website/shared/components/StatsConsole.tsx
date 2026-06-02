// ABOUTME: Top-of-canvas instrument console showing dataset scale at a glance
// ABOUTME: Mirrors the ActivityStrip's bottom-of-screen role with totals + breakdowns

import React, { useMemo } from "react";
import { CollectionEvent } from "../types";
import { extractDomain } from "../utils/eventUtils";

interface StatsConsoleProps {
  events: CollectionEvent[];
  /** Count of events after the canvas-scope time range is applied. When
   * not set or equal to `events.length`, the "in range" line is hidden. */
  filteredEventCount?: number;
  trailCount: number;
  cycleDurationMs: number;
  animationSpeed: number;
  /** Pixels to leave on the left so the console doesn't overlap the dev
   * panel (which is `position: fixed; left: 0` at 320px wide). */
  leftOffset: number;
  loading: boolean;
  error: string | null;
}

const CONSOLE_BG = "#faf9f6";
const CONSOLE_BORDER = "rgba(61,56,51,0.14)";
const CONSOLE_FRAME =
  "inset 1px 1px 2px rgba(255, 255, 255, 0.8), inset -1px -1px 2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.08)";
const VALUE_FONT = "'Martian Mono', 'Space Mono', monospace";
const LABEL_FONT = "'Martian Mono', 'Space Mono', monospace";

/** A single equipment-style readout: big monospace value on top, small
 * uppercase label below. Stack horizontally to form the console. */
const Tile: React.FC<{
  label: string;
  value: string;
  /** Smaller subtitle/unit shown after the value (e.g. "min" on cycle). */
  unit?: string;
  /** Optional accent color for the value — used to color-code event
   * type breakdown. Defaults to text color. */
  accent?: string;
  /** Sets the minimum width so equal-rank tiles align nicely. */
  minWidth?: number;
  /** Hover tooltip — typically the full unshortened number. */
  titleAttr?: string;
}> = ({ label, value, unit, accent, minWidth = 64, titleAttr }) => (
  <div
    title={titleAttr}
    style={{
      display: "flex",
      flexDirection: "column",
      gap: 2,
      padding: "6px 12px",
      minWidth,
      borderRight: `1px solid ${CONSOLE_BORDER}`,
    }}
  >
    <div
      style={{
        fontFamily: VALUE_FONT,
        fontSize: 16,
        fontWeight: 600,
        color: accent ?? "#3d3833",
        letterSpacing: "0.5px",
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {value}
      {unit ? (
        <span
          style={{
            marginLeft: 4,
            fontSize: 10,
            fontWeight: 500,
            color: "#8a8279",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
          }}
        >
          {unit}
        </span>
      ) : null}
    </div>
    <div
      style={{
        fontFamily: LABEL_FONT,
        fontSize: 9,
        fontWeight: 600,
        color: "#8a8279",
        letterSpacing: "1px",
        textTransform: "uppercase",
        lineHeight: 1,
      }}
    >
      {label}
    </div>
  </div>
);

/** Single-pass walk over events: unique pids/sids/domains + high-level
 * type counts + the time span. Domain count falls back to URL-derived
 * hostname when `event.domain` is missing (older payloads, client-side
 * domain filtering, etc.), which fixes the "0 domains while filtered to
 * a domain" symptom. */
function computeConsoleStats(events: CollectionEvent[]) {
  const pids = new Set<string>();
  const sids = new Set<string>();
  const domains = new Set<string>();
  const byType: Record<string, number> = {
    cursor: 0,
    navigation: 0,
    viewport: 0,
    keyboard: 0,
  };
  let minTs = Infinity;
  let maxTs = -Infinity;

  for (const e of events) {
    if (e.meta?.pid) pids.add(e.meta.pid);
    if (e.meta?.sid) sids.add(e.meta.sid);
    const d = e.domain || extractDomain(e.meta?.url ?? "");
    if (d) domains.add(d);
    if (e.type in byType) byType[e.type]++;
    if (typeof e.ts === "number") {
      if (e.ts < minTs) minTs = e.ts;
      if (e.ts > maxTs) maxTs = e.ts;
    }
  }

  return {
    uniquePids: pids.size,
    uniqueSids: sids.size,
    uniqueDomains: domains.size,
    byType,
    minTs: Number.isFinite(minTs) ? minTs : 0,
    maxTs: Number.isFinite(maxTs) ? maxTs : 0,
  };
}

/** 1234 → "1.2k", 1_234_567 → "1.2M". <1000 stays exact. Returns the
 * shortened display string; the full count goes in the tile's `title`
 * for hover/inspect.  */
function shortenCount(n: number): string {
  if (n < 1000) return n.toLocaleString();
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  if (n < 10_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1_000_000)}M`;
}

/** Coarse "Xh ago" / "Xd ago" relative time. Anything within the last
 * minute reads as "just now"; older than 30 days falls back to absolute
 * date. */
function relativeTime(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  const mins = diff / 60_000;
  if (mins < 60) return `${Math.round(mins)}m ago`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.round(hrs)}h ago`;
  const days = hrs / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Compact start→end date range for the dataset's actual time bounds.
 *
 *   Same day: "May 11 9:14 AM → 5:42 PM"
 *   Multi-day: "Apr 27 → May 11"
 *   Hover/title carries the exact unrounded timestamps.
 *
 * We previously rendered just a duration ("14 days") which left the user
 * guessing which 14 days. The absolute range is much more informative for
 * picking out art-piece moments. */
function formatTimeSpan(minTs: number, maxTs: number): string {
  if (!minTs || !maxTs || maxTs <= minTs) return "—";
  const start = new Date(minTs);
  const end = new Date(maxTs);
  const sameDay = start.toDateString() === end.toDateString();
  const dateFmt: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  if (sameDay) {
    const timeFmt: Intl.DateTimeFormatOptions = {
      hour: "numeric",
      minute: "2-digit",
    };
    return `${start.toLocaleDateString(undefined, dateFmt)} ${start.toLocaleTimeString(undefined, timeFmt)} → ${end.toLocaleTimeString(undefined, timeFmt)}`;
  }
  return `${start.toLocaleDateString(undefined, dateFmt)} → ${end.toLocaleDateString(undefined, dateFmt)}`;
}

/** Top-level event-type labels — these mirror the registry but stay
 * separate so we can keep the console rendering independent of viz IDs. */
const TYPE_LABELS: Record<string, string> = {
  cursor: "Cursor",
  navigation: "Nav",
  viewport: "Scroll",
  keyboard: "Keys",
};

const ACCENTS = {
  teal: "#4a9a8a",
  rust: "#c4724e",
  blue: "#5b8db8",
  gold: "#d4b85c",
};

export const StatsConsole: React.FC<StatsConsoleProps> = ({
  events,
  filteredEventCount,
  trailCount,
  cycleDurationMs,
  animationSpeed,
  leftOffset,
  loading,
  error,
}) => {
  const stats = useMemo(() => computeConsoleStats(events), [events]);
  const filterIsActive =
    typeof filteredEventCount === "number" &&
    filteredEventCount !== events.length;

  const cycleMin = cycleDurationMs > 0 ? cycleDurationMs / 60000 : 0;
  const timeSpan = formatTimeSpan(stats.minTs, stats.maxTs);
  const lastSeen = relativeTime(stats.maxTs);

  // High-level event-type tiles: only render the types that have data.
  // Keeps the console honest about what's actually loaded (e.g. when only
  // cursor data is fetched, you don't see empty Nav/Scroll/Keys tiles).
  const typeTiles = (Object.entries(stats.byType) as [string, number][])
    .filter(([, n]) => n > 0)
    .map(([type, n]) => ({
      type,
      label: TYPE_LABELS[type] ?? type,
      count: n,
    }));

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: leftOffset,
        right: 12,
        zIndex: 95,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          background: CONSOLE_BG,
          border: `1px solid ${CONSOLE_BORDER}`,
          boxShadow: CONSOLE_FRAME,
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {/* Primary stats — the scale of the dataset */}
        <Tile
          label="People"
          value={shortenCount(stats.uniquePids)}
          titleAttr={`${stats.uniquePids.toLocaleString()} unique participant${stats.uniquePids === 1 ? "" : "s"}`}
          accent={ACCENTS.teal}
          minWidth={70}
        />
        <Tile
          label="Sessions"
          value={shortenCount(stats.uniqueSids)}
          titleAttr={`${stats.uniqueSids.toLocaleString()} unique session${stats.uniqueSids === 1 ? "" : "s"}`}
          accent={ACCENTS.blue}
          minWidth={72}
        />
        <Tile
          label="Domains"
          value={shortenCount(stats.uniqueDomains)}
          titleAttr={`${stats.uniqueDomains.toLocaleString()} unique domain${stats.uniqueDomains === 1 ? "" : "s"}`}
          accent={ACCENTS.gold}
          minWidth={70}
        />
        <Tile
          label="Events"
          value={shortenCount(events.length)}
          titleAttr={`${events.length.toLocaleString()} total event${events.length === 1 ? "" : "s"}`}
          accent={ACCENTS.rust}
          minWidth={72}
        />

        {/* Spacer + secondary readouts */}
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "stretch",
            justifyContent: "flex-end",
            gap: 0,
          }}
        >
          {filterIsActive && (
            <Tile
              label="In Range"
              value={shortenCount(filteredEventCount ?? 0)}
              titleAttr={`${(filteredEventCount ?? 0).toLocaleString()} events in the selected time range`}
              accent={ACCENTS.teal}
              minWidth={84}
            />
          )}

          {/* High-level event-type breakdown. Replaces the old Move/Click/
              Hold tiles — those over-indexed on cursor sub-events. This
              version tells you what kinds of data are loaded, which is
              the more interesting question for art-piece evaluation. */}
          {typeTiles.map((t) => (
            <Tile
              key={t.type}
              label={t.label}
              value={shortenCount(t.count)}
              titleAttr={`${t.count.toLocaleString()} ${t.type} event${t.count === 1 ? "" : "s"}`}
              minWidth={64}
            />
          ))}

          {trailCount > 0 && (
            <Tile
              label="Trails"
              value={shortenCount(trailCount)}
              titleAttr={`${trailCount.toLocaleString()} trail${trailCount === 1 ? "" : "s"} on canvas`}
              minWidth={64}
            />
          )}

          {timeSpan !== "—" && (
            <Tile
              label="Span"
              value={timeSpan}
              titleAttr={`from ${new Date(stats.minTs).toLocaleString()} to ${new Date(stats.maxTs).toLocaleString()}`}
              minWidth={80}
            />
          )}

          {lastSeen && (
            <Tile
              label="Last Seen"
              value={lastSeen}
              titleAttr={new Date(stats.maxTs).toLocaleString()}
              minWidth={88}
            />
          )}

          {cycleMin > 0 && (
            <Tile
              label="Cycle"
              value={cycleMin.toFixed(1)}
              unit={animationSpeed !== 1 ? `min · ${animationSpeed}×` : "min"}
              titleAttr={`Animation cycle: ${cycleMin.toFixed(2)} minutes${animationSpeed !== 1 ? ` at ${animationSpeed}× speed` : ""}`}
              minWidth={animationSpeed !== 1 ? 96 : 76}
            />
          )}

          {/* Status pill — only when something's worth saying. Borderless,
              right side, replaces the right border of the previous tile. */}
          {(loading || error) && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "0 14px",
                fontFamily: VALUE_FONT,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: "1px",
                textTransform: "uppercase",
                color: error ? "#c4724e" : "#8a8279",
                background: error ? "rgba(196,114,78,0.08)" : "transparent",
                borderLeft: `1px solid ${CONSOLE_BORDER}`,
              }}
              title={error ?? undefined}
            >
              {error ? "Error" : "Loading…"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
