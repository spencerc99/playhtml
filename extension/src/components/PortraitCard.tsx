// ABOUTME: Portrait card component showing browsing stats for a domain
// ABOUTME: Supports full (dark poster) and compact (translucent overlay) layouts

import React, { useEffect, useRef } from "react";
import type { ScreenTimeSession } from "../storage/LocalEventStore";

export interface PortraitCardProps {
  domain: string;
  totalTimeMs: number | null;
  /** Sessions with focusTs timestamps — used to derive time-of-day rhythm */
  sessions: ScreenTimeSession[];
  /** Total cursor distance in pixels (sum of Euclidean distances between samples) */
  cursorDistancePx: number;
  dateRange: { oldest: string; newest: string } | null;
  uniquePageCount: number;
  /** Compact translucent overlay mode for embedding over animations */
  compact?: boolean;
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
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const startMonth = monthNames[start.getMonth()];
  const endMonth = monthNames[end.getMonth()];
  const startYear = start.getFullYear();
  const endYear = end.getFullYear();
  if (startYear === endYear && start.getMonth() === end.getMonth()) return `${endMonth} ${endYear}`;
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
 * Build a 24-slot hour weight array (index 0 = midnight, 23 = 11pm).
 * Each slot holds total ms spent in that hour, normalized to [0, 1].
 */
function buildHourWeights(sessions: ScreenTimeSession[]): number[] {
  const buckets = new Array(24).fill(0);
  for (const s of sessions) {
    const hour = new Date(s.focusTs).getHours();
    buckets[hour] += s.durationMs;
  }
  const max = Math.max(...buckets, 1);
  return buckets.map((v) => v / max);
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const CREAM = "#faf7f2";
const CREAM_MUTED = "rgba(250, 247, 242, 0.6)";
const CREAM_FAINT = "rgba(250, 247, 242, 0.25)";
const ACCENT_TEAL = "#4a9a8a";

// ── Compact (overlay) styles ──────────────────────────────────────────────────

const compactStyles = {
  card: {
    position: "absolute" as const,
    inset: 0,
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "flex-start",
    padding: "16px 16px 44px",
    background: "rgba(61, 56, 51, 0.55)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    fontFamily: "'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, sans-serif",
    color: CREAM,
  },
  domain: {
    fontSize: "11px",
    fontWeight: 600,
    color: "rgba(250, 247, 242, 0.7)",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    marginBottom: "6px",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  heroRow: {
    display: "flex",
    alignItems: "baseline",
    gap: "6px",
    marginBottom: "10px",
  },
  heroNumber: {
    fontFamily: "'Lora', Georgia, serif",
    fontSize: "32px",
    fontWeight: 700,
    color: CREAM,
    lineHeight: 1,
    letterSpacing: "-0.02em",
  },
  heroLabel: {
    fontSize: "11px",
    color: "rgba(250, 247, 242, 0.6)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
  statRow: {
    display: "flex",
    gap: "16px",
  },
  statItem: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "1px",
  },
  statNumber: {
    fontFamily: "'Martian Mono', 'Space Mono', 'Courier New', monospace",
    fontSize: "14px",
    fontWeight: 600,
    color: CREAM,
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: "9px",
    color: "rgba(250, 247, 242, 0.5)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
  },
} as const;

// ── Time-of-day rhythm bar ────────────────────────────────────────────────────

function RhythmBar({ sessions }: { sessions: ScreenTimeSession[] }) {
  const weights = buildHourWeights(sessions);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: "1.5px",
        height: "24px",
        marginBottom: "12px",
      }}
    >
      {weights.map((w, i) => (
        <div
          key={i}
          title={`${i}:00 — ${Math.round(w * 100)}%`}
          style={{
            flex: 1,
            height: `${Math.max(2, Math.round(w * 24))}px`,
            background: w > 0.05
              ? `rgba(250, 247, 242, ${0.12 + w * 0.75})`
              : "rgba(250, 247, 242, 0.06)",
            borderRadius: "1px",
          }}
        />
      ))}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PortraitCard({
  domain,
  totalTimeMs,
  sessions,
  cursorDistancePx,
  dateRange,
  uniquePageCount,
  compact = false,
}: PortraitCardProps) {
  const heroText = totalTimeMs !== null ? formatDuration(totalTimeMs) : "\u2014";
  const dateLabel = dateRange ? formatDateRange(dateRange.oldest, dateRange.newest) : null;
  const distanceLabel = cursorDistancePx > 0 ? formatDistance(cursorDistancePx) : null;

  if (compact) {
    return (
      <div style={compactStyles.card}>
        <div style={compactStyles.domain}>{domain}</div>
        <div style={compactStyles.heroRow}>
          <div style={compactStyles.heroNumber}>{heroText}</div>
          <div style={compactStyles.heroLabel}>time spent</div>
        </div>
        <div style={compactStyles.statRow}>
          {distanceLabel && (
            <div style={compactStyles.statItem}>
              <div style={compactStyles.statNumber}>{distanceLabel}</div>
              <div style={compactStyles.statLabel}>moved</div>
            </div>
          )}
          <div style={compactStyles.statItem}>
            <div style={compactStyles.statNumber}>{uniquePageCount}</div>
            <div style={compactStyles.statLabel}>pages</div>
          </div>
          {dateLabel && (
            <div style={compactStyles.statItem}>
              <div style={compactStyles.statNumber}>{dateLabel}</div>
              <div style={compactStyles.statLabel}>since</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-start",
        padding: "14px 16px 12px",
        background: "rgba(26, 23, 20, 0.82)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        borderRadius: "10px",
        fontFamily: "'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, sans-serif",
        color: CREAM,
        minWidth: "220px",
        maxWidth: "320px",
        boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
        border: "1px solid rgba(250, 247, 242, 0.08)",
      }}
    >
      {/* Domain */}
      <div
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: CREAM_MUTED,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          marginBottom: "10px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {domain}
      </div>

      {/* Hero: screen time */}
      <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "14px" }}>
        <div
          style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: "36px",
            fontWeight: 700,
            color: CREAM,
            lineHeight: 1,
            letterSpacing: "-0.02em",
          }}
        >
          {heroText}
        </div>
        <div
          style={{
            fontSize: "10px",
            color: CREAM_MUTED,
            textTransform: "uppercase",
            letterSpacing: "0.1em",
          }}
        >
          spent
        </div>
      </div>

      {/* Time-of-day rhythm */}
      {sessions.length > 0 && <RhythmBar sessions={sessions} />}

      {/* Stats row */}
      <div style={{ display: "flex", gap: "20px" }}>
        {distanceLabel && (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <div
              style={{
                fontFamily: "'Martian Mono', monospace",
                fontSize: "13px",
                fontWeight: 600,
                color: CREAM,
                lineHeight: 1.2,
              }}
            >
              {distanceLabel}
            </div>
            <div
              style={{
                fontSize: "9px",
                color: CREAM_MUTED,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              moved
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          <div
            style={{
              fontFamily: "'Martian Mono', monospace",
              fontSize: "13px",
              fontWeight: 600,
              color: CREAM,
              lineHeight: 1.2,
            }}
          >
            {uniquePageCount}
          </div>
          <div
            style={{
              fontSize: "9px",
              color: CREAM_MUTED,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            pages
          </div>
        </div>

        {dateLabel && (
          <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginLeft: "auto" }}>
            <div
              style={{
                fontFamily: "'Martian Mono', monospace",
                fontSize: "11px",
                fontWeight: 600,
                color: CREAM_MUTED,
                lineHeight: 1.2,
              }}
            >
              {dateLabel}
            </div>
            <div
              style={{
                fontSize: "9px",
                color: CREAM_FAINT,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              since
            </div>
          </div>
        )}
      </div>

      {/* Wordmark */}
      <div
        style={{
          marginTop: "12px",
          paddingTop: "10px",
          borderTop: `1px solid ${CREAM_FAINT}`,
          fontSize: "11px",
          fontFamily: "'Source Serif 4', 'Lora', Georgia, serif",
          fontStyle: "italic",
          fontWeight: 200,
          color: ACCENT_TEAL,
          letterSpacing: "0.01em",
        }}
      >
        we were online
      </div>
    </div>
  );
}

// ── Direction A: Vertical texture card ────────────────────────────────────────
// Vertical strokes mapped to the 24h timeline fill the card as a canvas texture.
// Stroke density scales with total time spent; colors use the RISO palette.
// Text floats over a semi-transparent paper overlay. Fills available space.

// RISO-inspired colors as [r,g,b] for canvas rendering
const RISO_CANVAS_COLORS: [number, number, number][] = [
  [0, 120, 191],   // Blue
  [255, 102, 94],  // Bright Red
  [0, 169, 92],    // Green
  [255, 123, 75],  // Orange
  [146, 55, 141],  // Purple
  [0, 131, 138],   // Teal
];

export function PortraitCardDirectionA({
  domain,
  totalTimeMs,
  sessions,
  cursorDistancePx,
  dateRange,
  uniquePageCount,
}: PortraitCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const weights = buildHourWeights(sessions);
  const heroText = totalTimeMs !== null ? formatDuration(totalTimeMs) : "\u2014";
  const dateLabel = dateRange ? formatDateRange(dateRange.oldest, dateRange.newest) : null;
  const distanceLabel = cursorDistancePx > 0 ? formatDistance(cursorDistancePx) : null;

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
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

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
    for (const w of weights) { acc += w / totalWeight; cdf.push(acc); }
    const sampleHour = () => { const u = rand(); for (let h = 0; h < 24; h++) if (u < cdf[h]) return h; return 23; };

    // Count how many distinct active hours there are — fewer active hours = wider jitter
    // so strokes don't pile into a single column
    const activeHours = weights.filter((w) => w > 0).length;
    const jitterW = activeHours <= 2 ? W / 2 : W / 4;

    for (let i = 0; i < strokeCount; i++) {
      const hour = sampleHour();
      const w = weights[hour];
      const [cr, cg, cb] = RISO_CANVAS_COLORS[(hour + i) % RISO_CANVAS_COLORS.length];
      const cx = ((hour + 0.5) / 24) * W + (rand() - 0.5) * jitterW;
      const sw = 0.5 + rand() * (W / 24) * 0.4;
      const sh = H * (0.3 + rand() * 0.7);
      // Base opacity is low; scales gently with hour weight
      const opacity = 0.015 + w * 0.06 + rand() * 0.02;
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${opacity.toFixed(3)})`;
      ctx.fillRect(cx - sw / 2, 0, sw, sh);
    }
  }, [weights.join(","), totalTimeMs]);

  const DA_TEXT = "#3d3833";
  const DA_TEXT_MUTED = "rgba(61,56,51,0.55)";
  const DA_TEXT_FAINT = "rgba(61,56,51,0.35)";
  const DA_BORDER = "rgba(61,56,51,0.2)";

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      <div style={{ position: "absolute", inset: 0, background: "rgba(250,247,242,0.72)" }} />
      <div style={{
        position: "relative",
        padding: "14px 14px 12px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
        fontFamily: "'Atkinson Hyperlegible', sans-serif",
        color: DA_TEXT,
      }}>
        <div style={{ fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase", color: DA_TEXT_MUTED, marginBottom: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {domain}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "5px", flex: 1 }}>
          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: "32px", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", color: DA_TEXT }}>
            {heroText}
          </div>
          <div style={{ fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase", color: DA_TEXT_MUTED }}>spent</div>
        </div>
        <div style={{ borderTop: `1px solid ${DA_BORDER}`, paddingTop: "10px", display: "flex", gap: "14px", alignItems: "flex-end" }}>
          {distanceLabel && (
            <div>
              <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "11px", fontWeight: 500, color: DA_TEXT }}>{distanceLabel}</div>
              <div style={{ fontSize: "8px", letterSpacing: "0.08em", textTransform: "uppercase", color: DA_TEXT_MUTED, marginTop: "2px" }}>moved</div>
            </div>
          )}
          <div>
            <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "11px", fontWeight: 500, color: DA_TEXT }}>{uniquePageCount}</div>
            <div style={{ fontSize: "8px", letterSpacing: "0.08em", textTransform: "uppercase", color: DA_TEXT_MUTED, marginTop: "2px" }}>pages</div>
          </div>
          {dateLabel && (
            <div style={{ marginLeft: "auto", textAlign: "right" }}>
              <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontStyle: "italic", fontWeight: 400, fontSize: "11px", color: ACCENT_TEAL }}>we were online</div>
              <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "8px", color: DA_TEXT_FAINT, marginTop: "2px" }}>{dateLabel}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
