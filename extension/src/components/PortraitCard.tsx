// ABOUTME: Portrait card component showing browsing stats for a domain
// ABOUTME: Canvas-textured card with vertical strokes mapped to 24h activity rhythm

import React, { useEffect, useRef } from "react";
import { risoInkColor } from "../utils/risoInk";

// ── PortraitCard data contract ───────────────────────────────────────────────
//
// This component has exactly two visual states:
//
//   1. LOADING  — totalTimeMs === null
//      Shows a centered "loading..." placeholder. Use this only while the
//      background fetch is genuinely in flight. Once data arrives, always pass
//      a number (even 0) so the card renders.
//
//   2. READY    — totalTimeMs is a number (including 0)
//      Renders the full card: canvas texture, hero duration, distance, pages,
//      and date range. Zero is valid — it means "we have data, but no
//      completed focus/blur session pairs were recorded."
//
// There is no "error" or "empty" state inside PortraitCard. The parent is
// responsible for showing "no data" when there are no stats at all (e.g. by
// checking whether stats are null before mounting PortraitCard).
//
// Pitfall: passing totalTimeMs as null when the aggregate has zero sessions
// causes perpetual loading. Always pass 0 when data exists but has no
// completed focus/blur session pairs.
//
export interface PortraitCardProps {
  domain: string;
  /** Optional label for portraits whose scope is broader than one domain. */
  scopeLabel?: string;
  /** Total screen time in ms. null = still loading; 0 = no sessions recorded. */
  totalTimeMs: number | null;
  /** Pre-computed total ms per hour-of-day (index 0 = midnight, 23 = 11pm) */
  hourBuckets: number[];
  /** Total cursor distance in pixels (sum of Euclidean distances between samples) */
  cursorDistancePx: number;
  dateRange: { oldest: string; newest: string } | null;
  /** Exact period copy for contexts that use a completed calendar range. */
  dateLabel?: string;
  /** Person-owned anchor color for signatures and portrait details. */
  accentColor?: string;
  /** Omit for page-level stats where the count is always 1 */
  uniquePageCount?: number;
  eventCounts?: { cursor: number; keyboard: number; viewport: number };
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0 min";
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

export function getPortraitStrokeCount(
  totalTimeMs: number,
  width: number,
  height: number,
): number {
  const totalMinutes = totalTimeMs / 60_000;
  const areaScale = Math.max(1, (width * height) / (300 * 180));
  return Math.min(
    Math.round(2_000 * areaScale),
    Math.round(totalMinutes * 15 * areaScale),
  );
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const ACCENT_TEAL = "#4a9a8a";

// ── Component ─────────────────────────────────────────────────────────────────
// Vertical strokes mapped to the 24h timeline fill the card as a canvas texture.
// Stroke density scales with browsing time and uses varied muted RISO inks.
// Text floats over a semi-transparent paper overlay. Fills available space.

export function PortraitCard({
  domain,
  scopeLabel,
  totalTimeMs,
  hourBuckets,
  cursorDistancePx,
  dateRange,
  dateLabel: suppliedDateLabel,
  accentColor = ACCENT_TEAL,
  uniquePageCount,
}: PortraitCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const isLoading = totalTimeMs === null;
  const weights = normalizeHourBuckets(hourBuckets);
  const heroText = formatDuration(totalTimeMs ?? 0);
  const dateLabel =
    suppliedDateLabel ??
    (dateRange ? formatDateRange(dateRange.oldest, dateRange.newest) : null);
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

    // Scale stroke count with both total time and canvas area so the same
    // portrait retains its visual density in compact overlays and wide cards.
    // No minimum floor — a nearly empty portrait should look nearly empty.
    const strokeCount = getPortraitStrokeCount(totalTimeMs ?? 0, W, H);

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
      const color = risoInkColor(hour * 131 + i);
      const cx = ((hour + 0.5) / 24) * W + (rand() - 0.5) * jitterW;
      const sw = 0.5 + rand() * (W / 24) * 0.4;
      const sh = H * (0.3 + rand() * 0.7);
      // Base opacity is low; scales gently with hour weight
      const opacity = 0.015 + w * 0.06 + rand() * 0.02;
      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.fillRect(cx - sw / 2, 0, sw, sh);
    }
    ctx.globalAlpha = 1;
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
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        containerType: "inline-size",
      }}
    >
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
          padding: "clamp(14px, 4cqw, 28px)",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          fontFamily: "'Atkinson Hyperlegible', sans-serif",
          color: TEXT,
        }}
      >
        {(scopeLabel || domain) && (
          <div
            style={{
              fontSize: "clamp(10px, 1.65cqw, 12px)",
              fontWeight: 500,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: TEXT_MUTED,
              marginBottom: "10px",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {scopeLabel || domain}
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
              fontSize: "clamp(32px, 8cqw, 56px)",
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
              fontSize: "clamp(10px, 1.8cqw, 13px)",
              fontWeight: 500,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: TEXT_MUTED,
            }}
          >
            browsing
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
          {uniquePageCount != null && (
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
          )}
          {(dateLabel || scopeLabel) && (
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div
                style={{
                  fontFamily: "'Source Serif 4', Georgia, serif",
                  fontStyle: "italic",
                  fontWeight: 400,
                  fontSize: "11px",
                  color: accentColor,
                }}
              >
                we were online
              </div>
              {dateLabel && (
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
