// ABOUTME: Preview page for PortraitCard design directions
// ABOUTME: Shows distinct visual variants with mock browsing data for evaluation
// Agentation is a dev-only toolbar — loaded at runtime so it never appears in the production bundle
import "./components-preview.scss";
import React, { lazy, useEffect, useId, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
const Agentation = import.meta.env.DEV
  ? lazy(() => import("agentation").then((m) => ({ default: m.Agentation })))
  : null;

// ── Mock data ─────────────────────────────────────────────────────────────────

type Session = {
  url: string;
  focusTs: number;
  blurTs: number;
  durationMs: number;
};

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
  "night owl": [
    0.8, 0.9, 0.7, 0.4, 0.1, 0.0, 0.0, 0.1, 0.2, 0.3, 0.3, 0.3, 0.2, 0.2, 0.2,
    0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.9,
  ],
  "early bird": [
    0.1, 0.0, 0.0, 0.0, 0.3, 0.7, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.4, 0.4, 0.3,
    0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.1, 0.1, 0.1,
  ],
  "9-to-5": [
    0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.2, 0.4, 0.6, 0.9, 0.9, 0.8, 0.7, 0.9, 0.9,
    0.8, 0.6, 0.3, 0.2, 0.2, 0.1, 0.1, 0.0, 0.0,
  ],
  "evening binge": [
    0.1, 0.1, 0.1, 0.0, 0.0, 0.0, 0.1, 0.2, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3,
    0.4, 0.5, 0.6, 0.8, 0.9, 0.9, 0.8, 0.7, 0.4,
  ],
  scattered: [
    0.3, 0.2, 0.1, 0.1, 0.1, 0.2, 0.4, 0.5, 0.5, 0.4, 0.5, 0.5, 0.4, 0.5, 0.5,
    0.4, 0.4, 0.5, 0.5, 0.4, 0.4, 0.4, 0.3, 0.3,
  ],
};

const PROFILE_NAMES = Object.keys(HOUR_PROFILES);

function generateMockData(): MockData {
  const profileName =
    PROFILE_NAMES[Math.floor(Math.random() * PROFILE_NAMES.length)];
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
      if (r < cumul) {
        hour = h;
        break;
      }
    }

    const minute = Math.floor(Math.random() * 60);
    const focusTs = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      hour,
      minute,
    ).getTime();
    const durationMs = (5 + Math.floor(Math.random() * 110)) * 60 * 1000;
    const blurTs = focusTs + durationMs;

    sessions.push({
      url: `https://example.com/page-${i}`,
      focusTs,
      blurTs,
      durationMs,
    });
  }

  sessions.sort((a, b) => a.focusTs - b.focusTs);

  const totalMs = sessions.reduce((s, x) => s + x.durationMs, 0);
  const cursorDistancePx = 100_000 + Math.floor(Math.random() * 900_000);
  const uniquePages = 5 + Math.floor(Math.random() * 60);

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const oldest = new Date(sessions[0].focusTs);
  const newest = new Date(sessions[sessions.length - 1].focusTs);
  const dateRange =
    oldest.getMonth() === newest.getMonth()
      ? `${fmt(oldest)}–${newest.getDate()}, ${newest.getFullYear()}`
      : `${fmt(oldest)} – ${fmt(newest)}, ${newest.getFullYear()}`;

  return {
    sessions,
    totalMs,
    cursorDistancePx,
    uniquePages,
    domain: "en.wikipedia.org",
    dateRange,
  };
}

const INITIAL_MOCK = generateMockData();

// Deterministic mock data for density scaling comparison
function generateFixedMockData(
  totalMs: number,
  sessionCount: number,
  hourSpread: number,
): MockData {
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

  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const oldest = new Date(sessions[0].focusTs);
  const newest = new Date(sessions[sessions.length - 1].focusTs);
  const dateRange =
    oldest.getMonth() === newest.getMonth()
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

const DENSITY_TIERS: {
  label: string;
  totalMs: number;
  sessionCount: number;
  hourSpread: number;
}[] = [
  { label: "3 min", totalMs: 3 * 60_000, sessionCount: 2, hourSpread: 1 },
  { label: "4 hrs", totalMs: 4 * 3600_000, sessionCount: 7, hourSpread: 4 },
  { label: "48 hrs", totalMs: 48 * 3600_000, sessionCount: 24, hourSpread: 18 },
];

const DENSITY_DATA = DENSITY_TIERS.map((t) => ({
  ...t,
  data: generateFixedMockData(t.totalMs, t.sessionCount, t.hourSpread),
}));

// ── Design tokens (matches extension popup palette) ───────────────────────────

const BG = "#faf7f2"; // warm linen
const SURFACE = "#f5f0e8"; // aged paper
const SURFACE_D = "#efe9df"; // hover/deeper surface
const TEXT = "#3d3833"; // warm dark brown
const TEXT_MUTED = "#8a8279";
const TEXT_FAINT = "#b5aea5";
const BORDER = "rgba(90,78,65,0.12)";
const BORDER_STRONG = "rgba(90,78,65,0.25)";
const TEAL = "#4a9a8a";

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
  const curve = [
    0.02, 0.01, 0.01, 0.02, 0.08, 0.28, 0.52, 0.72, 0.82, 0.88, 0.92, 0.96, 1.0,
    0.97, 0.92, 0.85, 0.72, 0.55, 0.38, 0.25, 0.15, 0.09, 0.05, 0.03,
  ];
  return curve[h] ?? 0;
}

// Color palette — one hue per hour band (8 colors cycling across 24h)
// rgb values matching RISO_COLORS HSL palette in eventUtils.ts
const RISO_RGB: [number, number, number][] = [
  [210, 51, 35], // warm red
  [180, 148, 34], // amber
  [92, 158, 46], // moss green
  [39, 155, 130], // teal
  [40, 110, 189], // steel blue
  [80, 55, 189], // violet
  [184, 48, 151], // magenta
  [195, 115, 35], // burnt orange
];

// Map an hour to a RISO color, preserving its luminance by scaling the RGB
// so the perceived brightness matches the monochrome value for that hour.
function risoStrokeRgb(
  hour: number,
  light: number,
  isDark: boolean,
): [number, number, number] {
  const [r, g, b] = RISO_RGB[hour % RISO_RGB.length];
  // Target luminance: dark hours stay dim, light hours stay bright
  const targetL = isDark
    ? 0.08 + (1 - light) * 0.22 // dim — heavier for night hours
    : 0.55 + light * 0.35; // bright — washed out for daytime
  // Perceived luminance of the RISO color (rec. 709 coefficients)
  const perceivedL = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const scale = perceivedL > 0 ? targetL / perceivedL : 1;
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
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };

    // Build CDF for activity-biased hour sampling (no minimum floor — empty hours get zero strokes)
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

    const activeHours = weights.filter((w) => w > 0).length;
    const jitterWidth = activeHours <= 2 ? width / 2 : width / 5;

    // Scale stroke count with time when totalMs is provided
    const totalMinutes = totalMs != null ? totalMs / 60_000 : undefined;
    const strokeCount =
      totalMinutes != null
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

      const isDark = light < 0.35 || rand() > light * 0.85;
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
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };

    // Build CDF for activity-biased hour sampling (no minimum floor — empty hours get zero strokes)
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

    const activeHours = weights.filter((w) => w > 0).length;
    const jitterWidth = activeHours <= 2 ? width / 2 : width / 4;

    // Scale stroke count with time when totalMs is provided
    const totalMinutes = totalMs != null ? totalMs / 60_000 : undefined;
    const strokeCount =
      totalMinutes != null
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

      const isDark = light < 0.35 || rand() > light * 0.85;
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

// ── Variant A: Minimal + generative texture ───────────────────────────────────

function VariantA({ data, colorful }: { data: MockData; colorful: boolean }) {
  const weights = buildHourWeights(data.sessions);
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  useVerticalTexture(canvasRef, weights, 300, 200, colorful, data.totalMs);

  return (
    <div
      style={{
        position: "relative",
        borderRadius: "4px",
        overflow: "hidden",
        maxWidth: "300px",
        fontFamily: "'Atkinson Hyperlegible', sans-serif",
        color: TEXT,
        border: `1px solid ${BORDER_STRONG}`,
        boxShadow: "0 2px 10px rgba(90,78,65,0.08)",
      }}
    >
      {/* Generative texture fills the whole card */}
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
      {/* Overlay — heavier than other variants so text reads over the texture */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(250,247,242,0.72)",
        }}
      />

      <div style={{ position: "relative", padding: "28px 24px 22px" }}>
        <div
          style={{
            fontSize: "10px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: TEXT_MUTED,
            marginBottom: "20px",
          }}
        >
          {data.domain}
        </div>

        <div
          style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: "56px",
            fontWeight: 700,
            lineHeight: 0.9,
            letterSpacing: "-0.03em",
            color: TEXT,
            marginBottom: "6px",
          }}
        >
          {formatDuration(data.totalMs)}
        </div>
        <div
          style={{
            fontSize: "10px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: TEXT_MUTED,
            marginBottom: "28px",
          }}
        >
          time spent
        </div>

        <div
          style={{
            borderTop: `1px solid ${BORDER_STRONG}`,
            marginBottom: "18px",
          }}
        />

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <div
              style={{
                fontFamily: "'Martian Mono', monospace",
                fontSize: "18px",
                fontWeight: 500,
                color: TEXT,
              }}
            >
              {formatDistance(data.cursorDistancePx)}
            </div>
            <div
              style={{
                fontSize: "9px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: TEXT_MUTED,
                marginTop: "3px",
              }}
            >
              moved
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "'Martian Mono', monospace",
                fontSize: "18px",
                fontWeight: 500,
                color: TEXT,
              }}
            >
              {data.uniquePages}
            </div>
            <div
              style={{
                fontSize: "9px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: TEXT_MUTED,
                marginTop: "3px",
              }}
            >
              pages
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: "22px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: TEXT_MUTED,
              fontFamily: "'Martian Mono', monospace",
            }}
          >
            {data.dateRange}
          </div>
          <div
            style={{
              fontFamily: "'Source Serif 4', Georgia, serif",
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: "12px",
              color: TEAL,
            }}
          >
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
    <div
      style={{
        position: "relative",
        borderRadius: "6px",
        overflow: "hidden",
        maxWidth: "300px",
        minHeight: "380px",
        fontFamily: "'Atkinson Hyperlegible', sans-serif",
        border: `1px solid ${BORDER_STRONG}`,
        boxShadow: "0 2px 10px rgba(90,78,65,0.08)",
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
      {/* Light overlay — texture shows through as subtle paper grain */}
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
          padding: "22px 20px 24px",
          height: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Domain small, top */}
        <div
          style={{
            fontSize: "9px",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: TEXT_MUTED,
            marginBottom: "8px",
          }}
        >
          {data.domain}
        </div>

        {/* Giant hour number — crops off right edge intentionally */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              fontFamily: "'Lora', Georgia, serif",
              fontSize: "148px",
              fontWeight: 700,
              lineHeight: 0.82,
              letterSpacing: "-0.04em",
              color: TEXT,
              marginLeft: "-4px",
              whiteSpace: "nowrap",
            }}
          >
            {hours}
          </div>
          <div
            style={{
              fontFamily: "'Lora', Georgia, serif",
              fontSize: "148px",
              fontWeight: 700,
              lineHeight: 0.82,
              letterSpacing: "-0.04em",
              color: "rgba(61,56,51,0.15)",
              marginLeft: "-4px",
              whiteSpace: "nowrap",
            }}
          >
            {String(mins).padStart(2, "0")}
          </div>
        </div>

        {/* Unit label */}
        <div style={{ marginTop: "12px", marginBottom: "18px" }}>
          <span
            style={{
              fontSize: "11px",
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: TEXT_MUTED,
            }}
          >
            hours · minutes
          </span>
        </div>

        {/* Bottom strip — small stats in a row */}
        <div
          style={{
            borderTop: `1px solid ${BORDER_STRONG}`,
            paddingTop: "14px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div>
            <div
              style={{
                fontFamily: "'Martian Mono', monospace",
                fontSize: "12px",
                color: TEXT,
              }}
            >
              {formatDistance(data.cursorDistancePx)}
            </div>
            <div
              style={{
                fontSize: "8px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: TEXT_MUTED,
                marginTop: "2px",
              }}
            >
              moved
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: "'Martian Mono', monospace",
                fontSize: "12px",
                color: TEXT,
              }}
            >
              {data.uniquePages} pg
            </div>
            <div
              style={{
                fontSize: "8px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: TEXT_MUTED,
                marginTop: "2px",
              }}
            >
              visited
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "'Source Serif 4', Georgia, serif",
                fontStyle: "italic",
                fontWeight: 400,
                fontSize: "12px",
                color: TEAL,
              }}
            >
              we were online
            </div>
            <div
              style={{
                fontSize: "8px",
                letterSpacing: "0.07em",
                color: TEXT_MUTED,
                marginTop: "2px",
              }}
            >
              {data.dateRange}
            </div>
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
  const peakLabel =
    peakHour < 5
      ? "3am"
      : peakHour < 9
      ? "dawn"
      : peakHour < 13
      ? "morning"
      : peakHour < 17
      ? "afternoon"
      : peakHour < 21
      ? "evening"
      : "midnight";

  return (
    <div
      style={{
        display: "flex",
        maxWidth: "300px",
        background: BG,
        borderRadius: "6px",
        overflow: "hidden",
        border: `1px solid ${BORDER_STRONG}`,
        fontFamily: "'Martian Mono', monospace",
        color: TEXT,
        boxShadow: "0 2px 10px rgba(90,78,65,0.08)",
      }}
    >
      {/* Left: texture column */}
      <div style={{ position: "relative", width: "52px", flexShrink: 0 }}>
        <canvas
          ref={noiseRef}
          style={{ display: "block", width: "52px", height: "100%" }}
        />
        {/* Subtle right edge fade into bg */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `linear-gradient(to right, transparent 60%, ${BG})`,
          }}
        />
      </div>

      {/* Right: all the data */}
      <div style={{ flex: 1, padding: "20px 18px 20px 12px" }}>
        {/* Domain */}
        <div
          style={{
            fontSize: "9px",
            color: TEAL,
            marginBottom: "16px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {data.domain}
        </div>

        {/* Main stat: time */}
        <div style={{ marginBottom: "20px" }}>
          <div
            style={{
              fontSize: "8px",
              color: TEXT_MUTED,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              marginBottom: "3px",
            }}
          >
            TIME SPENT
          </div>
          <div
            style={{
              fontFamily: "'Lora', Georgia, serif",
              fontSize: "38px",
              fontWeight: 700,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              color: TEXT,
            }}
          >
            {formatDuration(data.totalMs)}
          </div>
        </div>

        {/* Data rows — receipt-style */}
        {[
          ["DISTANCE", formatDistance(data.cursorDistancePx)],
          ["PAGES", String(data.uniquePages)],
          ["PEAK HR", peakLabel],
          [
            "FIRST",
            new Date(data.sessions[0].focusTs).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            }),
          ],
          [
            "LAST",
            new Date(
              data.sessions[data.sessions.length - 1].focusTs,
            ).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          ],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "10px",
              marginBottom: "7px",
              borderBottom: `1px dashed ${BORDER}`,
              paddingBottom: "7px",
            }}
          >
            <span style={{ color: TEXT_MUTED, letterSpacing: "0.08em" }}>
              {label}
            </span>
            <span style={{ color: TEXT }}>{value}</span>
          </div>
        ))}

        <div
          style={{
            marginTop: "16px",
            fontFamily: "'Source Serif 4', Georgia, serif",
            fontStyle: "italic",
            fontWeight: 200,
            fontSize: "11px",
            color: TEAL,
            textAlign: "right",
          }}
        >
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

function useHorizontalTexture(
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
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) & 0xffffffff;
      return (seed >>> 0) / 0xffffffff;
    };

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

    const activeHours = weights.filter((w) => w > 0).length;
    const jitterHeight = activeHours <= 2 ? height / 2 : height / 4;

    const totalMinutes = totalMs != null ? totalMs / 60_000 : undefined;
    const strokeCount =
      totalMinutes != null
        ? Math.min(2000, Math.round(totalMinutes * 15))
        : 1800;

    for (let i = 0; i < strokeCount; i++) {
      const hour = sampleHour();
      const light = hourLightness(hour);
      const w = weights[hour];

      // Y: spread across the full height, biased by hour
      const cy = ((hour + 0.5) / 24) * height + (rand() - 0.5) * jitterHeight;
      // Thin horizontal strokes
      const sh = 0.5 + rand() * (height / 24) * 0.4;
      // X: always start from 0, vary how far across they reach
      const sw = width * (0.3 + rand() * 0.7);

      const isDark = light < 0.35 || rand() > light * 0.85;
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

      ctx.fillRect(0, cy - sh / 2, sw, sh);
    }
  }, [weights.join(","), width, height, colorful, totalMs]);
}

function VariantF({ data, colorful }: { data: MockData; colorful: boolean }) {
  const weights = buildHourWeights(data.sessions);
  const canvasRef = useRef<HTMLCanvasElement>(null!);
  useHorizontalTexture(canvasRef, weights, 300, 200, colorful, data.totalMs);

  return (
    <div
      style={{
        position: "relative",
        borderRadius: "4px",
        overflow: "hidden",
        maxWidth: "300px",
        fontFamily: "'Atkinson Hyperlegible', sans-serif",
        color: TEXT,
        border: `1px solid ${BORDER_STRONG}`,
        boxShadow: "0 2px 10px rgba(90,78,65,0.08)",
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

      <div style={{ position: "relative", padding: "28px 24px 22px" }}>
        <div
          style={{
            fontSize: "10px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: TEXT_MUTED,
            marginBottom: "20px",
          }}
        >
          {data.domain}
        </div>

        <div
          style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: "56px",
            fontWeight: 700,
            lineHeight: 0.9,
            letterSpacing: "-0.03em",
            color: TEXT,
            marginBottom: "6px",
          }}
        >
          {formatDuration(data.totalMs)}
        </div>
        <div
          style={{
            fontSize: "10px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: TEXT_MUTED,
            marginBottom: "28px",
          }}
        >
          time spent
        </div>

        <div
          style={{
            borderTop: `1px solid ${BORDER_STRONG}`,
            marginBottom: "18px",
          }}
        />

        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <div>
            <div
              style={{
                fontFamily: "'Martian Mono', monospace",
                fontSize: "18px",
                fontWeight: 500,
                color: TEXT,
              }}
            >
              {formatDistance(data.cursorDistancePx)}
            </div>
            <div
              style={{
                fontSize: "9px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: TEXT_MUTED,
                marginTop: "3px",
              }}
            >
              moved
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "'Martian Mono', monospace",
                fontSize: "18px",
                fontWeight: 500,
                color: TEXT,
              }}
            >
              {data.uniquePages}
            </div>
            <div
              style={{
                fontSize: "9px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: TEXT_MUTED,
                marginTop: "3px",
              }}
            >
              pages
            </div>
          </div>
        </div>

        <div
          style={{
            marginTop: "22px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: TEXT_MUTED,
              fontFamily: "'Martian Mono', monospace",
            }}
          >
            {data.dateRange}
          </div>
          <div
            style={{
              fontFamily: "'Source Serif 4', Georgia, serif",
              fontStyle: "italic",
              fontWeight: 400,
              fontSize: "12px",
              color: TEAL,
            }}
          >
            we were online
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Variant G: Hour-dot grid ──────────────────────────────────────────────────
// 4×6 grid of circles, one per hour (0–23). Each dot's fill opacity and color
// reflects activity weight × time-of-day lightness — same logic as the texture
// but legible as a clock face. The grid is the hero; stats hang below it.

function HourDotGrid({
  weights,
  colorful,
}: {
  weights: number[];
  colorful: boolean;
}) {
  // 4 rows × 6 cols = 24 cells, left-to-right top-to-bottom = hour 0..23
  const COLS = 6;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gap: "6px",
        marginBottom: "20px",
      }}
    >
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
          <div
            key={h}
            title={`${h}:00`}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "28px",
            }}
          >
            <div
              style={{
                width: `${size}px`,
                height: `${size}px`,
                borderRadius: "50%",
                background: fill,
                transition: "all 0.2s",
              }}
            />
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
    <div
      style={{
        maxWidth: "300px",
        background: BG,
        borderRadius: "8px",
        border: `1px solid ${BORDER_STRONG}`,
        fontFamily: "'Atkinson Hyperlegible', sans-serif",
        color: TEXT,
        padding: "22px 20px 18px",
        boxShadow: "0 2px 10px rgba(90,78,65,0.08)",
      }}
    >
      {/* Domain */}
      <div
        style={{
          fontSize: "9px",
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: TEXT_MUTED,
          marginBottom: "16px",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {data.domain}
      </div>

      {/* Dot grid — hero element */}
      <HourDotGrid weights={weights} colorful={colorful} />

      {/* Hour axis labels: midnight · 6a · noon · 6p */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "7px",
          color: TEXT_FAINT,
          letterSpacing: "0.05em",
          marginTop: "-12px",
          marginBottom: "20px",
          fontFamily: "'Martian Mono', monospace",
        }}
      >
        <span>12a</span>
        <span>6a</span>
        <span>12p</span>
        <span>6p</span>
        <span>11p</span>
      </div>

      {/* Divider */}
      <div style={{ borderTop: `1px solid ${BORDER}`, marginBottom: "16px" }} />

      {/* Stats: time hero + secondary row */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginBottom: "14px",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "'Lora', Georgia, serif",
              fontSize: "40px",
              fontWeight: 700,
              lineHeight: 0.9,
              letterSpacing: "-0.03em",
              color: TEXT,
            }}
          >
            {formatDuration(data.totalMs)}
          </div>
          <div
            style={{
              fontSize: "9px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: TEXT_MUTED,
              marginTop: "5px",
            }}
          >
            time spent
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontFamily: "'Martian Mono', monospace",
              fontSize: "11px",
              color: TEXT_MUTED,
            }}
          >
            peak {peakHours}
          </div>
          <div
            style={{
              fontFamily: "'Martian Mono', monospace",
              fontSize: "11px",
              color: TEXT_MUTED,
              marginTop: "2px",
            }}
          >
            {data.uniquePages} pages
          </div>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: "12px",
          borderTop: `1px solid ${BORDER}`,
        }}
      >
        <div
          style={{
            fontFamily: "'Martian Mono', monospace",
            fontSize: "9px",
            color: TEXT_FAINT,
          }}
        >
          {data.dateRange}
        </div>
        <div
          style={{
            fontFamily: "'Source Serif 4', Georgia, serif",
            fontStyle: "italic",
            fontWeight: 400,
            fontSize: "11px",
            color: TEAL,
          }}
        >
          we were online
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const OTHER_VARIANTS: {
  id: string;
  label: string;
  name: string;
  desc: string;
  Component: React.FC<{ data: MockData; colorful: boolean }>;
}[] = [
  {
    id: "section-dir-d",
    label: "Direction D",
    name: "Oversize type poster",
    desc: "One enormous number bleeds off the card. Hours and minutes stack at 148px. Stats are footnotes. Feels like a scoreboard or concert poster — the time is the whole statement.",
    Component: VariantD,
  },
  {
    id: "section-dir-e",
    label: "Direction E",
    name: "Film strip / receipt",
    desc: "Tall, narrow, monospaced throughout. The texture runs as a full-bleed left column. Data is laid out receipt-style in labeled rows. Dense, intimate, archival.",
    Component: VariantE,
  },
  {
    id: "section-dir-f",
    label: "Direction F",
    name: "Horizontal texture",
    desc: "Same layout as Direction A but with horizontal strokes — activity hours map to vertical position instead of horizontal.",
    Component: VariantF,
  },
  {
    id: "section-dir-g",
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

// ── Link traces ───────────────────────────────────────────────────────────────

import {
  computeIntensity,
  computeGlowStyle,
  applyInlineGlow,
  applySingleLineGlow,
  buildPseudoElementCSS,
  type GlowStyle,
} from "../../extension/src/features/link-glow-renderer";

interface LinkTraceData {
  count: number;
  recentColors: string[];
  pageMax: number;
}

function linkIntensity(d: LinkTraceData): number {
  return computeIntensity(d.count, d.pageMax);
}

function ltHslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = Math.min(
      1,
      Math.max(0, l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)),
    );
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}


function ltPickColors(n: number): string[] {
  const seeds = [42, 137, 251, 88, 195, 314, 67, 200];
  return seeds.slice(0, Math.min(n, seeds.length)).map((seed) => {
    const hue = seed % 360;
    const s = 65 + (seed % 15);
    const l = 55 + ((seed * 7) % 15);
    return ltHslToHex(hue, s, l);
  });
}

function ltSmearGradient(colors: string[]): string {
  if (colors.length === 0) return "transparent";
  if (colors.length === 1) return colors[0];
  const stops = colors.map(
    (c, i) => `${c} ${((i / (colors.length - 1)) * 100).toFixed(0)}%`,
  );
  return `linear-gradient(105deg, ${stops.join(", ")})`;
}

const LT_PAGE_MAX = 800;

// Each link gets its own slice of the color wheel so they're visually distinct.
// offset staggers the starting seed index so neighboring links don't share hues.
function ltPickColorsFor(n: number, offset: number): string[] {
  const seeds = [42, 137, 251, 88, 195, 314, 67, 200, 179, 53, 280, 110];
  return Array.from({ length: Math.min(n, 8) }, (_, i) => {
    const seed = seeds[(i + offset) % seeds.length];
    const hue = seed % 360;
    const s = 65 + (seed % 15);
    const l = 55 + ((seed * 7) % 15);
    return ltHslToHex(hue, s, l);
  });
}

const LT_EXCERPT_DATA: Record<string, LinkTraceData> = {
  hypertext: {
    count: 800,
    recentColors: ltPickColorsFor(8, 0),
    pageMax: LT_PAGE_MAX,
  },
  "world-wide-web": {
    count: 120,
    recentColors: ltPickColorsFor(5, 2),
    pageMax: LT_PAGE_MAX,
  },
  "tim-berners-lee": {
    count: 3,
    recentColors: ltPickColorsFor(2, 4),
    pageMax: LT_PAGE_MAX,
  },
  "distributed-computing": {
    count: 45,
    recentColors: ltPickColorsFor(3, 6),
    pageMax: LT_PAGE_MAX,
  },
  cern: {
    count: 600,
    recentColors: ltPickColorsFor(7, 1),
    pageMax: LT_PAGE_MAX,
  },
  url: { count: 18, recentColors: ltPickColorsFor(2, 3), pageMax: LT_PAGE_MAX },
  html: {
    count: 350,
    recentColors: ltPickColorsFor(6, 5),
    pageMax: LT_PAGE_MAX,
  },
  css: { count: 90, recentColors: ltPickColorsFor(4, 7), pageMax: LT_PAGE_MAX },
  javascript: {
    count: 700,
    recentColors: ltPickColorsFor(8, 9),
    pageMax: LT_PAGE_MAX,
  },
  // Early-visit scenarios: single visitor on a fresh page
  "single-visit-fresh": {
    count: 1,
    recentColors: ltPickColorsFor(1, 0),
    pageMax: 1,
  },
  "few-visits-fresh": {
    count: 3,
    recentColors: ltPickColorsFor(1, 2),
    pageMax: 5,
  },
  "single-visit-busy": {
    count: 1,
    recentColors: ltPickColorsFor(1, 4),
    pageMax: LT_PAGE_MAX,
  },
};

type LtLinkRenderer = (props: {
  href: string;
  children: React.ReactNode;
  data: LinkTraceData;
}) => React.ReactElement;

function LtLink({
  href,
  children,
  data,
  render: Render,
}: {
  href: string;
  children: React.ReactNode;
  data: LinkTraceData;
  render: LtLinkRenderer;
}) {
  const t = linkIntensity(data);
  const info = `count: ${data.count}, pageMax: ${data.pageMax}, colors: ${data.recentColors.length}, t: ${t.toFixed(4)}`;
  return (
    <span
      title={info}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(info);
      }}
    >
      <Render href={href} data={data}>
        {children}
      </Render>
    </span>
  );
}

function WikiExcerpt({ renderLink }: { renderLink: LtLinkRenderer }) {
  const R = renderLink;
  return (
    <div
      className="wiki-excerpt"
      style={{
        fontFamily: "Linux Libertine, Georgia, Times, serif",
        fontSize: "14px",
        lineHeight: "1.8",
        color: "#202122",
        background: "#fff",
        border: "1px solid #a2a9b1",
        borderRadius: "2px",
        padding: "16px 20px",
        maxWidth: "560px",
      }}
    >
      <p style={{ margin: "0 0 10px" }}>
        The{" "}
        <LtLink href="hypertext" data={LT_EXCERPT_DATA["hypertext"]} render={R}>
          hypertext
        </LtLink>{" "}
        transfer protocol underpins communication on the{" "}
        <LtLink
          href="world-wide-web"
          data={LT_EXCERPT_DATA["world-wide-web"]}
          render={R}
        >
          World Wide Web
        </LtLink>
        . First described by{" "}
        <LtLink
          href="tim-berners-lee"
          data={LT_EXCERPT_DATA["tim-berners-lee"]}
          render={R}
        >
          Tim Berners-Lee
        </LtLink>{" "}
        in 1989, the web was originally conceived as a{" "}
        <LtLink
          href="distributed-computing"
          data={LT_EXCERPT_DATA["distributed-computing"]}
          render={R}
        >
          distributed
        </LtLink>{" "}
        information management system for{" "}
        <LtLink href="cern" data={LT_EXCERPT_DATA["cern"]} render={R}>
          CERN
        </LtLink>
        .
      </p>
      <p style={{ margin: "0 0 10px" }}>
        The architecture relies on{" "}
        <LtLink href="url" data={LT_EXCERPT_DATA["url"]} render={R}>
          uniform resource locators
        </LtLink>{" "}
        to identify resources and{" "}
        <LtLink href="html" data={LT_EXCERPT_DATA["html"]} render={R}>
          HTML
        </LtLink>{" "}
        to structure documents. Modern browsers extend this with{" "}
        <LtLink href="css" data={LT_EXCERPT_DATA["css"]} render={R}>
          CSS
        </LtLink>{" "}
        for presentation and{" "}
        <LtLink
          href="javascript"
          data={LT_EXCERPT_DATA["javascript"]}
          render={R}
        >
          JavaScript
        </LtLink>{" "}
        for interactivity.
      </p>
      <p style={{ margin: "0 0 10px" }}>
        Early visit test:{" "}
        <LtLink href="single-visit-fresh" data={LT_EXCERPT_DATA["single-visit-fresh"]} render={R}>
          single click, fresh page
        </LtLink>
        ,{" "}
        <LtLink href="few-visits-fresh" data={LT_EXCERPT_DATA["few-visits-fresh"]} render={R}>
          3 clicks on small page
        </LtLink>
        ,{" "}
        <LtLink href="single-visit-busy" data={LT_EXCERPT_DATA["single-visit-busy"]} render={R}>
          single click, busy page
        </LtLink>
        .
      </p>
      <p style={{ margin: 0, maxWidth: "280px" }}>
        Line-wrap stress test:{" "}
        <LtLink
          href="distributed-computing"
          data={LT_EXCERPT_DATA["distributed-computing"]}
          render={R}
        >
          distributed information management system
        </LtLink>{" "}
        spans multiple lines, and{" "}
        <LtLink href="cern" data={LT_EXCERPT_DATA["cern"]} render={R}>
          European Organization for Nuclear Research (CERN)
        </LtLink>{" "}
        wraps too.
      </p>
    </div>
  );
}

// Cursors that occasionally pass through a link and fade out while still over it.
// Each cursor sweeps from one side to the other on a gentle arc, fading out mid-crossing.
// Volume controls how many cursors are in the cycle: low=1, medium=2, high=3.
function PassingCursors({
  data,
  linkRef,
}: {
  data: LinkTraceData;
  linkRef: React.RefObject<HTMLAnchorElement | null>;
}) {
  const t = linkIntensity(data);

  // Get per-line-fragment rects so cursors anchor to actual text positions
  const [fragments, setFragments] = useState<{ left: number; top: number; width: number; height: number }[]>([]);
  useEffect(() => {
    const el = linkRef.current;
    if (!el) return;
    const clientRects = Array.from(el.getClientRects());
    if (clientRects.length === 0) return;
    // Absolute children of an inline element are positioned relative to
    // the first fragment's top-left, not getBoundingClientRect()'s origin.
    const origin = clientRects[0];
    const rects = clientRects.map((r) => ({
      left: r.left - origin.left,
      top: r.top - origin.top,
      width: r.width,
      height: r.height,
    }));
    setFragments(rects);
  }, [linkRef]);

  if (t === 0 || fragments.length === 0) return null;

  // 1 cursor at low volume, 2 at medium, 3 at high
  const count = t < 0.2 ? 1 : t < 0.6 ? 2 : 3;
  const colors = data.recentColors.slice(0, count);

  // All cursors share one long cycle so there's a genuine long silence between bursts.
  // wanderMs: how long each cursor wanders around the link before absorbing.
  // staggerMs: gap between each cursor in the burst.
  // burstMs: total time for all cursors in the burst.
  // pauseMs: silence after the burst before it repeats.
  const wanderMs = 7000; // cursor visible and moving for ~7 seconds
  const staggerMs = 1200; // gap between each cursor in the burst
  const burstMs = wanderMs + staggerMs * (count - 1);
  const pauseMs = 22000 + (1 - t) * 8000; // 22s at high volume, up to 30s at low
  const cycleMs = burstMs + pauseMs;

  // Express wanderMs as a % of cycleMs for the keyframe.
  const wanderPct = (wanderMs / cycleMs) * 100;
  // The wander phase: cursor drifts back and forth across the link before absorbing.
  // Phases: fade-in → drift right → drift left → drift to center → absorb at center → invisible
  const fadeInPct = wanderPct * 0.06;
  const drift1Pct = wanderPct * 0.28; // arrived on far side of link
  const drift2Pct = wanderPct * 0.55; // drifted to near side
  const drift3Pct = wanderPct * 0.75; // back toward center
  const absorbStartPct = wanderPct * 0.88; // begin shrinking
  const absorbEndPct = wanderPct * 0.97;   // fully absorbed

  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        pointerEvents: "none",
        zIndex: 3,
      }}
    >
      {colors.map((color, i) => {
        const cursorScale = 0.9;
        const w = 10 * cursorScale;
        const h = 14 * cursorScale;
        const ltr = i % 2 === 0;
        const delayMs = i * staggerMs;

        // Assign each cursor to a line fragment (round-robin)
        const frag = fragments[i % fragments.length];
        const fragW = frag.width;

        const farSide = ltr ? fragW - w : -(fragW - w);
        const nearSide = ltr ? fragW * 0.2 : -(fragW * 0.2);
        const center = ltr ? fragW * 0.5 - w / 2 : -(fragW * 0.5 - w / 2);
        const animName = `lt-wander-${count}-${i}`;

        // Position at this fragment's start edge, vertically centered
        const cursorLeft = ltr ? frag.left : frag.left + frag.width;
        const cursorTop = frag.top + frag.height / 2 - h / 2;
        return (
          <React.Fragment key={i}>
            <style>{`
              @keyframes ${animName} {
                0%                              { transform: translateX(0px) translateY(0px) scale(1); opacity: 0; }
                ${fadeInPct.toFixed(2)}%        { opacity: 0.72; }
                ${drift1Pct.toFixed(2)}%        { transform: translateX(${farSide.toFixed(1)}px) translateY(-3px) scale(1); opacity: 0.68; }
                ${drift2Pct.toFixed(2)}%        { transform: translateX(${nearSide.toFixed(1)}px) translateY(2px) scale(1); opacity: 0.65; }
                ${drift3Pct.toFixed(2)}%        { transform: translateX(${center.toFixed(1)}px) translateY(-1px) scale(1); opacity: 0.70; }
                ${absorbStartPct.toFixed(2)}%   { transform: translateX(${center.toFixed(1)}px) translateY(0px) scale(1); opacity: 0.65; }
                ${absorbEndPct.toFixed(2)}%     { transform: translateX(${center.toFixed(1)}px) translateY(0px) scale(0.2); opacity: 0; }
                100%                            { transform: translateX(${center.toFixed(1)}px) translateY(0px) scale(0.2); opacity: 0; }
              }
            `}</style>
            <span
              style={{
                position: "absolute",
                left: cursorLeft,
                top: cursorTop,
                display: "inline-block",
                animation: `${animName} ${(cycleMs / 1000).toFixed(2)}s linear ${(delayMs / 1000).toFixed(2)}s infinite`,
                opacity: 0,
              }}
            >
              <svg
                width={w} height={h}
                viewBox="0 0 10 14"
                fill="none"
                style={{ display: "block", transform: ltr ? "none" : "scaleX(-1)" }}
              >
                <path
                  d="M1 1L1 11.5L3.5 9L5.5 13L7 12.3L5 8.3L8.5 8.3L1 1Z"
                  fill={color}
                  stroke="white"
                  strokeWidth="0.5"
                  strokeOpacity="0.7"
                />
              </svg>
            </span>
          </React.Fragment>
        );
      })}
    </span>
  );
}




function SmearLink({
  children,
  data,
  showCursors = false,
}: {
  href: string;
  children: React.ReactNode;
  data: LinkTraceData;
  showCursors?: boolean;
}) {
  const linkRef = useRef<HTMLAnchorElement>(null);
  const rawId = useId();
  const cls = `smear-${rawId.replace(/:/g, "")}`;

  const style = computeGlowStyle(data.recentColors, data.count, data.pageMax);

  // Detect whether the link wraps across multiple lines
  const [wraps, setWraps] = useState(false);
  useEffect(() => {
    const el = linkRef.current;
    if (!el) return;
    setWraps(el.getClientRects().length > 1);
  }, [children]);

  // Apply glow via shared rendering functions
  useEffect(() => {
    const el = linkRef.current;
    if (!el || !style) return;

    if (wraps) {
      applyInlineGlow(el, style);
    } else {
      applySingleLineGlow(el, cls);
    }
  }, [style, wraps, cls]);

  // Generate pseudo-element CSS for single-line links
  const cssRules = style && !wraps ? buildPseudoElementCSS(cls, style).join("\n") : "";

  return (
    <>
      {cssRules && <style>{cssRules}</style>}
      <a
        ref={linkRef}
        href="#"
        onClick={(e) => e.preventDefault()}
        style={{
          color: "#0645ad",
          textDecoration: "none",
          position: "relative",
        }}
      >
        <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
        {showCursors && <PassingCursors data={data} linkRef={linkRef} />}
      </a>
    </>
  );
}

function CursorSvg({
  color,
  opacity,
  scale,
}: {
  color: string;
  opacity: number;
  scale: number;
}) {
  return (
    <svg
      width={10 * scale}
      height={14 * scale}
      viewBox="0 0 10 14"
      fill="none"
      style={{ display: "block" }}
    >
      <path
        d="M1 1L1 11.5L3.5 9L5.5 13L7 12.3L5 8.3L8.5 8.3L1 1Z"
        fill={color}
        opacity={opacity}
        stroke="white"
        strokeWidth="0.5"
        strokeOpacity={opacity * 0.6}
      />
    </svg>
  );
}

function CursorsLink({
  children,
  data,
}: {
  href: string;
  children: React.ReactNode;
  data: LinkTraceData;
}) {
  const t = linkIntensity(data);
  const colors = data.recentColors;
  const visibleCount = Math.min(colors.length, Math.ceil(1 + t * 7));
  const linkRef = useRef<HTMLAnchorElement>(null);
  const [linkSize, setLinkSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (linkRef.current) {
      setLinkSize({
        w: linkRef.current.offsetWidth,
        h: linkRef.current.offsetHeight,
      });
    }
  }, [children]);

  // Place cursors in a loose orbit around the link bounding box.
  // Distribute by angle so they surround it — not just above.
  const positions = colors.slice(0, visibleCount).map((_, i) => {
    // Spread angles: start top-left, go clockwise, skip the pure-right zone (cursor tail obscures)
    const angleStep = (Math.PI * 2) / visibleCount;
    const angle = i * angleStep - Math.PI / 2; // start at top
    // Elliptical orbit sized to the link: rx wider than the text, ry above/below line-height
    const rx = linkSize.w / 2 + 10 + t * 6;
    const ry = linkSize.h / 2 + 8 + t * 4;
    const x = Math.cos(angle) * rx;
    const y = Math.sin(angle) * ry;
    return { x, y };
  });
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <style>{`
        @keyframes lt-drift-0 { from { transform: translateY(0px) rotate(-4deg); } to { transform: translateY(-3px) rotate(4deg); } }
        @keyframes lt-drift-1 { from { transform: translateY(-2px) rotate(6deg); } to { transform: translateY(2px) rotate(-3deg); } }
        @keyframes lt-drift-2 { from { transform: translateY(1px) rotate(-6deg); } to { transform: translateY(-3px) rotate(2deg); } }
      `}</style>
      {linkSize.w > 0 &&
        colors.slice(0, visibleCount).map((color, i) => {
          const scale = 0.8 + t * 0.3 - i * 0.04;
          const cursorW = 10 * scale;
          const cursorH = 14 * scale;
          return (
            <span
              key={i}
              aria-hidden
              style={{
                position: "absolute",
                // Center of link is at 50% x, ~50% y; offset by cursor half-size so hotspot centers
                left: `calc(50% + ${(positions[i].x - cursorW / 2).toFixed(
                  1,
                )}px)`,
                top: `calc(50% + ${(positions[i].y - cursorH / 2).toFixed(
                  1,
                )}px)`,
                pointerEvents: "none",
                zIndex: 2,
                animation: `lt-drift-${i % 3} ${
                  2.2 + i * 0.35
                }s ease-in-out infinite alternate`,
                animationDelay: `${i * 0.25}s`,
              }}
            >
              <CursorSvg
                color={color}
                opacity={(0.4 + t * 0.3) * (1 - i * 0.07)}
                scale={scale}
              />
            </span>
          );
        })}
      <a
        ref={linkRef}
        href="#"
        onClick={(e) => e.preventDefault()}
        style={{
          color: "#0645ad",
          textDecoration: "none",
          position: "relative",
          zIndex: 1,
        }}
      >
        {children}
      </a>
    </span>
  );
}

// Direction 3a: Faded — heavily visited links bleach, staying recognizably blue
// t=0: #0645ad (full link blue)  t=1: #6b9fd4 (lighter, still clearly a link)
function FadedLink({
  children,
  data,
}: {
  href: string;
  children: React.ReactNode;
  data: LinkTraceData;
}) {
  const t = linkIntensity(data);
  const r = Math.round(6 + t * (107 - 6));
  const g = Math.round(69 + t * (159 - 69));
  const b = Math.round(173 + t * (212 - 173));
  return (
    <a
      href="#"
      onClick={(e) => e.preventDefault()}
      style={{
        color: `rgb(${r}, ${g}, ${b})`,
        textDecoration: "none",
      }}
    >
      {children}
    </a>
  );
}

// Direction 3b: Bold — heavily visited links darken and gain weight, staying blue
// t=0: #0645ad 400  t=1: #022a6b 700
function BoldLink({
  children,
  data,
}: {
  href: string;
  children: React.ReactNode;
  data: LinkTraceData;
}) {
  const t = linkIntensity(data);
  const r = Math.round(6 + t * (2 - 6));
  const g = Math.round(69 + t * (42 - 69));
  const b = Math.round(173 + t * (107 - 173));
  const weight = Math.round(400 + t * 300);
  const spacing = (t * -0.02).toFixed(3);
  return (
    <a
      href="#"
      onClick={(e) => e.preventDefault()}
      style={{
        color: `rgb(${r}, ${g}, ${b})`,
        textDecoration: "none",
        fontWeight: weight,
        letterSpacing: `${spacing}em`,
      }}
    >
      {children}
    </a>
  );
}

function LinkDirectionSection({
  id,
  label,
  name,
  desc,
  renderLink,
}: {
  id: string;
  label: string;
  name: string;
  desc: string;
  renderLink: LtLinkRenderer;
}) {
  return (
    <div id={id} style={{ marginBottom: "48px" }}>
      <div style={{ marginBottom: "16px" }}>
        <div
          style={{
            fontFamily: "'Martian Mono', monospace",
            fontSize: "10px",
            letterSpacing: "0.12em",
            textTransform: "uppercase" as const,
            color: TEXT_MUTED,
            marginBottom: "4px",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: "18px",
            fontWeight: 600,
            color: TEXT,
            marginBottom: "4px",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: "12px",
            color: TEXT_MUTED,
            lineHeight: "1.5",
            maxWidth: "520px",
          }}
        >
          {desc}
        </div>
      </div>
      <WikiExcerpt renderLink={renderLink} />
    </div>
  );
}

function LinkTracesSection() {
  const [colorCount, setColorCount] = useState(6);

  function withColorCount(renderer: LtLinkRenderer): LtLinkRenderer {
    return (p) =>
      renderer({
        ...p,
        data: {
          ...p.data,
          recentColors: p.data.recentColors.slice(0, colorCount),
        },
      });
  }

  const CTRL_STYLE: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontFamily: "'Martian Mono', monospace",
    fontSize: "11px",
    color: TEXT_MUTED,
  };

  return (
    <div
      id="section-link-traces"
      style={{ padding: "0 40px 40px", maxWidth: "1200px" }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: "8px",
        }}
      >
        <div
          style={{
            fontFamily: "'Lora', Georgia, serif",
            fontSize: "22px",
            fontWeight: 600,
            color: TEXT,
          }}
        >
          Link traces
        </div>
        <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
          <label style={CTRL_STYLE}>
            colors
            <input
              type="range"
              min={1}
              max={8}
              value={colorCount}
              onChange={(e) => setColorCount(Number(e.target.value))}
              style={{ width: "60px", accentColor: TEAL }}
            />
            <span style={{ minWidth: "12px" }}>{colorCount}</span>
          </label>
          <label style={CTRL_STYLE}>
          </label>
        </div>
      </div>
      <div
        style={{
          fontSize: "12px",
          color: TEXT_MUTED,
          fontFamily: "'Atkinson Hyperlegible', sans-serif",
          marginBottom: "28px",
        }}
      >
        Visual treatments showing click-through history on Wikipedia-style links
        · links carry varied visit counts
      </div>
      <LinkDirectionSection
        id="section-lt-smear"
        label="Direction 1"
        name="Glow smear"
        desc="Color radiates from the letter shapes via text-shadow. Glow grows wider and more saturated with more visits."
        renderLink={withColorCount((p) => <SmearLink {...p} />)}
      />
      <LinkDirectionSection
        id="section-lt-smear-cursors"
        label="Direction 1 + cursors"
        name="Glow smear + passing cursors"
        desc="Same glow smear, with occasional cursors that drift across the link and fade out while passing through — 1, 2, or 3 depending on visit volume."
        renderLink={withColorCount((p) => <SmearLink {...p} showCursors />)}
      />
      <LinkDirectionSection
        id="section-lt-cursors"
        label="Direction 2"
        name="Orbiting cursors"
        desc="Cursors orbit the link in a ring, scaling with visit count."
        renderLink={(p) => <CursorsLink {...p} />}
      />
      <LinkDirectionSection
        id="section-lt-faded"
        label="Direction 3a"
        name="Faded"
        desc="Heavily visited links bleach out — the text lightens and desaturates, as if the ink has been worn away by many fingers passing over the same spot."
        renderLink={(p) => <FadedLink {...p} />}
      />
      <LinkDirectionSection
        id="section-lt-bold"
        label="Direction 3b"
        name="Bold"
        desc="Heavily visited links grow heavier and darker — the text gains weight and depth, as if the repeated attention has pressed the letters deeper into the page."
        renderLink={(p) => <BoldLink {...p} />}
      />
    </div>
  );
}

// ── Sidebar navigation ────────────────────────────────────────────────────────

type Section = "portrait-card" | "link-patina";

const PORTRAIT_NAV = [
  { id: "section-density", label: "density" },
  { id: "section-dir-a", label: "direction A" },
  { id: "section-dir-d", label: "direction D" },
  { id: "section-dir-e", label: "direction E" },
  { id: "section-dir-f", label: "direction F" },
  { id: "section-dir-g", label: "direction G" },
];

const LINK_PATINA_NAV = [
  { id: "section-lt-smear",         label: "glow smear" },
  { id: "section-lt-smear-cursors", label: "smear + cursors" },
  { id: "section-lt-cursors",       label: "orbit cursors" },
  { id: "section-lt-faded",         label: "faded" },
  { id: "section-lt-bold",          label: "bold" },
];

function SidebarNav({
  activeSection,
  onSectionChange,
}: {
  activeSection: Section;
  onSectionChange: (s: Section) => void;
}) {
  const [activeId, setActiveId] = useState<string>("");
  const navItems =
    activeSection === "portrait-card" ? PORTRAIT_NAV : LINK_PATINA_NAV;

  useEffect(() => {
    setActiveId("");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveId(entry.target.id);
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    for (const { id } of navItems) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [activeSection]);

  return (
    <nav className="sidebar-nav">
      {(["portrait-card", "link-patina"] as Section[]).map((s) => (
        <a
          key={s}
          href="#"
          className={`sidebar-nav__link${
            activeSection === s ? " sidebar-nav__link--active" : ""
          }`}
          style={{
            fontWeight: activeSection === s ? 700 : undefined,
            marginBottom: s === "portrait-card" ? "6px" : undefined,
          }}
          onClick={(e) => {
            e.preventDefault();
            onSectionChange(s);
            window.location.hash = s;
            window.scrollTo({ top: 0 });
          }}
        >
          {s === "portrait-card" ? "portrait card" : "link patina"}
        </a>
      ))}
      {activeSection !== "portrait-card" && (
        <div
          style={{
            height: "1px",
            background: "rgba(90,78,65,0.12)",
            margin: "4px 8px 6px",
          }}
        />
      )}
      {activeSection === "portrait-card" && (
        <div
          style={{
            height: "1px",
            background: "rgba(90,78,65,0.12)",
            margin: "4px 8px 6px",
          }}
        />
      )}
      {navItems.map(({ id, label }) => (
        <a
          key={id}
          href={`#${id}`}
          className={`sidebar-nav__link${
            activeId === id ? " sidebar-nav__link--active" : ""
          }`}
          onClick={(e) => {
            e.preventDefault();
            document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
            setActiveId(id);
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}

function PreviewPage() {
  const [data, setData] = useState<MockData>(INITIAL_MOCK);
  const [colorful, setColorful] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>(() => {
    const hash = window.location.hash.slice(1);
    return hash === "link-patina" ? "link-patina" : "portrait-card";
  });

  return (
    <div className="page-layout">
      <SidebarNav
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />
      <div className="page-main">
        <div className="page-header">
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "24px",
            }}
          >
            <div>
              <div className="page-title">
                {activeSection === "portrait-card"
                  ? "portrait card — design directions"
                  : "link patina — design directions"}
              </div>
              <div className="page-subtitle">
                {activeSection === "portrait-card"
                  ? "six layout directions · same data across all variants"
                  : "three visual treatments · links carry varied visit counts"}
              </div>
              {activeSection === "portrait-card" && (
                <div className="mock-note">
                  {data.domain} · {formatDuration(data.totalMs)} ·{" "}
                  {data.dateRange} · {data.uniquePages} pages ·{" "}
                  {peakProfileLabel(data.sessions)}
                </div>
              )}
            </div>
            {activeSection === "portrait-card" && (
              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  marginTop: "4px",
                  flexShrink: 0,
                }}
              >
                <button
                  onClick={() => setColorful((c) => !c)}
                  style={{
                    ...BTN_STYLE,
                    color: colorful ? TEAL : TEXT_MUTED,
                    borderColor: colorful ? TEAL : BORDER_STRONG,
                  }}
                >
                  {colorful ? "riso on" : "riso off"}
                </button>
                <button
                  onClick={() => setData(generateMockData())}
                  style={BTN_STYLE}
                >
                  randomize
                </button>
              </div>
            )}
          </div>
        </div>

        {activeSection === "portrait-card" && (
          <>
            {/* Density scaling — VariantA at different time amounts */}
            <div
              id="section-density"
              style={{ padding: "0 40px 40px", maxWidth: "1200px" }}
            >
              <div
                style={{
                  fontFamily: "'Lora', Georgia, serif",
                  fontSize: "22px",
                  fontWeight: 600,
                  color: TEXT,
                  marginBottom: "8px",
                }}
              >
                Density scaling
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: TEXT_MUTED,
                  fontFamily: "'Atkinson Hyperlegible', sans-serif",
                  marginBottom: "28px",
                }}
              >
                How texture density grows with accumulated time (VariantA)
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "32px",
                }}
              >
                {DENSITY_DATA.map(({ label, data }) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "24px",
                    }}
                  >
                    <div
                      style={{
                        width: "60px",
                        flexShrink: 0,
                        fontFamily: "'Martian Mono', monospace",
                        fontSize: "13px",
                        fontWeight: 500,
                        color: TEXT_MUTED,
                        textAlign: "right",
                      }}
                    >
                      {label}
                    </div>
                    <VariantA data={data} colorful={false} />
                    <VariantA data={data} colorful={true} />
                  </div>
                ))}
              </div>
            </div>

            <div className="variants-grid">
              <div id="section-dir-a" className="variant">
                <div>
                  <div className="variant-label">Direction A</div>
                  <div className="variant-name">Minimal + vertical texture</div>
                  <div className="variant-desc">
                    Vertical strokes mapped to the 24h timeline — dense columns
                    where you were active, light or dark based on time of day.
                  </div>
                </div>
                <VariantA data={data} colorful={colorful} />
              </div>
              {OTHER_VARIANTS.map(({ id, label, name, desc, Component }) => (
                <div id={id} className="variant" key={label}>
                  <div>
                    <div className="variant-label">{label}</div>
                    <div className="variant-name">{name}</div>
                    <div className="variant-desc">{desc}</div>
                  </div>
                  <Component data={data} colorful={colorful} />
                </div>
              ))}
            </div>
          </>
        )}

        {activeSection === "link-patina" && <LinkTracesSection />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(
  <>
    <Agentation />
    <PreviewPage />
  </>,
);
