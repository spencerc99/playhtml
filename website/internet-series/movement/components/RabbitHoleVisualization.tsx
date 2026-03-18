// ABOUTME: Visualization component for the Wikipedia rabbit hole page
// ABOUTME: Three modes: step (DOM transitions), scroll (canvas rAF), wall (continuous text)

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
  availableDates: string[];
  dateCounts: Map<string, number>;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const STEP_SPEED_PRESETS = {
  slow: 3000,
  normal: 2000,
  fast: 800,
} as const;

// Continuous scroll mode: pixels per second
const SCROLL_SPEED_PRESETS = {
  slow: 30,
  normal: 60,
  fast: 140,
} as const;

// Wall mode: ms between title reveals / title advances during scroll
const WALL_SPEED_PRESETS = {
  slow: 300,
  normal: 100,
  fast: 30,
} as const;

const WALL_FONT_MIN = 10;
const WALL_FONT_MAX = 72;
const WALL_LINE_HEIGHT = 1.3;
const WALL_GAP = "   ";  // spacing between titles

type SpeedKey = keyof typeof STEP_SPEED_PRESETS;
type Mode = "step" | "scroll" | "wall";

const STORAGE_KEY = "rabbithole-settings";
const VALID_MODES: Mode[] = ["step", "scroll", "wall"];
const VALID_SPEEDS: SpeedKey[] = ["slow", "normal", "fast"];

function loadSettings(): { mode: Mode; speed: SpeedKey } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        mode: VALID_MODES.includes(parsed.mode) ? parsed.mode : "step",
        speed: VALID_SPEEDS.includes(parsed.speed) ? parsed.speed : "normal",
      };
    }
  } catch { /* ignore */ }
  return { mode: "step", speed: "normal" };
}

function saveSettings(mode: Mode, speed: SpeedKey) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode, speed }));
  } catch { /* ignore */ }
}

const RANDOMIZE_ORDER = false;

const VISIBLE_COUNT = 10;
const FONT_SIZE_MAX = 64;
const FONT_SIZE_MIN = 16;
const STAGE_BOTTOM_OFFSET = 60;
const STAGE_TOP_OFFSET = 40;
const SCROLL_FONT_SIZE_BASE = 140;
const SCROLL_FONT_SIZE_MIN = 24;
const SCROLL_ROW_LINE_HEIGHT = 0.72;
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
    d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (fmt(min) === fmt(max)) return fmt(min);
  return `${fmt(min)} – ${fmt(max)}`;
}


function wikiUrl(entry: WikiTitle): string {
  return entry.url ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(entry.title.replace(/ /g, "_"))}`;
}

// ── Dev mode detection ─────────────────────────────────────────────────────────

function isDevMode(): boolean {
  return new URLSearchParams(window.location.search).has("dev");
}

// ── Component ──────────────────────────────────────────────────────────────────

export const RabbitHoleVisualization: React.FC<Props> = ({
  titles,
  dataStats,
  loading,
  error,
  wikipediaOnly,
  onToggleWikipediaOnly,
  onRefresh,
  availableDates,
  dateCounts,
  selectedDate,
  onSelectDate,
}) => {
  const savedSettings = useMemo(() => loadSettings(), []);
  const [speed, setSpeed] = useState<SpeedKey>(savedSettings.speed);
  const [mode, setMode] = useState<Mode>(savedSettings.mode);
  const [wallRevealed, setWallRevealed] = useState(0);
  const isDev = useMemo(() => isDevMode(), []);

  // Step mode state
  const [currentIndex, setCurrentIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Shared canvas + rAF refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  // Scroll mode refs
  const scrollOffsetPxRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  // Wall mode refs
  const wallRevealedRef = useRef<number>(0);
  const wallTimerRef = useRef<number>(0);
  const wallStartIdxRef = useRef<number>(0);
  const wallLastTimeRef = useRef<number | null>(null);
  const wallSpeedRef = useRef(speed);
  const wallFontSizeRef = useRef<number>(28);

  // Stable refs so closures always see current values
  const titlesRef = useRef(titles);
  const speedRef = useRef(speed);
  const stageHeightRef = useRef(0);

  const [stageHeight, setStageHeight] = useState(
    window.innerHeight - STAGE_TOP_OFFSET - STAGE_BOTTOM_OFFSET - 44,
  );

  useEffect(() => { stageHeightRef.current = stageHeight; }, [stageHeight]);
  useEffect(() => { speedRef.current = speed; wallSpeedRef.current = speed; wallTimerRef.current = 0; }, [speed]);

  // Persist settings to localStorage
  useEffect(() => { saveSettings(mode, speed); }, [mode, speed]);

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
    const handle = () => {
      const h = window.innerHeight - STAGE_TOP_OFFSET - STAGE_BOTTOM_OFFSET - 44;
      setStageHeight(h);
      stageHeightRef.current = h;
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = h;
      }
    };
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);

  // ── Step mode interval ─────────────────────────────────────────────────────

  useEffect(() => {
    if (mode !== "step" || titles.length === 0) return;
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % titles.length);
    }, STEP_SPEED_PRESETS[speed]);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [mode, titles.length, speed]);

  // ── Scroll mode rAF loop ───────────────────────────────────────────────────

  useEffect(() => {
    if (mode !== "scroll") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = stageHeightRef.current;
    lastTimeRef.current = null;

    const tick = (now: number) => {
      const titles = titlesRef.current;
      if (titles.length === 0) { rafRef.current = requestAnimationFrame(tick); return; }

      if (lastTimeRef.current !== null) {
        const dt = (now - lastTimeRef.current) / 1000;
        scrollOffsetPxRef.current += SCROLL_SPEED_PRESETS[speedRef.current] * dt;
      }
      lastTimeRef.current = now;

      const ctx = canvas.getContext("2d");
      if (!ctx) { rafRef.current = requestAnimationFrame(tick); return; }

      const W = canvas.width;
      const H = canvas.height;
      const centerY = H / 2;
      const halfStage = stageHeightRef.current / 2;
      const baseFontSize = Math.max(SCROLL_FONT_SIZE_MIN, Math.round(SCROLL_FONT_SIZE_BASE * (W / 1440)));
      const rowHeight = Math.round(baseFontSize * SCROLL_ROW_LINE_HEIGHT);

      ctx.clearRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const totalRowsScrolled = scrollOffsetPxRef.current / rowHeight;
      const intPart = Math.floor(totalRowsScrolled);
      const fracPx = (totalRowsScrolled - intPart) * rowHeight;
      const visibleRadius = Math.ceil(halfStage / rowHeight) + 2;

      for (let i = -visibleRadius; i <= visibleRadius; i++) {
        const yOffset = i * rowHeight + fracPx;
        const yAbs = centerY + yOffset;
        const distPx = Math.abs(yOffset);
        const t = Math.min(distPx / halfStage, 1);
        const opacity = lerp(1, 0.5, t * t);
        if (opacity < 0.02) continue;

        const titleIdx = (((intPart - i) % titles.length) + titles.length) % titles.length;
        const title = titles[titleIdx].title;

        let fontSize = baseFontSize;
        ctx.font = `700 ${fontSize}px 'Lora', 'Georgia', serif`;
        const targetW = W * TITLE_FILL_RATIO;
        const naturalW = ctx.measureText(title).width;
        if (naturalW > targetW) {
          fontSize = Math.max(SCROLL_FONT_SIZE_MIN, Math.floor(fontSize * (targetW / naturalW)));
          ctx.font = `700 ${fontSize}px 'Lora', 'Georgia', serif`;
        }

        ctx.globalAlpha = opacity;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(title, W / 2, yAbs);
      }

      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    const handleCanvasClick = (e: MouseEvent) => {
      const titles = titlesRef.current;
      if (titles.length === 0 || !canvasRef.current) return;
      const W = canvasRef.current.width;
      const H = canvasRef.current.height;
      const centerY = H / 2;
      const baseFontSize = Math.max(SCROLL_FONT_SIZE_MIN, Math.round(SCROLL_FONT_SIZE_BASE * (W / 1440)));
      const rowHeight = Math.round(baseFontSize * SCROLL_ROW_LINE_HEIGHT);
      const totalRowsScrolled = scrollOffsetPxRef.current / rowHeight;
      const intPart = Math.floor(totalRowsScrolled);
      const fracPx = (totalRowsScrolled - intPart) * rowHeight;
      const i = Math.round((e.offsetY - centerY - fracPx) / rowHeight);
      const titleIdx = (((intPart - i) % titles.length) + titles.length) % titles.length;
      window.open(wikiUrl(titles[titleIdx]), "_blank", "noopener,noreferrer");
    };

    canvas.style.cursor = "pointer";
    canvas.addEventListener("click", handleCanvasClick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("click", handleCanvasClick);
    };
  }, [mode]);

  // ── Wall mode rAF loop ────────────────────────────────────────────────────

  // Find the font size where the text fills the viewport as a tight rectangle.
  // We want the text to just barely overflow rather than leaving empty rows,
  // so the last visible row is always full or nearly full.
  const fitFontSize = useCallback((
    ctx: CanvasRenderingContext2D,
    text: string,
    W: number,
    H: number,
    padding: number,
  ): number => {
    // For each candidate font size, measure how well the text fills the viewport.
    // We want: textLines ~= maxLines. Prefer slight overflow (textLines > maxLines)
    // over significant underfill (textLines << maxLines).
    let bestSize = WALL_FONT_MIN;
    let bestScore = Infinity;

    for (let size = WALL_FONT_MIN; size <= WALL_FONT_MAX; size++) {
      const lineH = size * WALL_LINE_HEIGHT;
      ctx.font = `700 ${size}px 'Lora', 'Georgia', serif`;

      let curX = padding;
      let lines = 1;
      for (let i = 0; i < text.length; i++) {
        const cw = ctx.measureText(text[i]).width;
        if (curX + cw > W - padding && curX > padding) {
          curX = padding;
          lines++;
        }
        curX += cw;
      }

      const maxLines = Math.floor((H - padding) / lineH);
      if (maxLines < 1) continue;

      // How far off from a perfect fill? Negative = overflow, positive = underfill.
      const diff = maxLines - lines;

      // Score: prefer slight overflow (diff = -1 or 0) over underfill (diff = +3).
      // Penalize underfill more heavily than overflow.
      const score = diff >= 0 ? diff * 2 : Math.abs(diff);

      if (score < bestScore || (score === bestScore && size > bestSize)) {
        bestScore = score;
        bestSize = size;
      }
    }

    return bestSize;
  }, []);

  useEffect(() => {
    if (mode !== "wall") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = stageHeightRef.current;

    wallRevealedRef.current = 0;
    wallTimerRef.current = 0;
    wallStartIdxRef.current = 0;
    wallLastTimeRef.current = null;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Compute the optimal font size for the full set of titles.
    // We do this once when the effect starts and reuse it.
    const allTitles = titlesRef.current;
    const fullText = allTitles.map(t => t.title).join(WALL_GAP);
    const padding = 12;
    if (fullText.length > 0) {
      wallFontSizeRef.current = fitFontSize(ctx, fullText, canvas.width, canvas.height, padding);
    }

    const tick = (now: number) => {
      const titles = titlesRef.current;
      if (titles.length === 0) { rafRef.current = requestAnimationFrame(tick); return; }

      const dt = wallLastTimeRef.current !== null
        ? Math.min((now - wallLastTimeRef.current) / 1000, 0.05)
        : 0;
      wallLastTimeRef.current = now;

      const spd = wallSpeedRef.current;
      const interval = WALL_SPEED_PRESETS[spd];

      // Timer drives both phases: reveal (add one title) and scroll (shift start by one title)
      wallTimerRef.current += dt * 1000;

      const prevRevealed = wallRevealedRef.current;
      const allRevealed = wallRevealedRef.current >= titles.length;

      if (!allRevealed) {
        while (wallTimerRef.current >= interval && wallRevealedRef.current < titles.length) {
          wallTimerRef.current -= interval;
          wallRevealedRef.current++;
        }
        if (wallRevealedRef.current !== prevRevealed) {
          setWallRevealed(wallRevealedRef.current);
        }
      } else {
        // Scroll at 1/3 the reveal speed
        const scrollInterval = interval * 3;
        while (wallTimerRef.current >= scrollInterval) {
          wallTimerRef.current -= scrollInterval;
          wallStartIdxRef.current = (wallStartIdxRef.current + 1) % titles.length;
        }
      }

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      const fontSize = wallFontSizeRef.current;
      const lineH = fontSize * WALL_LINE_HEIGHT;
      ctx.font = `700 ${fontSize}px 'Lora', 'Georgia', serif`;
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";

      // Build the visible text from the current starting title.
      // During reveal, show titles one at a time (no repeat).
      // During scroll, loop to fill the viewport.
      const startIdx = allRevealed ? wallStartIdxRef.current : 0;
      const revealedCount = allRevealed ? titles.length : wallRevealedRef.current;

      let curX = padding;
      let curY = padding;
      let i = 0;
      let done = false;

      if (revealedCount === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      while (!done) {
        // During reveal, stop after showing each revealed title once
        if (!allRevealed && i >= revealedCount) break;

        const ti = (startIdx + (i % titles.length)) % titles.length;
        const titleText = titles[ti].title + WALL_GAP;

        for (let ci = 0; ci < titleText.length; ci++) {
          const ch = titleText[ci];
          const cw = ctx.measureText(ch).width;
          if (curX + cw > W - padding && curX > padding) {
            curX = padding;
            curY += lineH;
            if (curY + lineH > H) { done = true; break; }
          }
          ctx.fillText(ch, curX, curY);
          curX += cw;
        }

        i++;
      }

      // Stash layout info for click handler
      (canvas as any).__wallState = { startIdx, fontSize, padding };

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    // Click handler: replay layout to find which title was clicked
    const handleCanvasClick = (e: MouseEvent) => {
      const titles = titlesRef.current;
      if (titles.length === 0) return;

      const state = (canvas as any).__wallState;
      if (!state) return;

      const { startIdx, fontSize, padding: pad } = state;
      const lineH = fontSize * WALL_LINE_HEIGHT;
      const W = canvas.width;
      const H = canvas.height;
      const allRevealed = wallRevealedRef.current >= titles.length;
      const revealedCount = allRevealed ? titles.length : wallRevealedRef.current;

      if (revealedCount === 0) return;

      ctx.font = `700 ${fontSize}px 'Lora', 'Georgia', serif`;

      const clickX = e.offsetX;
      const clickY = e.offsetY;

      let curX = pad;
      let curY = pad;
      let i = 0;
      let done = false;

      while (!done) {
        if (!allRevealed && i >= revealedCount) break;

        const ti = (startIdx + (i % titles.length)) % titles.length;
        const titleText = titles[ti].title + WALL_GAP;
        let hitInThisTitle = false;

        for (let ci = 0; ci < titleText.length; ci++) {
          const ch = titleText[ci];
          const cw = ctx.measureText(ch).width;
          if (curX + cw > W - pad && curX > pad) {
            curX = pad;
            curY += lineH;
            if (curY + lineH > H) { done = true; break; }
          }
          if (ci < titles[ti].title.length &&
              clickY >= curY && clickY < curY + lineH &&
              clickX >= curX && clickX < curX + cw) {
            hitInThisTitle = true;
          }
          curX += cw;
        }

        if (hitInThisTitle) {
          window.open(wikiUrl(titles[ti]), "_blank", "noopener,noreferrer");
          return;
        }
        i++;
      }
    };

    canvas.style.cursor = "pointer";
    canvas.addEventListener("click", handleCanvasClick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("click", handleCanvasClick);
    };
  }, [mode, titles, fitFontSize]);

  // Reset step/scroll counters on fresh titles
  useEffect(() => {
    setCurrentIndex(0);
    scrollOffsetPxRef.current = 0;
  }, [titles]);

  const handleSpeedChange = useCallback((key: SpeedKey) => setSpeed(key), []);
  const handleModeChange = useCallback((m: Mode) => setMode(m), []);

  // ── Step mode render slots ─────────────────────────────────────────────────

  const stepSlots = React.useMemo(() => {
    const t = titlesRef.current;
    if (t.length === 0 || mode !== "step") return [];
    return Array.from({ length: VISIBLE_COUNT }, (_, slot) => {
      const titleIdx = (((currentIndex - slot) % t.length) + t.length) % t.length;
      const entry = t[titleIdx];
      return { slot, title: entry.title, url: wikiUrl(entry) };
    });
  }, [titles, currentIndex, mode]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div id="rabbithole-root">
      <div style={{ width: "100%", height: "100%", position: "relative" }}>
        {mode !== "wall" && <div className="vignette vignette-top" />}
        {mode !== "wall" && <div className="vignette vignette-bottom" />}

        {loading && titles.length === 0 && (
          <div className="empty-state">fetching wikipedia visits…</div>
        )}
        {!loading && titles.length === 0 && !error && (
          <div className="empty-state">no wikipedia visits found</div>
        )}
        {error && titles.length === 0 && (
          <div className="empty-state" style={{ color: "#c4724e" }}>{error}</div>
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
              color: "#ffffff",
              transition: "top 0.6s ease-out, opacity 0.6s ease-out, font-size 0.6s ease-out",
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

        {/* Scroll + wall modes — canvas driven by rAF */}
        {(mode === "scroll" || mode === "wall") && (
          <canvas
            ref={canvasRef}
            style={{ position: "absolute", top: STAGE_TOP_OFFSET, left: 0, pointerEvents: "auto" }}
          />
        )}
      </div>

      {/* ── Bottom info bar ── */}
      <div className="info-bar">
        <span className="info-label">wikipedia rabbit hole</span>

        {!loading && titles.length > 0 && mode !== "wall" && (
          <>
            <span className="info-stat">{titles.length.toLocaleString()} pages</span>
            <span className="info-stat" style={{ color: "#3e3a36" }}>·</span>
            <span className="info-stat">{formatDateRange(titles)}</span>
          </>
        )}

        {mode === "wall" && !loading && titles.length > 0 && (
          <span className="info-stat">
            {wallRevealed} / {titles.length}
            {wallRevealed === titles.length && " — scrolling"}
          </span>
        )}

        {loading && <span className="info-loading">fetching…</span>}
        {error && <span className="info-error" title={error}>error</span>}

        <span className="speed-control">
          {(["step", "scroll", "wall"] as Mode[]).map((m) => (
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

        {availableDates.length > 1 && (
          <span className="speed-control">
            <select
              className="date-select"
              value={selectedDate ?? ""}
              onChange={(e) => onSelectDate(e.target.value || null)}
            >
              <option value="">all dates ({[...dateCounts.values()].reduce((a, b) => a + b, 0)})</option>
              {availableDates.map((d) => (
                <option key={d} value={d}>{d} ({dateCounts.get(d) ?? 0})</option>
              ))}
            </select>
          </span>
        )}

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

        <button className="refresh-btn" onClick={onRefresh} disabled={loading}>↺</button>
      </div>
    </div>
  );
};
