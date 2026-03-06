// ABOUTME: Visualization component for the Wikipedia rabbit hole page
// ABOUTME: Animates page titles falling down the screen in step or continuous scroll mode

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WikiTitle {
  title: string;
  ts: number;
  url?: string;
}

interface DataStats {
  totalFocusEvents: number;
  wikiEvents: number;
  nonWikiEvents: number;
}

interface Props {
  titles: WikiTitle[];
  dataStats: DataStats | null;
  loading: boolean;
  error: string | null;
  wikipediaOnly: boolean;
  onToggleWikipediaOnly: () => void;
  onRefresh: () => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STEP_SPEED_PRESETS = {
  slow: 3000,
  normal: 2000,
  fast: 800,
} as const;

// Continuous mode: pixels per second each title scrolls downward
const SCROLL_SPEED_PRESETS = {
  slow: 30,
  normal: 60,
  fast: 140,
} as const;

type SpeedKey = keyof typeof STEP_SPEED_PRESETS;
type Mode = "step" | "scroll";

// Set to true to shuffle titles into a random order instead of chronological
const RANDOMIZE_ORDER = true;

const VISIBLE_COUNT = 10;
const FONT_SIZE_MAX = 64;
const FONT_SIZE_MIN = 16;
const STAGE_BOTTOM_OFFSET = 60;
const STAGE_TOP_OFFSET = 40;
// Base font size for a 1440px-wide desktop — scales linearly with viewport width
const SCROLL_FONT_SIZE_BASE = 140;
const SCROLL_FONT_SIZE_MIN = 24; // floor so tiny mobile titles stay legible
// Row height as a ratio of font size — less than 1.0 causes titles to overlap
const SCROLL_ROW_LINE_HEIGHT = 0.72;
// Titles fill this fraction of canvas width before we start shrinking the font
const TITLE_FILL_RATIO = 0.92;

// ── Helpers ────────────────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function slotFraction(index: number): number {
  return index / (VISIBLE_COUNT - 1);
}

function formatDateRange(titles: WikiTitle[]): string {
  if (titles.length === 0) return "";
  const tss = titles.map((t) => t.ts);
  const min = new Date(Math.min(...tss));
  const max = new Date(Math.max(...tss));
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  if (fmt(min) === fmt(max)) return fmt(min);
  return `${fmt(min)} – ${fmt(max)}`;
}

// ── Component ──────────────────────────────────────────────────────────────────

// ── Dev mode detection ─────────────────────────────────────────────────────────

function isDevMode(): boolean {
  return new URLSearchParams(window.location.search).has("dev");
}

export const RabbitHoleVisualization: React.FC<Props> = ({
  titles,
  dataStats,
  loading,
  error,
  wikipediaOnly,
  onToggleWikipediaOnly,
  onRefresh,
}) => {
  const [speed, setSpeed] = useState<SpeedKey>("normal");
  const [mode, setMode] = useState<Mode>("step");
  const isDev = useMemo(() => isDevMode(), []);

  // Step mode state
  const [currentIndex, setCurrentIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Canvas scroll mode refs — never touch React state during animation
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollOffsetPxRef = useRef(0); // absolute pixel offset, grows forever
  const lastTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  // Stable refs so the rAF closure always sees current values without restarts
  // When RANDOMIZE_ORDER is true, titles are shuffled once on load
  const titlesRef = useRef(titles);
  const speedRef = useRef(speed);
  const stageHeightRef = useRef(0);

  const [stageHeight, setStageHeight] = useState(
    window.innerHeight - STAGE_TOP_OFFSET - STAGE_BOTTOM_OFFSET - 44,
  );

  useEffect(() => {
    stageHeightRef.current = stageHeight;
  }, [stageHeight]);

  useEffect(() => {
    if (!RANDOMIZE_ORDER) {
      titlesRef.current = titles;
    } else {
      const shuffled = [...titles];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      titlesRef.current = shuffled;
    }
  }, [titles]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    const handle = () => {
      const h =
        window.innerHeight - STAGE_TOP_OFFSET - STAGE_BOTTOM_OFFSET - 44;
      setStageHeight(h);
      stageHeightRef.current = h;
      // Resize canvas immediately
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = h;
      }
    };
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);

  // Step mode interval
  useEffect(() => {
    if (mode !== "step" || titles.length === 0) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % titles.length);
    }, STEP_SPEED_PRESETS[speed]);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [mode, titles.length, speed]);

  // Canvas scroll rAF loop — draws directly, zero React state updates
  useEffect(() => {
    if (mode !== "scroll") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = stageHeightRef.current;
    lastTimeRef.current = null;

    const tick = (now: number) => {
      const titles = titlesRef.current;
      if (titles.length === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (lastTimeRef.current !== null) {
        const dt = (now - lastTimeRef.current) / 1000;
        scrollOffsetPxRef.current +=
          SCROLL_SPEED_PRESETS[speedRef.current] * dt;
      }
      lastTimeRef.current = now;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const W = canvas.width;
      const H = canvas.height;
      const centerY = H / 2;
      const halfStage = stageHeightRef.current / 2;

      // Responsive base font size — scales with viewport width relative to 1440px desktop
      const baseFontSize = Math.max(
        SCROLL_FONT_SIZE_MIN,
        Math.round(SCROLL_FONT_SIZE_BASE * (W / 1440)),
      );
      const rowHeight = Math.round(baseFontSize * SCROLL_ROW_LINE_HEIGHT);

      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // How many rows have scrolled past (fractional)
      const totalRowsScrolled = scrollOffsetPxRef.current / rowHeight;
      const intPart = Math.floor(totalRowsScrolled);
      const fracPx = (totalRowsScrolled - intPart) * rowHeight;

      const visibleRadius = Math.ceil(halfStage / rowHeight) + 2;

      for (let i = -visibleRadius; i <= visibleRadius; i++) {
        // y position relative to canvas center, drifting downward as fracPx grows
        const yOffset = i * rowHeight + fracPx;
        const yAbs = centerY + yOffset;

        // fade based on distance from center
        const distPx = Math.abs(yOffset);
        const t = Math.min(distPx / halfStage, 1);
        const opacity = lerp(1, 0.5, t * t);
        if (opacity < 0.02) continue;

        // title index: slot 0 (center) shows intPart; negative i = above = older
        const titleIdx =
          (((intPart - i) % titles.length) + titles.length) % titles.length;
        const title = titles[titleIdx].title;

        // Scale font down so title fills TITLE_FILL_RATIO of canvas width
        // Start at base size, shrink until it fits, never go below min
        let fontSize = baseFontSize;
        ctx.font = `700 ${fontSize}px 'Lora', 'Georgia', serif`;
        const targetW = W * TITLE_FILL_RATIO;
        const naturalW = ctx.measureText(title).width;
        if (naturalW > targetW) {
          fontSize = Math.max(
            SCROLL_FONT_SIZE_MIN,
            Math.floor(fontSize * (targetW / naturalW)),
          );
          ctx.font = `700 ${fontSize}px 'Lora', 'Georgia', serif`;
        }

        ctx.globalAlpha = opacity;
        ctx.fillStyle = "#e8e0d8";
        ctx.fillText(title, W / 2, yAbs);
      }

      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    // Click handler: resolve which title row was clicked and open its URL
    const handleCanvasClick = (e: MouseEvent) => {
      const titles = titlesRef.current;
      if (titles.length === 0) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const W = canvas.width;
      const H = canvas.height;
      const centerY = H / 2;
      const baseFontSize = Math.max(
        SCROLL_FONT_SIZE_MIN,
        Math.round(SCROLL_FONT_SIZE_BASE * (W / 1440)),
      );
      const rowHeight = Math.round(baseFontSize * SCROLL_ROW_LINE_HEIGHT);

      const totalRowsScrolled = scrollOffsetPxRef.current / rowHeight;
      const intPart = Math.floor(totalRowsScrolled);
      const fracPx = (totalRowsScrolled - intPart) * rowHeight;

      // Determine which row the click landed in
      const clickY = e.offsetY;
      const yRelCenter = clickY - centerY;
      // Inverse of: yOffset = i * rowHeight + fracPx  →  i = (yRelCenter - fracPx) / rowHeight
      const i = Math.round((yRelCenter - fracPx) / rowHeight);
      const titleIdx = (((intPart - i) % titles.length) + titles.length) % titles.length;
      const entry = titles[titleIdx];
      const url = entry.url ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(entry.title.replace(/ /g, "_"))}`;
      window.open(url, "_blank", "noopener,noreferrer");
    };

    canvas.style.cursor = "pointer";
    canvas.addEventListener("click", handleCanvasClick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("click", handleCanvasClick);
    };
  }, [mode]); // only restart when mode changes; speed/titles/linksEnabled read via refs

  // Reset on fresh titles
  useEffect(() => {
    setCurrentIndex(0);
    scrollOffsetPxRef.current = 0;
  }, [titles]);

  const handleSpeedChange = useCallback((key: SpeedKey) => setSpeed(key), []);
  const handleModeChange = useCallback((m: Mode) => setMode(m), []);

  // ── Step mode render ──────────────────────────────────────────────────────────

  const stepSlots = React.useMemo(() => {
    const t = titlesRef.current;
    if (t.length === 0 || mode !== "step") return [];
    return Array.from({ length: VISIBLE_COUNT }, (_, slot) => {
      const titleIdx =
        (((currentIndex - slot) % t.length) + t.length) % t.length;
      const entry = t[titleIdx];
      const url = entry.url ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(entry.title.replace(/ /g, "_"))}`;
      return { slot, title: entry.title, url };
    });
  }, [titles, currentIndex, mode]);

  return (
    <div id="rabbithole-root">
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        <div className="vignette vignette-top" />
        <div className="vignette vignette-bottom" />

        {loading && titles.length === 0 && (
          <div className="empty-state">fetching wikipedia visits…</div>
        )}
        {!loading && titles.length === 0 && !error && (
          <div className="empty-state">no wikipedia visits found</div>
        )}
        {error && titles.length === 0 && (
          <div className="empty-state" style={{ color: "#c4724e" }}>
            {error}
          </div>
        )}

        {/* Step mode — DOM elements with CSS transitions */}
        {mode === "step" &&
          stepSlots.map(({ slot, title, url }) => {
            const t = slotFraction(slot);
            const fontSize = lerp(FONT_SIZE_MAX, FONT_SIZE_MIN, t);
            const opacity = lerp(1, 0.04, t);
            const yPx = STAGE_TOP_OFFSET + t * stageHeight;
            const sharedStyle: React.CSSProperties = {
              top: `${yPx}px`,
              fontSize: `${fontSize}px`,
              opacity,
              color: slot === 0 ? "#faf7f2" : "#e8e0d8",
              transition:
                "top 0.6s ease-out, opacity 0.6s ease-out, font-size 0.6s ease-out",
              zIndex: VISIBLE_COUNT - slot,
            };
            return (
              <a
                key={slot}
                className="title-entry"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...sharedStyle, textDecoration: "none", cursor: "pointer" }}
              >
                {title}
              </a>
            );
          })}

        {/* Continuous scroll mode — canvas driven by rAF, no React state */}
        {mode === "scroll" && (
          <canvas
            ref={canvasRef}
            style={{
              position: "absolute",
              top: STAGE_TOP_OFFSET,
              left: 0,
              pointerEvents: "auto",
            }}
          />
        )}
      </div>

      {/* ── Bottom info bar ── */}
      <div className="info-bar">
        <span className="info-label">wikipedia rabbit hole</span>

        {!loading && titles.length > 0 && (
          <>
            <span className="info-stat">
              {titles.length.toLocaleString()} pages
            </span>
            <span className="info-stat" style={{ color: "#3e3a36" }}>
              ·
            </span>
            <span className="info-stat">{formatDateRange(titles)}</span>
          </>
        )}

        {loading && <span className="info-loading">fetching…</span>}
        {error && (
          <span className="info-error" title={error}>
            error
          </span>
        )}

        <span className="speed-control">
          {(["step", "scroll"] as Mode[]).map((m) => (
            <button
              key={m}
              className={`speed-btn${mode === m ? " active" : ""}`}
              onClick={() => handleModeChange(m)}
            >
              {m}
            </button>
          ))}
        </span>

        <span className="speed-control">
          speed
          {(["slow", "normal", "fast"] as SpeedKey[]).map((key) => (
            <button
              key={key}
              className={`speed-btn${speed === key ? " active" : ""}`}
              onClick={() => handleSpeedChange(key)}
            >
              {key}
            </button>
          ))}
        </span>

        {isDev && (
          <span className="speed-control">
            <button
              className={`speed-btn${wikipediaOnly ? " active" : ""}`}
              onClick={onToggleWikipediaOnly}
              title="Toggle between Wikipedia-only and all browsed sites"
            >
              {wikipediaOnly ? "wikipedia only" : "all sites"}
            </button>
          </span>
        )}

        {isDev && !wikipediaOnly && dataStats && (
          <span
            className="info-stat"
            title={`${dataStats.wikiEvents} wikipedia · ${dataStats.nonWikiEvents} other sites`}
            style={{ opacity: 0.5, fontSize: "11px", cursor: "help" }}
          >
            {dataStats.wikiEvents}w + {dataStats.nonWikiEvents}o
          </span>
        )}

        <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
          ↺
        </button>
      </div>
    </div>
  );
};
