// ABOUTME: Preview page for PortraitCard design directions
// ABOUTME: Shows distinct visual variants with mock browsing data for evaluation

import "./components-preview.scss";
import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

// ── Mock data ─────────────────────────────────────────────────────────────────

type Session = { url: string; focusTs: number; blurTs: number; durationMs: number };

interface MockData {
  sessions: Session[];
  totalMs: number;
  cursorDistancePx: number;
  uniquePages: number;
  domain: string;
  dateRange: string;
}

// Weighted hour profiles: probability mass per hour of day
const HOUR_PROFILES: Record<string, number[]> = {
  "night owl":     [0.8,0.9,0.7,0.4,0.1,0.0,0.0,0.1,0.2,0.3,0.3,0.3, 0.2,0.2,0.2,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,0.9],
  "early bird":    [0.1,0.0,0.0,0.0,0.3,0.7,0.9,0.8,0.7,0.6,0.5,0.4, 0.4,0.4,0.3,0.2,0.2,0.2,0.2,0.2,0.2,0.1,0.1,0.1],
  "9-to-5":        [0.0,0.0,0.0,0.0,0.0,0.1,0.2,0.4,0.6,0.9,0.9,0.8, 0.7,0.9,0.9,0.8,0.6,0.3,0.2,0.2,0.1,0.1,0.0,0.0],
  "evening binge": [0.1,0.1,0.1,0.0,0.0,0.0,0.1,0.2,0.3,0.3,0.3,0.3, 0.3,0.3,0.3,0.4,0.5,0.6,0.8,0.9,0.9,0.8,0.7,0.4],
  "scattered":     [0.3,0.2,0.1,0.1,0.1,0.2,0.4,0.5,0.5,0.4,0.5,0.5, 0.4,0.5,0.5,0.4,0.4,0.5,0.5,0.4,0.4,0.4,0.3,0.3],
};

const PROFILE_NAMES = Object.keys(HOUR_PROFILES);

function generateMockData(): MockData {
  const profileName = PROFILE_NAMES[Math.floor(Math.random() * PROFILE_NAMES.length)];
  const profile = HOUR_PROFILES[profileName];

  // Pick a random 2–5 week span ending around now
  const endDate = new Date();
  endDate.setDate(endDate.getDate() - Math.floor(Math.random() * 7));
  const spanDays = 14 + Math.floor(Math.random() * 21);
  const startDate = new Date(endDate.getTime() - spanDays * 86400_000);

  const sessions: Session[] = [];
  const sessionCount = 6 + Math.floor(Math.random() * 14);

  for (let i = 0; i < sessionCount; i++) {
    // Pick a day in the range
    const dayOffset = Math.floor(Math.random() * spanDays);
    const day = new Date(startDate.getTime() + dayOffset * 86400_000);

    // Sample an hour weighted by the profile
    const r = Math.random();
    let cumul = 0;
    const total = profile.reduce((s, v) => s + v, 0);
    let hour = 0;
    for (let h = 0; h < 24; h++) {
      cumul += profile[h] / total;
      if (r < cumul) { hour = h; break; }
    }

    const minute = Math.floor(Math.random() * 60);
    const focusTs = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).getTime();
    const durationMs = (5 + Math.floor(Math.random() * 110)) * 60 * 1000;
    const blurTs = focusTs + durationMs;

    sessions.push({ url: `https://example.com/page-${i}`, focusTs, blurTs, durationMs });
  }

  sessions.sort((a, b) => a.focusTs - b.focusTs);

  const totalMs = sessions.reduce((s, x) => s + x.durationMs, 0);
  const cursorDistancePx = 100_000 + Math.floor(Math.random() * 900_000);
  const uniquePages = 5 + Math.floor(Math.random() * 60);

  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const oldest = new Date(sessions[0].focusTs);
  const newest = new Date(sessions[sessions.length - 1].focusTs);
  const dateRange = oldest.getMonth() === newest.getMonth()
    ? `${fmt(oldest)}–${newest.getDate()}, ${newest.getFullYear()}`
    : `${fmt(oldest)} – ${fmt(newest)}, ${newest.getFullYear()}`;

  return { sessions, totalMs, cursorDistancePx, uniquePages, domain: "en.wikipedia.org", dateRange, };
}

const INITIAL_MOCK = generateMockData();

// Deterministic mock data for density scaling comparison
function generateFixedMockData(totalMs: number, sessionCount: number, hourSpread: number): MockData {
  const baseTs = new Date(2026, 1, 1, 10, 0).getTime(); // Feb 1 2026 10:00
  const sessions: Session[] = [];
  const avgDuration = totalMs / sessionCount;

  for (let i = 0; i < sessionCount; i++) {
    // Spread sessions across `hourSpread` distinct hours deterministically
    const hourOffset = Math.floor((i / sessionCount) * hourSpread);
    const focusTs = baseTs + hourOffset * 3600_000 + i * 120_000; // stagger within hours
    const durationMs = Math.round(avgDuration * (0.6 + (i % 3) * 0.3));
    sessions.push({
      url: `https://en.wikipedia.org/wiki/Page_${i}`,
      focusTs,
      blurTs: focusTs + durationMs,
      durationMs,
    });
  }

  sessions.sort((a, b) => a.focusTs - b.focusTs);

  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const oldest = new Date(sessions[0].focusTs);
  const newest = new Date(sessions[sessions.length - 1].focusTs);
  const dateRange = oldest.getMonth() === newest.getMonth()
    ? `${fmt(oldest)}\u2013${newest.getDate()}, ${newest.getFullYear()}`
    : `${fmt(oldest)} \u2013 ${fmt(newest)}, ${newest.getFullYear()}`;

  return {
    sessions,
    totalMs,
    cursorDistancePx: Math.round(totalMs * 0.8),
    uniquePages: sessionCount + 2,
    domain: "en.wikipedia.org",
    dateRange,
  };
}

const DENSITY_TIERS: { label: string; totalMs: number; sessionCount: number; hourSpread: number }[] = [
  { label: "3 min",  totalMs: 3 * 60_000,       sessionCount: 2,  hourSpread: 1  },
  { label: "4 hrs",  totalMs: 4 * 3600_000,     sessionCount: 7,  hourSpread: 4  },
  { label: "48 hrs", totalMs: 48 * 3600_000,    sessionCount: 24, hourSpread: 18 },
];

const DENSITY_DATA = DENSITY_TIERS.map(t => ({
  ...t,
  data: generateFixedMockData(t.totalMs, t.sessionCount, t.hourSpread),
}));

// ── Design tokens (matches extension popup palette) ───────────────────────────

const BG        = "#faf7f2";       // warm linen
const SURFACE   = "#f5f0e8";       // aged paper
const SURFACE_D = "#efe9df";       // hover/deeper surface
const TEXT      = "#3d3833";       // warm dark brown
const TEXT_MUTED = "#8a8279";
const TEXT_FAINT = "#b5aea5";
const BORDER    = "rgba(90,78,65,0.12)";
const BORDER_STRONG = "rgba(90,78,65,0.25)";
const TEAL      = "#4a9a8a";

// ── Shared helpers ────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

function formatDistance(px: number): string {
  const meters = (px * 0.311) / 1000;
  if (meters < 1) return `${Math.round(px * 0.311)} mm`;
  if (meters < 1000) return `${meters.toFixed(0)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function buildHourWeights(sessions: Session[]): number[] {
  const buckets = new Array(24).fill(0);
  for (const s of sessions) {
    buckets[new Date(s.focusTs).getHours()] += s.durationMs;
  }
  const max = Math.max(...buckets, 1);
  return buckets.map((v) => v / max);
}

// Map hour (0-23) to a perceptual lightness value (0=pitch dark, 1=bright day)
function hourLightness(h: number): number {
  // Midnight=0, 3am=0.05, dawn 5-6=0.3, morning 8-10=0.75, noon=1, dusk 18-19=0.5, 21=0.2
  const curve = [0.02,0.01,0.01,0.02,0.08,0.28,0.52,0.72,0.82,0.88,0.92,0.96,1.0,0.97,0.92,0.85,0.72,0.55,0.38,0.25,0.15,0.09,0.05,0.03];
  return curve[h] ?? 0;
}

// Color palette — one hue per hour band (8 colors cycling across 24h)
// rgb values matching RISO_COLORS HSL palette in eventUtils.ts
const RISO_RGB: [number, number, number][] = [
  [210, 51, 35],   // warm red
  [180, 148, 34],  // amber
  [92, 158, 46],   // moss green
  [39, 155, 130],  // teal
  [40, 110, 189],  // steel blue
  [80, 55, 189],   // violet
  [184, 48, 151],  // magenta
  [195, 115, 35],  // burnt orange
];

// Map an hour to a RISO color, preserving its luminance by scaling the RGB
// so the perceived brightness matches the monochrome value for that hour.
function risoStrokeRgb(hour: number, light: number, isDark: boolean): [number, number, number] {
  const [r, g, b] = RISO_RGB[hour % RISO_RGB.length];
  // Target luminance: dark hours stay dim, light hours stay bright
  const targetL = isDark
    ? 0.08 + (1 - light) * 0.22   // dim — heavier for night hours
    : 0.55 + light * 0.35;         // bright — washed out for daytime
  // Perceived luminance of the RISO color (rec. 709 coefficients)
  const perceivedL = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const scale = perceivedL > 0 ? (targetL / perceivedL) : 1;
  return [
    Math.min(255, Math.round(r * scale)),
    Math.min(255, Math.round(g * scale)),
    Math.min(255, Math.round(b * scale)),
  ];
}

// ── Generative layered-lines texture ─────────────────────────────────────────
// Draws many overlapping semi-transparent horizontal strokes across the canvas.
// Each stroke's x-position is biased toward hours with high activity weight,
// and its color (warm light vs cool dark) reflects the natural light of that hour.
// The result: a woven gradient — dense bright bands where you were active by day,
// dark compressed bands where you were active at night.

function useLayeredTexture(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  weights: number[],
  width: number,
  height: number,
  colorful: boolean,
  totalMs?: number,
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, width, height);

    let seed = 137;
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

    // Build CDF for activity-biased hour sampling (no minimum floor — empty hours get zero strokes)
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight === 0) return;
    const cdf: number[] = [];
    let acc = 0;
    for (const w of weights) { acc += w / totalWeight; cdf.push(acc); }
    const sampleHour = () => { const u = rand(); for (let h = 0; h < 24; h++) if (u < cdf[h]) return h; return 23; };

    const activeHours = weights.filter(w => w > 0).length;
    const jitterWidth = activeHours <= 2 ? width / 2 : width / 5;

    // Scale stroke count with time when totalMs is provided
    const totalMinutes = totalMs != null ? totalMs / 60_000 : undefined;
    const strokeCount = totalMinutes != null
      ? Math.min(2000, Math.round(totalMinutes * 15))
      : 2200;

    for (let i = 0; i < strokeCount; i++) {
      const hour = sampleHour();
      const light = hourLightness(hour);
      const w = weights[hour];

      const cx = ((hour + 0.5) / 24) * width + (rand() - 0.5) * jitterWidth;
      const sw = width * (0.08 + rand() * 0.5);
      const x0 = cx - sw / 2;
      const y = rand() * height;
      const lh = 1 + rand() * 3;

      const isDark = light < 0.35 || rand() > (light * 0.85);
      const opacity = isDark
        ? 0.015 + w * 0.06 + rand() * 0.02
        : 0.012 + rand() * 0.025;

      if (colorful) {
        const [r, g, b] = risoStrokeRgb(hour, light, isDark);
        ctx.fillStyle = `rgba(${r},${g},${b},${opacity.toFixed(3)})`;
      } else if (isDark) {
        const v = Math.round(50 + rand() * 30);
        ctx.fillStyle = `rgba(${v + 10},${v},${v - 8},${opacity.toFixed(3)})`;
      } else {
        ctx.fillStyle = `rgba(220,210,195,${opacity.toFixed(3)})`;
      }

      ctx.fillRect(x0, y, sw, lh);
    }
  }, [weights.join(","), width, height, colorful, totalMs]);
}

// ── Generative vertical-lines texture ────────────────────────────────────────
// Vertical strokes spanning the full card height, x-position mapped to the
// 24-hour timeline. Hour bands with high activity stack more strokes; light
// hours yield warm strokes, dark/night hours yield deep shadow strokes.

function useVerticalTexture(
  canvasRef: React.RefObject<HTMLCanvasElement>,
  weights: number[],
  width: number,
  height: number,
  colorful: boolean,
  totalMs?: number,
) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = SURFACE;
    ctx.fillRect(0, 0, width, height);

    let seed = 42;
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

    // Build CDF for activity-biased hour sampling (no minimum floor — empty hours get zero strokes)
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    if (totalWeight === 0) return;
    const cdf: number[] = [];
    let acc = 0;
    for (const w of weights) { acc += w / totalWeight; cdf.push(acc); }
    const sampleHour = () => { const u = rand(); for (let h = 0; h < 24; h++) if (u < cdf[h]) return h; return 23; };

    const activeHours = weights.filter(w => w > 0).length;
    const jitterWidth = activeHours <= 2 ? width / 2 : width / 4;

    // Scale stroke count with time when totalMs is provided
    const totalMinutes = totalMs != null ? totalMs / 60_000 : undefined;
    const strokeCount = totalMinutes != null
      ? Math.min(2000, Math.round(totalMinutes * 15))
      : 1800;

    for (let i = 0; i < strokeCount; i++) {
      const hour = sampleHour();
      const light = hourLightness(hour);
      const w = weights[hour];

      // X: spread across the full width — wide jitter so strokes bleed to edges
      const cx = ((hour + 0.5) / 24) * width + (rand() - 0.5) * jitterWidth;
      // Thin strokes — max ~half an hour-band wide
      const sw = 0.5 + rand() * (width / 24) * 0.4;
      const x0 = cx - sw / 2;
      // Y: always start from 0, vary how far down they reach
      const sh = height * (0.3 + rand() * 0.7);

      const isDark = light < 0.35 || rand() > (light * 0.85);
      // Keep individual strokes light so many can layer without muddying
      const opacity = isDark
        ? 0.015 + w * 0.06 + rand() * 0.02
        : 0.012 + rand() * 0.022;

      if (colorful) {
        const [r, g, b] = risoStrokeRgb(hour, light, isDark);
        ctx.fillStyle = `rgba(${r},${g},${b},${opacity.toFixed(3)})`;
      } else if (isDark) {
        const v = Math.round(50 + rand() * 30);
        ctx.fillStyle = `rgba(${v + 10},${v},${v - 8},${opacity.toFixed(3)})`;
      } else {
        ctx.fillStyle = `rgba(220,210,195,${opacity.toFixed(3)})`;
      }

      ctx.fillRect(x0, 0, sw, sh);
    }
  }, [weights.join(","), width, height, colorful, totalMs]);
}

// ── Variant C: Compact overlay ────────────────────────────────────────────────
// The original compact mode: translucent dark overlay with blur, sits on top of
// the movement animation. Shown here over a stand-in dark canvas.

function VariantC({ data }: { data: MockData; colorful: boolean }) {
  const heroText = formatDuration(data.totalMs);
  const distanceLabel = data.cursorDistancePx > 0 ? formatDistance(data.cursorDistancePx) : null;

  const sorted = [...data.sessions].sort((a, b) => a.focusTs - b.focusTs);
  const oldest = new Date(sorted[0].focusTs);
  const newest = new Date(sorted[sorted.length - 1].focusTs);
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const dateLabel = oldest.getMonth() === newest.getMonth() && oldest.getFullYear() === newest.getFullYear()
    ? `${monthNames[newest.getMonth()]} ${newest.getFullYear()}`
    : oldest.getFullYear() === newest.getFullYear()
      ? `${monthNames[oldest.getMonth()]}\u2013${monthNames[newest.getMonth()]} ${newest.getFullYear()}`
      : `${monthNames[oldest.getMonth()]} ${oldest.getFullYear()}\u2013${monthNames[newest.getMonth()]} ${newest.getFullYear()}`;

  return (
    <div style={{
      position: "relative",
      width: "300px",
      height: "200px",
      borderRadius: "10px",
      overflow: "hidden",
      background: "#1a1410",
      border: "1px solid rgba(250,247,242,0.08)",
      boxShadow: "0 4px 24px rgba(0,0,0,0.4)",
    }}>
      {/* Stand-in for movement animation */}
      <svg style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.35 }} viewBox="0 0 300 200">
        <path d="M10,100 Q60,40 110,100 T210,100 T300,80" fill="none" stroke="#4a9a8a" strokeWidth="1.5" />
        <path d="M0,140 Q80,80 150,130 T300,110" fill="none" stroke="#c4724e" strokeWidth="1" />
        <path d="M20,60 Q100,110 180,55 T300,70" fill="none" stroke="#5b8db8" strokeWidth="1" />
        <circle cx="110" cy="100" r="4" fill="none" stroke="#4a9a8a" strokeWidth="1" opacity="0.6" />
        <circle cx="210" cy="100" r="3" fill="none" stroke="#c4724e" strokeWidth="1" opacity="0.5" />
      </svg>
      {/* Compact overlay */}
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", justifyContent: "flex-start",
        padding: "16px 16px 44px",
        background: "rgba(61, 56, 51, 0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        fontFamily: "'Atkinson Hyperlegible', sans-serif",
        color: "#faf7f2",
      }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "rgba(250,247,242,0.7)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {data.domain}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "6px", marginBottom: "10px" }}>
          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: "32px", fontWeight: 700, color: "#faf7f2", lineHeight: 1, letterSpacing: "-0.02em" }}>
            {heroText}
          </div>
          <div style={{ fontSize: "11px", color: "rgba(250,247,242,0.6)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            time spent
          </div>
        </div>
        <div style={{ display: "flex", gap: "16px" }}>
          {distanceLabel && (
            <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
              <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "14px", fontWeight: 600, color: "#faf7f2", lineHeight: 1.2 }}>{distanceLabel}</div>
              <div style={{ fontSize: "9px", color: "rgba(250,247,242,0.5)", textTransform: "uppercase", letterSpacing: "0.08em" }}>moved</div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "14px", fontWeight: 600, color: "#faf7f2", lineHeight: 1.2 }}>{data.uniquePages}</div>
            <div style={{ fontSize: "9px", color: "rgba(250,247,242,0.5)", textTransform: "uppercase", letterSpacing: "0.08em" }}>pages</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "1px" }}>
            <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "14px", fontWeight: 600, color: "#faf7f2", lineHeight: 1.2 }}>{dateLabel}</div>
            <div style={{ fontSize: "9px", color: "rgba(250,247,242,0.5)", textTransform: "uppercase", letterSpacing: "0.08em" }}>since</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Variant A: Minimal + generative texture ───────────────────────────────────

function VariantA({ data, colorful }: { data: MockData; colorful: boolean }) {
  const weights = buildHourWeights(data.sessions);
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  useVerticalTexture(canvasRef, weights, 300, 200, colorful, data.totalMs);

  return (
    <div style={{
      position: "relative",
      borderRadius: "4px",
      overflow: "hidden",
      maxWidth: "300px",
      fontFamily: "'Atkinson Hyperlegible', sans-serif",
      color: TEXT,
      border: `1px solid ${BORDER_STRONG}`,
      boxShadow: "0 2px 10px rgba(90,78,65,0.08)",
    }}>
      {/* Generative texture fills the whole card */}
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      {/* Overlay — heavier than other variants so text reads over the texture */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(250,247,242,0.72)" }} />

      <div style={{ position: "relative", padding: "28px 24px 22px" }}>
        <div style={{ fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", color: TEXT_MUTED, marginBottom: "20px" }}>
          {data.domain}
        </div>

        <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: "56px", fontWeight: 700, lineHeight: 0.9, letterSpacing: "-0.03em", color: TEXT, marginBottom: "6px" }}>
          {formatDuration(data.totalMs)}
        </div>
        <div style={{ fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", color: TEXT_MUTED, marginBottom: "28px" }}>
          time spent
        </div>

        <div style={{ borderTop: `1px solid ${BORDER_STRONG}`, marginBottom: "18px" }} />

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "18px", fontWeight: 500, color: TEXT }}>
              {formatDistance(data.cursorDistancePx)}
            </div>
            <div style={{ fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase", color: TEXT_MUTED, marginTop: "3px" }}>moved</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "18px", fontWeight: 500, color: TEXT }}>
              {data.uniquePages}
            </div>
            <div style={{ fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase", color: TEXT_MUTED, marginTop: "3px" }}>pages</div>
          </div>
        </div>

        <div style={{ marginTop: "22px", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ fontSize: "10px", color: TEXT_MUTED, fontFamily: "'Martian Mono', monospace" }}>
            {data.dateRange}
          </div>
          <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontStyle: "italic", fontWeight: 400, fontSize: "12px", color: TEAL }}>
            we were online
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Variant D: Oversize type poster ──────────────────────────────────────────
// One enormous number bleeds off the card. Stats are secondary captions.
// Feels like a concert poster or sports scoreboard — immediate, visceral.
// The noise texture is the background but barely visible — pure atmosphere.

function VariantD({ data, colorful }: { data: MockData; colorful: boolean }) {
  const weights = buildHourWeights(data.sessions);
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  useLayeredTexture(canvasRef, weights, 300, 380, colorful, data.totalMs);

  const [hours, mins] = (() => {
    const h = Math.floor(data.totalMs / 3600000);
    const m = Math.floor((data.totalMs % 3600000) / 60000);
    return [h, m];
  })();

  return (
    <div style={{
      position: "relative",
      borderRadius: "6px",
      overflow: "hidden",
      maxWidth: "300px",
      minHeight: "380px",
      fontFamily: "'Atkinson Hyperlegible', sans-serif",
      border: `1px solid ${BORDER_STRONG}`,
      boxShadow: "0 2px 10px rgba(90,78,65,0.08)",
    }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
      {/* Light overlay — texture shows through as subtle paper grain */}
      <div style={{ position: "absolute", inset: 0, background: "rgba(250,247,242,0.72)" }} />

      <div style={{ position: "relative", padding: "22px 20px 24px", height: "100%", display: "flex", flexDirection: "column" }}>
        {/* Domain small, top */}
        <div style={{ fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: TEXT_MUTED, marginBottom: "8px" }}>
          {data.domain}
        </div>

        {/* Giant hour number — crops off right edge intentionally */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", overflow: "hidden" }}>
          <div style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: "148px",
            fontWeight: 700,
            lineHeight: 0.82,
            letterSpacing: "-0.04em",
            color: TEXT,
            marginLeft: "-4px",
            whiteSpace: "nowrap",
          }}>
            {hours}
          </div>
          <div style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: "148px",
            fontWeight: 700,
            lineHeight: 0.82,
            letterSpacing: "-0.04em",
            color: "rgba(61,56,51,0.15)",
            marginLeft: "-4px",
            whiteSpace: "nowrap",
          }}>
            {String(mins).padStart(2, "0")}
          </div>
        </div>

        {/* Unit label */}
        <div style={{ marginTop: "12px", marginBottom: "18px" }}>
          <span style={{ fontSize: "11px", letterSpacing: "0.16em", textTransform: "uppercase", color: TEXT_MUTED }}>hours · minutes</span>
        </div>

        {/* Bottom strip — small stats in a row */}
        <div style={{
          borderTop: `1px solid ${BORDER_STRONG}`,
          paddingTop: "14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}>
          <div>
            <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "12px", color: TEXT }}>
              {formatDistance(data.cursorDistancePx)}
            </div>
            <div style={{ fontSize: "8px", letterSpacing: "0.1em", textTransform: "uppercase", color: TEXT_MUTED, marginTop: "2px" }}>moved</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "12px", color: TEXT }}>
              {data.uniquePages} pg
            </div>
            <div style={{ fontSize: "8px", letterSpacing: "0.1em", textTransform: "uppercase", color: TEXT_MUTED, marginTop: "2px" }}>visited</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontStyle: "italic", fontWeight: 400, fontSize: "12px", color: TEAL }}>
              we were online
            </div>
            <div style={{ fontSize: "8px", letterSpacing: "0.07em", color: TEXT_MUTED, marginTop: "2px" }}>{data.dateRange}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Variant E: Film strip / data receipt ──────────────────────────────────────
// Tall narrow card, monospaced throughout, like a receipt or cassette J-card.
// The noise texture runs as a full-bleed side column.
// Screenshottable because it's portrait-oriented and dense with data.

function VariantE({ data, colorful }: { data: MockData; colorful: boolean }) {
  const weights = buildHourWeights(data.sessions);
  const noiseRef = useRef<HTMLCanvasElement>(null!);
  useLayeredTexture(noiseRef, weights, 52, 320, colorful, data.totalMs);

  const peakHour = weights.indexOf(Math.max(...weights));
  const peakLabel = peakHour < 5 ? "3am" : peakHour < 9 ? "dawn" : peakHour < 13 ? "morning" : peakHour < 17 ? "afternoon" : peakHour < 21 ? "evening" : "midnight";

  return (
    <div style={{
      display: "flex",
      maxWidth: "300px",
      background: BG,
      borderRadius: "6px",
      overflow: "hidden",
      border: `1px solid ${BORDER_STRONG}`,
      fontFamily: "'Martian Mono', monospace",
      color: TEXT,
      boxShadow: "0 2px 10px rgba(90,78,65,0.08)",
    }}>
      {/* Left: texture column */}
      <div style={{ position: "relative", width: "52px", flexShrink: 0 }}>
        <canvas ref={noiseRef} style={{ display: "block", width: "52px", height: "100%" }} />
        {/* Subtle right edge fade into bg */}
        <div style={{ position: "absolute", inset: 0, background: `linear-gradient(to right, transparent 60%, ${BG})` }} />
      </div>

      {/* Right: all the data */}
      <div style={{ flex: 1, padding: "20px 18px 20px 12px" }}>
        {/* Domain */}
        <div style={{ fontSize: "9px", color: TEAL, marginBottom: "16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {data.domain}
        </div>

        {/* Main stat: time */}
        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "8px", color: TEXT_MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: "3px" }}>TIME SPENT</div>
          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: "38px", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.02em", color: TEXT }}>
            {formatDuration(data.totalMs)}
          </div>
        </div>

        {/* Data rows — receipt-style */}
        {[
          ["DISTANCE", formatDistance(data.cursorDistancePx)],
          ["PAGES", String(data.uniquePages)],
          ["PEAK HR", peakLabel],
          ["FIRST", new Date(data.sessions[0].focusTs).toLocaleDateString("en-US", { month: "short", day: "numeric" })],
          ["LAST", new Date(data.sessions[data.sessions.length - 1].focusTs).toLocaleDateString("en-US", { month: "short", day: "numeric" })],
        ].map(([label, value]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", marginBottom: "7px", borderBottom: `1px dashed ${BORDER}`, paddingBottom: "7px" }}>
            <span style={{ color: TEXT_MUTED, letterSpacing: "0.08em" }}>{label}</span>
            <span style={{ color: TEXT }}>{value}</span>
          </div>
        ))}

        <div style={{ marginTop: "16px", fontFamily: "'Source Serif 4', Georgia, serif", fontStyle: "italic", fontWeight: 200, fontSize: "11px", color: TEAL, textAlign: "right" }}>
          we were online
        </div>
      </div>
    </div>
  );
}

// ── Variant F: Signal / oscilloscope ─────────────────────────────────────────
// The noise texture is rendered as a 24h waveform — a hand-drawn signal that
// rises and falls with activity. Stats are annotated directly onto the graph.
// Dark, technical, beautiful. Like a radio log or seismograph readout.

function VariantF({ data, colorful }: { data: MockData; colorful: boolean }) {
  const weights = buildHourWeights(data.sessions);
  const waveRef = useRef<HTMLCanvasElement>(null!);

  useEffect(() => {
    const canvas = waveRef.current;
    if (!canvas) return;
    const W = 280, H = 80;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    ctx.clearRect(0, 0, W, H);

    let seed = 137;
    const rand = () => { seed = (seed * 1664525 + 1013904223) & 0xffffffff; return (seed >>> 0) / 0xffffffff; };

    // Build CDF for activity-biased hour sampling
    const totalWeight = weights.reduce((s, w) => s + Math.max(w, 0.04), 0);
    const cdf: number[] = [];
    let acc = 0;
    for (const w of weights) { acc += Math.max(w, 0.04) / totalWeight; cdf.push(acc); }
    const sampleHour = () => { const u = rand(); for (let h = 0; h < 24; h++) if (u < cdf[h]) return h; return 23; };

    for (let i = 0; i < 600; i++) {
      const hour = sampleHour();
      const light = hourLightness(hour);
      const w = weights[hour];
      const cx = ((hour + 0.5) / 24) * W + (rand() - 0.5) * (W / 5);
      const sw = W * (0.06 + rand() * 0.45);
      const x0 = cx - sw / 2;
      const y = rand() * H;
      const lh = 1 + rand() * 2;
      const isDark = light < 0.35 || rand() > (light * 0.85);
      const opacity = isDark
        ? 0.04 + w * 0.12 + rand() * 0.04
        : 0.008 + rand() * 0.018;
      if (colorful) {
        const [r, g, b] = risoStrokeRgb(hour, light, isDark);
        ctx.fillStyle = `rgba(${r},${g},${b},${opacity.toFixed(3)})`;
      } else if (isDark) {
        const v = Math.round(50 + rand() * 30);
        ctx.fillStyle = `rgba(${v + 10},${v},${v - 8},${opacity.toFixed(3)})`;
      } else {
        ctx.fillStyle = `rgba(220,210,195,${opacity.toFixed(3)})`;
      }
      ctx.fillRect(x0, y, sw, lh);
    }
  }, [weights.join(","), colorful]);

  return (
    <div style={{
      background: BG,
      borderRadius: "6px",
      overflow: "hidden",
      maxWidth: "300px",
      border: `1px solid ${BORDER_STRONG}`,
      fontFamily: "'Martian Mono', monospace",
      color: TEXT,
      padding: "20px 20px 18px",
      boxShadow: "0 2px 10px rgba(90,78,65,0.08)",
    }}>
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div style={{ fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: TEXT_MUTED }}>
          activity signal
        </div>
        <div style={{ fontSize: "8px", color: TEXT_FAINT }}>
          {data.domain}
        </div>
      </div>

      {/* Texture canvas */}
      <canvas ref={waveRef} style={{ display: "block", width: "100%", height: "60px", marginBottom: "20px", borderRadius: "2px" }} />

      {/* Big time */}
      <div style={{ marginBottom: "16px" }}>
        <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: "46px", fontWeight: 700, lineHeight: 0.9, letterSpacing: "-0.025em", color: TEXT }}>
          {formatDuration(data.totalMs)}
        </div>
        <div style={{ fontSize: "8px", letterSpacing: "0.12em", textTransform: "uppercase", color: TEXT_MUTED, marginTop: "5px" }}>
          time on record
        </div>
      </div>

      {/* Stats grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "12px",
        padding: "14px 0 0",
        borderTop: `1px solid ${BORDER_STRONG}`,
      }}>
        {[
          ["cursor drift", formatDistance(data.cursorDistancePx)],
          ["pages read", String(data.uniquePages)],
        ].map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: "11px", fontWeight: 500, color: TEXT }}>{value}</div>
            <div style={{ fontSize: "8px", color: TEXT_MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginTop: "2px" }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div style={{ marginTop: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: "8px", color: TEXT_FAINT }}>{data.dateRange}</div>
        <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontStyle: "italic", fontWeight: 200, fontSize: "11px", color: TEAL }}>
          we were online
        </div>
      </div>
    </div>
  );
}

// ── Variant G: Hour-dot grid ──────────────────────────────────────────────────
// 4×6 grid of circles, one per hour (0–23). Each dot's fill opacity and color
// reflects activity weight × time-of-day lightness — same logic as the texture
// but legible as a clock face. The grid is the hero; stats hang below it.

function HourDotGrid({ weights, colorful }: { weights: number[]; colorful: boolean }) {
  // 4 rows × 6 cols = 24 cells, left-to-right top-to-bottom = hour 0..23
  const COLS = 6;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${COLS}, 1fr)`,
      gap: "6px",
      marginBottom: "20px",
    }}>
      {weights.map((w, h) => {
        const light = hourLightness(h);
        // Dot prominence: combine weight and time-of-day darkness
        // Active night hours → large dark dot; active day hours → large warm dot; inactive → tiny ghost
        const prominence = w * 0.7 + (1 - light) * 0.3; // 0..1
        const size = Math.max(6, Math.round(6 + prominence * 18));

        let fill: string;
        if (colorful && w > 0.05) {
          const [r, g, b] = risoStrokeRgb(h, light, light < 0.5);
          const opacity = 0.25 + w * 0.75;
          fill = `rgba(${r},${g},${b},${opacity.toFixed(2)})`;
        } else if (w < 0.05) {
          fill = BORDER;
        } else {
          // Monochrome: dark hours → warm brown; light hours → muted
          const isDark = light < 0.5;
          const base = isDark ? 61 : 138;
          const opacity = 0.12 + w * 0.75;
          fill = isDark
            ? `rgba(${base + 10},${base},${base - 8},${opacity.toFixed(2)})`
            : `rgba(${base},${base - 10},${base - 20},${opacity.toFixed(2)})`;
        }

        return (
          <div key={h} title={`${h}:00`} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "28px" }}>
            <div style={{
              width: `${size}px`,
              height: `${size}px`,
              borderRadius: "50%",
              background: fill,
              transition: "all 0.2s",
            }} />
          </div>
        );
      })}
    </div>
  );
}

function VariantG({ data, colorful }: { data: MockData; colorful: boolean }) {
  const weights = buildHourWeights(data.sessions);

  // Hour labels for the bottom of the grid
  const peakHour = weights.indexOf(Math.max(...weights));
  const peakHours = `${peakHour}:00`;

  return (
    <div style={{
      maxWidth: "300px",
      background: BG,
      borderRadius: "8px",
      border: `1px solid ${BORDER_STRONG}`,
      fontFamily: "'Atkinson Hyperlegible', sans-serif",
      color: TEXT,
      padding: "22px 20px 18px",
      boxShadow: "0 2px 10px rgba(90,78,65,0.08)",
    }}>
      {/* Domain */}
      <div style={{ fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase", color: TEXT_MUTED, marginBottom: "16px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {data.domain}
      </div>

      {/* Dot grid — hero element */}
      <HourDotGrid weights={weights} colorful={colorful} />

      {/* Hour axis labels: midnight · 6a · noon · 6p */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "7px", color: TEXT_FAINT, letterSpacing: "0.05em", marginTop: "-12px", marginBottom: "20px", fontFamily: "'Martian Mono', monospace" }}>
        <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span>
      </div>

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${BORDER}`, marginBottom: "16px" }} />

      {/* Stats: time hero + secondary row */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: "14px" }}>
        <div>
          <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: "40px", fontWeight: 700, lineHeight: 0.9, letterSpacing: "-0.03em", color: TEXT }}>
            {formatDuration(data.totalMs)}
          </div>
          <div style={{ fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase", color: TEXT_MUTED, marginTop: "5px" }}>time spent</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "11px", color: TEXT_MUTED }}>peak {peakHours}</div>
          <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "11px", color: TEXT_MUTED, marginTop: "2px" }}>{data.uniquePages} pages</div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "12px", borderTop: `1px solid ${BORDER}` }}>
        <div style={{ fontFamily: "'Martian Mono', monospace", fontSize: "9px", color: TEXT_FAINT }}>{data.dateRange}</div>
        <div style={{ fontFamily: "'Source Serif 4', Georgia, serif", fontStyle: "italic", fontWeight: 400, fontSize: "11px", color: TEAL }}>
          we were online
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const OTHER_VARIANTS: { label: string; name: string; desc: string; Component: React.FC<{ data: MockData; colorful: boolean }> }[] = [
  {
    label: "Direction C",
    name: "Compact overlay",
    desc: "Translucent dark overlay with backdrop blur, sits directly on top of the movement animation. The original embedded format — no card border, animation shows through.",
    Component: VariantC,
  },
  {
    label: "Direction D",
    name: "Oversize type poster",
    desc: "One enormous number bleeds off the card. Hours and minutes stack at 148px. Stats are footnotes. Feels like a scoreboard or concert poster — the time is the whole statement.",
    Component: VariantD,
  },
  {
    label: "Direction E",
    name: "Film strip / receipt",
    desc: "Tall, narrow, monospaced throughout. The texture runs as a full-bleed left column. Data is laid out receipt-style in labeled rows. Dense, intimate, archival.",
    Component: VariantE,
  },
  {
    label: "Direction F",
    name: "Activity texture",
    desc: "Pure texture — layered strokes weighted by your activity hours. Toggle riso for color.",
    Component: VariantF,
  },
  {
    label: "Direction G",
    name: "Hour-dot grid",
    desc: "24 dots arranged in a 4×6 clock face. Size and opacity reflect activity weight × time-of-day lightness — at a glance you can see when you browse.",
    Component: VariantG,
  },
];

function peakProfileLabel(sessions: Session[]): string {
  const weights = buildHourWeights(sessions);
  const peak = weights.indexOf(Math.max(...weights));
  if (peak >= 22 || peak < 5) return "night owl";
  if (peak < 9) return "early bird";
  if (peak < 13) return "morning browser";
  if (peak < 17) return "afternoon";
  return "evening";
}

const BTN_STYLE: React.CSSProperties = {
  flexShrink: 0,
  padding: "7px 14px",
  background: "transparent",
  border: `1px solid ${BORDER_STRONG}`,
  borderRadius: "3px",
  color: TEXT_MUTED,
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  letterSpacing: "0.06em",
  cursor: "pointer",
};

function PreviewPage() {
  const [data, setData] = useState<MockData>(INITIAL_MOCK);
  const [colorful, setColorful] = useState(false);

  return (
    <div>
      <div className="page-header">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "24px" }}>
          <div>
            <div className="page-title">portrait card — design directions</div>
            <div className="page-subtitle">six layout directions · same data across all variants</div>
            <div className="mock-note">
              {data.domain} · {formatDuration(data.totalMs)} · {data.dateRange} · {data.uniquePages} pages · {peakProfileLabel(data.sessions)}
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", marginTop: "4px", flexShrink: 0 }}>
            <button
              onClick={() => setColorful(c => !c)}
              style={{ ...BTN_STYLE, color: colorful ? TEAL : TEXT_MUTED, borderColor: colorful ? TEAL : BORDER_STRONG }}
            >
              {colorful ? "riso on" : "riso off"}
            </button>
            <button onClick={() => setData(generateMockData())} style={BTN_STYLE}>
              randomize
            </button>
          </div>
        </div>
      </div>

      {/* Density scaling — VariantA at different time amounts */}
      <div style={{ padding: "0 40px 40px", maxWidth: "1200px" }}>
        <div style={{ fontFamily: "'Lora', Georgia, serif", fontSize: "22px", fontWeight: 600, color: TEXT, marginBottom: "8px" }}>
          Density scaling
        </div>
        <div style={{ fontSize: "12px", color: TEXT_MUTED, fontFamily: "'Atkinson Hyperlegible', sans-serif", marginBottom: "28px" }}>
          How texture density grows with accumulated time (VariantA)
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
          {DENSITY_DATA.map(({ label, data }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: "24px" }}>
              <div style={{
                width: "60px",
                flexShrink: 0,
                fontFamily: "'Martian Mono', monospace",
                fontSize: "13px",
                fontWeight: 500,
                color: TEXT_MUTED,
                textAlign: "right",
              }}>
                {label}
              </div>
              <VariantA data={data} colorful={false} />
              <VariantA data={data} colorful={true} />
            </div>
          ))}
        </div>
      </div>

      <div className="variants-grid">
        <div className="variant">
          <div>
            <div className="variant-label">Direction A</div>
            <div className="variant-name">Minimal + vertical texture</div>
            <div className="variant-desc">Vertical strokes mapped to the 24h timeline — dense columns where you were active, light or dark based on time of day.</div>
          </div>
          <VariantA data={data} colorful={colorful} />
        </div>
        {OTHER_VARIANTS.map(({ label, name, desc, Component }) => (
          <div className="variant" key={label}>
            <div>
              <div className="variant-label">{label}</div>
              <div className="variant-name">{name}</div>
              <div className="variant-desc">{desc}</div>
            </div>
            <Component data={data} colorful={colorful} />
          </div>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("reactContent") as HTMLElement).render(<PreviewPage />);
