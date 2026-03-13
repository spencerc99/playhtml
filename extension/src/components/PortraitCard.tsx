// ABOUTME: Portrait card component showing browsing stats for a domain
// ABOUTME: Canvas-textured card with vertical strokes mapped to 24h activity rhythm

import React, { useEffect, useRef } from "react";
export interface PortraitCardProps {
  domain: string;
  totalTimeMs: number | null;
  /** Pre-computed total ms per hour-of-day (index 0 = midnight, 23 = 11pm) */
  hourBuckets: number[];
  /** Total cursor distance in pixels (sum of Euclidean distances between samples) */
  cursorDistancePx: number;
  dateRange: { oldest: string; newest: string } | null;
  uniquePageCount: number;
  eventCounts?: { cursor: number; keyboard: number; viewport: number };
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "< 1 min";
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours} hr${hours !== 1 ? "s" : ""}`;
  return `${hours} hr${hours !== 1 ? "s" : ""} ${minutes} min`;
}

export function formatDateRange(oldest: string, newest: string): string {
  const start = new Date(oldest);
  const end = new Date(newest);
  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const startMonth = monthNames[start.getMonth()];
  const endMonth = monthNames[end.getMonth()];
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  if (startYear === endYear && start.getMonth() === end.getMonth())
    return `${endMonth} ${endYear}`;
  if (startYear === endYear) return `${startMonth}\u2013${endMonth} ${endYear}`;
  return `${startMonth} ${startYear}\u2013${endMonth} ${endYear}`;
}

/**
 * Convert raw cursor pixel distance to a human-readable physical distance.
 * Assumes a 27" 1920×1080 monitor at 81.6 dpi — 1px ≈ 0.311mm.
 */
export function formatDistance(px: number): string {
  const mm = px * 0.311;
  const meters = mm / 1000;
  if (meters < 1) return `${Math.round(mm)} mm`;
  if (meters < 1000) return `${meters.toFixed(1)} m`;
  const km = meters / 1000;
  return `${km.toFixed(2)} km`;
}

/**
 * Normalize raw hour buckets (total ms per hour) to [0, 1] weights.
 */
function normalizeHourBuckets(buckets: number[]): number[] {
  const max = Math.max(...buckets, 1);
  return buckets.map((v) => v / max);
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const ACCENT_TEAL = "#4a9a8a";

// Trail palette as [r,g,b] for canvas rendering — matches RISO_COLORS in eventUtils
const CANVAS_PALETTE: [number, number, number][] = [
  [0, 120, 191], // Blue
  [255, 102, 94], // Bright Red
  [0, 169, 92], // Green
  [255, 123, 75], // Orange
  [146, 55, 141], // Purple
  [255, 232, 0], // Yellow
  [255, 72, 176], // Fluorescent Pink
  [0, 131, 138], // Teal
];

// ── Component ─────────────────────────────────────────────────────────────────
// Vertical strokes mapped to the 24h timeline fill the card as a canvas texture.
// Stroke density scales with total time spent; colors use the RISO palette.
// Text floats over a semi-transparent paper overlay. Fills available space.

export function PortraitCard({
  domain,
  totalTimeMs,
  hourBuckets,
  cursorDistancePx,
  dateRange,
  uniquePageCount,
}: PortraitCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isLoading = totalTimeMs === null;
  const weights = normalizeHourBuckets(hourBuckets);
  const heroText = formatDuration(totalTimeMs ?? 0);
  const dateLabel = dateRange
    ? formatDateRange(dateRange.oldest, dateRange.newest)
    : null;
  const distanceLabel =
    cursorDistancePx > 0 ? formatDistance(cursorDistancePx) : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.offsetWidth || 300;
    const H = canvas.offsetHeight || 180;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#f5f0e8";
    ctx.fillRect(0, 0, W, H);

    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };

    // Scale stroke count with total time: ~15 strokes per minute, max 2000
    // No minimum floor — a nearly empty portrait should look nearly empty
    const totalMinutes = totalTimeMs ? totalTimeMs / 60_000 : 0;
    const strokeCount = Math.min(2000, Math.round(totalMinutes * 15));

    if (strokeCount === 0) return;

    // Build CDF from hour weights — only active hours receive strokes
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight === 0) return;
    const cdf: number[] = [];
    let acc = 0;
    for (const w of weights) {
      acc += w / totalWeight;
      cdf.push(acc);
    }
    const sampleHour = () => {
      const u = rand();
      for (let h = 0; h < 24; h++) if (u < cdf[h]) return h;
      return 23;
    };

    // Count how many distinct active hours there are — fewer active hours = wider jitter
    // so strokes don't pile into a single column
    const activeHours = weights.filter((w) => w > 0).length;
    const jitterW = activeHours <= 2 ? W / 2 : W / 4;

    for (let i = 0; i < strokeCount; i++) {
      const hour = sampleHour();
      const w = weights[hour];
      const [cr, cg, cb] = CANVAS_PALETTE[(hour + i) % CANVAS_PALETTE.length];
      const cx = ((hour + 0.5) / 24) * W + (rand() - 0.5) * jitterW;
      const sw = 0.5 + rand() * (W / 24) * 0.4;
      const sh = H * (0.3 + rand() * 0.7);
      // Base opacity is low; scales gently with hour weight
      const opacity = 0.015 + w * 0.06 + rand() * 0.02;
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${opacity.toFixed(3)})`;
      ctx.fillRect(cx - sw / 2, 0, sw, sh);
    }
  }, [weights.join(","), totalTimeMs]);

  const TEXT = "#3d3833";
  const TEXT_MUTED = "rgba(61,56,51,0.55)";
  const TEXT_FAINT = "rgba(61,56,51,0.35)";
  const BORDER = "rgba(61,56,51,0.2)";

  if (isLoading) {
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "#f5f0e8",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "11px",
          color: "rgba(61,56,51,0.4)",
          fontFamily: "'Martian Mono', monospace",
        }}
      >
        loading...
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas
        ref={canvasRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(250,247,242,0.72)",
        }}
      />
      <div
        style={{
          position: "relative",
          padding: "14px 14px 12px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          fontFamily: "'Atkinson Hyperlegible', sans-serif",
          color: TEXT,
        }}
      >
        {domain && (
          <div
            style={{
              fontSize: "9px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: TEXT_MUTED,
              marginBottom: "8px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {domain}
          </div>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "5px",
            flex: 1,
          }}
        >
          <div
            style={{
              fontFamily: "'Lora', Georgia, serif",
              fontSize: "32px",
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: TEXT,
            }}
          >
            {heroText}
          </div>
          <div
            style={{
              fontSize: "9px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: TEXT_MUTED,
            }}
          >
            spent
          </div>
        </div>
        <div
          style={{
            borderTop: `1px solid ${BORDER}`,
            paddingTop: "10px",
            display: "flex",
            gap: "14px",
            alignItems: "flex-end",
          }}
        >
          {distanceLabel && (
            <div>
              <div
                style={{
                  fontFamily: "'Martian Mono', monospace",
                  fontSize: "11px",
                  fontWeight: 500,
                  color: TEXT,
                }}
              >
                {distanceLabel}
              </div>
              <div
                style={{
                  fontSize: "8px",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: TEXT_MUTED,
                  marginTop: "2px",
                }}
              >
                moved
              </div>
            </div>
          )}
          <div>
            <div
              style={{
                fontFamily: "'Martian Mono', monospace",
                fontSize: "11px",
                fontWeight: 500,
                color: TEXT,
              }}
            >
              {uniquePageCount}
            </div>
            <div
              style={{
                fontSize: "8px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: TEXT_MUTED,
                marginTop: "2px",
              }}
            >
              pages
            </div>
          </div>
          {dateLabel && (
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div
                style={{
                  fontFamily: "'Source Serif 4', Georgia, serif",
                  fontStyle: "italic",
                  fontWeight: 400,
                  fontSize: "11px",
                  color: ACCENT_TEAL,
                }}
              >
                we were online
              </div>
              <div
                style={{
                  fontFamily: "'Martian Mono', monospace",
                  fontSize: "8px",
                  color: TEXT_FAINT,
                  marginTop: "2px",
                }}
              >
                {dateLabel}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
