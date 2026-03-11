// ABOUTME: Visualization component for the Wikipedia rabbit hole page
// ABOUTME: Three modes: step (DOM transitions), scroll (canvas rAF), pile (physics canvas)

import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WikiTitle {
  title: string;
  ts: number;
  url?: string;
}

// Internal state for a word in pile physics mode
interface PileWord {
  title: string;
  url: string;
  x: number;            // center x
  y: number;            // current center y
  vx: number;           // horizontal velocity px/s
  vy: number;           // vertical velocity px/s
  angle: number;        // current rotation radians
  angularVel: number;   // angular velocity rad/s
  fontSize: number;
  textWidth: number;
  lineHeight: number;   // bounding box height (fontSize * 1.25)
  state: "falling" | "settled";
  settleY: number;      // center y when fully settled
  settleSkewX: number;  // permanent lean from landing slope
  opacity: number;      // 0→1 fade-in on spawn
  restTimer: number;    // seconds spent near-rest (for auto-settle)
  vibration: number;    // 0→1, decays: per-char sine shudder after impact
  // Physics-driven arc: spin → curvature while falling; surface concavity on landing
  curvature: number;
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

// Continuous scroll mode: pixels per second
const SCROLL_SPEED_PRESETS = {
  slow: 30,
  normal: 60,
  fast: 140,
} as const;

// Pile mode: ms between word spawns
const PILE_SPAWN_PRESETS = {
  slow: 2400,
  normal: 1400,
  fast: 500,
} as const;

type SpeedKey = keyof typeof STEP_SPEED_PRESETS;
type Mode = "step" | "scroll" | "pile";

const RANDOMIZE_ORDER = true;

const VISIBLE_COUNT = 10;
const FONT_SIZE_MAX = 64;
const FONT_SIZE_MIN = 16;
const STAGE_BOTTOM_OFFSET = 60;
const STAGE_TOP_OFFSET = 40;
const SCROLL_FONT_SIZE_BASE = 140;
const SCROLL_FONT_SIZE_MIN = 24;
const SCROLL_ROW_LINE_HEIGHT = 0.72;
const TITLE_FILL_RATIO = 0.92;

// Pile physics
const PILE_GRAVITY = 1400;          // px/s² — higher = more dramatic fall
const PILE_FONT_BASE = 68;          // starting font size px (scales down for long titles)
const PILE_FONT_MIN = 26;           // floor so the pile stays legible
const PILE_MAX_WIDTH_RATIO = 0.86;  // word takes at most this fraction of canvas width
const PILE_DAMP_VX = 1.8;           // per-second horizontal drag coefficient
const PILE_DAMP_ANG = 2.2;          // per-second angular drag coefficient
const PILE_CURVATURE_SPIN = 0.14;   // how much spin contributes to curvature while falling
const PILE_VIBRATION_DECAY = 2.5;   // amplitude decay per second

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
}) => {
  const [speed, setSpeed] = useState<SpeedKey>("normal");
  const [mode, setMode] = useState<Mode>("step");
  const [pileSpawned, setPileSpawned] = useState(0);
  const isDev = useMemo(() => isDevMode(), []);

  // Step mode state
  const [currentIndex, setCurrentIndex] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Shared canvas + rAF refs (used by both scroll and pile modes)
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  // Scroll mode refs
  const scrollOffsetPxRef = useRef(0);
  const lastTimeRef = useRef<number | null>(null);

  // Pile mode refs — all mutable state lives here to avoid rAF restarts
  const pileWordsRef = useRef<PileWord[]>([]);
  const pileQueueRef = useRef<WikiTitle[]>([]);
  const pileHeightMapRef = useRef<Float32Array | null>(null);
  const pileSpawnTimerRef = useRef<number>(0);
  const pileSpawnedCountRef = useRef<number>(0);
  const pileTotalRef = useRef<number>(0);
  const pileLastTimeRef = useRef<number | null>(null);
  const pileSpeedRef = useRef(speed);

  // Stable refs so closures always see current values
  const titlesRef = useRef(titles);
  const speedRef = useRef(speed);
  const stageHeightRef = useRef(0);

  const [stageHeight, setStageHeight] = useState(
    window.innerHeight - STAGE_TOP_OFFSET - STAGE_BOTTOM_OFFSET - 44,
  );

  useEffect(() => { stageHeightRef.current = stageHeight; }, [stageHeight]);
  useEffect(() => { speedRef.current = speed; pileSpeedRef.current = speed; }, [speed]);

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

  // ── Pile mode rAF loop ─────────────────────────────────────────────────────

  useEffect(() => {
    if (mode !== "pile") return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = window.innerWidth;
    canvas.height = stageHeightRef.current;

    const H = canvas.height;
    const W = canvas.width;

    // Reset pile state
    pileHeightMapRef.current = new Float32Array(W).fill(H);
    pileWordsRef.current = [];
    pileQueueRef.current = [...titlesRef.current];
    pileTotalRef.current = titlesRef.current.length;
    pileSpawnedCountRef.current = 0;
    pileLastTimeRef.current = null;
    pileSpawnTimerRef.current = PILE_SPAWN_PRESETS[pileSpeedRef.current] - 300;
    setPileSpawned(0);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Find the x position with the most vertical space available in the height map.
    // Divides canvas into columns and picks from the tallest (lowest pile) ones,
    // so new words actively seek out empty regions rather than stacking in the center.
    const findBestSpawnX = (heightMap: Float32Array, canvasW: number, textWidth: number): number => {
      const NUM_COLS = 12;
      const colWidth = canvasW / NUM_COLS;
      const halfTW = textWidth / 2;

      // Score each column by its average height map value (higher = more empty space)
      const scores: number[] = Array.from({ length: NUM_COLS }, (_, col) => {
        const px0 = Math.floor(col * colWidth);
        const px1 = Math.min(canvasW - 1, Math.floor((col + 1) * colWidth) - 1);
        let sum = 0;
        for (let px = px0; px <= px1; px++) sum += heightMap[px];
        return sum / (px1 - px0 + 1);
      });

      // Pick randomly from the top third of columns (most space), biased toward emptiest
      const ranked = scores
        .map((s, i) => ({ s, i }))
        .sort((a, b) => b.s - a.s);
      const pool = ranked.slice(0, Math.max(1, Math.ceil(NUM_COLS / 3)));
      // Weight toward emptiest: first entry has highest probability
      const weights = pool.map((_, i) => 1 / (i + 1));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let r = Math.random() * totalWeight;
      let chosen = pool[0];
      for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r <= 0) { chosen = pool[i]; break; }
      }

      // Center of chosen column + small jitter within the column
      const colCenter = (chosen.i + 0.5) * colWidth;
      const jitter = colWidth * 0.35;
      const rawX = colCenter + (Math.random() - 0.5) * 2 * jitter;
      return Math.min(Math.max(rawX, halfTW + 8), canvasW - halfTW - 8);
    };

    const spawnWord = (item: WikiTitle, canvasW: number, heightMap: Float32Array): PileWord => {
      let fontSize = PILE_FONT_BASE;
      ctx.font = `700 ${fontSize}px 'Lora', 'Georgia', serif`;
      let textWidth = ctx.measureText(item.title).width;
      const maxWidth = canvasW * PILE_MAX_WIDTH_RATIO;
      if (textWidth > maxWidth) {
        fontSize = Math.max(PILE_FONT_MIN, Math.floor(fontSize * (maxWidth / textWidth)));
        ctx.font = `700 ${fontSize}px 'Lora', 'Georgia', serif`;
        textWidth = ctx.measureText(item.title).width;
      }
      const lineHeight = fontSize * 1.25;
      const x = findBestSpawnX(heightMap, canvasW, textWidth);
      const angularVel = (Math.random() - 0.5) * 2.0;
      return {
        title: item.title,
        url: wikiUrl(item),
        x, y: -lineHeight * 1.5,
        vx: (Math.random() - 0.5) * 35,
        vy: 50 + Math.random() * 40,
        angle: 0,
        angularVel,
        fontSize, textWidth, lineHeight,
        state: "falling",
        settleY: 0,
        settleSkewX: 0,
        opacity: 0,
        restTimer: 0,
        vibration: 0,
        curvature: angularVel * PILE_CURVATURE_SPIN,
      };
    };

    // Stamp the word's actual arc contour into the height map column-by-column.
    // Each column records the world-space Y of the top of the character at that x,
    // accounting for curvature and tilt — so the pile surface reflects the true word shape
    // and subsequent words can nestle against it rather than floating above a rectangle.
    const stampHeightMap = (word: PileWord, heightMap: Float32Array, canvasW: number) => {
      const arcAmp = word.curvature * word.lineHeight * 0.45;
      const sinA = Math.sin(word.angle);
      const cosA = Math.cos(word.angle);
      const x0 = Math.max(0, Math.floor(word.x - word.textWidth / 2));
      const x1 = Math.min(canvasW - 1, Math.ceil(word.x + word.textWidth / 2));
      for (let px = x0; px <= x1; px++) {
        const localX = px - word.x;
        const progress = Math.max(0, Math.min(1, (localX + word.textWidth / 2) / word.textWidth));
        const arcOffset = arcAmp * Math.sin(Math.PI * progress);
        // Top of this character in local space (above the center line)
        const topLocalY = arcOffset - word.lineHeight / 2;
        // Rotate into world space and offset by word position
        const worldTopY = word.settleY + localX * sinA + topLocalY * cosA;
        heightMap[px] = Math.min(heightMap[px], worldTopY - 1);
      }
    };

    // Find the word center Y at which it first collides with the pile surface.
    // Each x column constrains the landing based on its own arc bottom offset,
    // so a curved word can nestle into a matching curve rather than stopping at the peak.
    const surfaceUnder = (word: PileWord, heightMap: Float32Array, canvasW: number, canvasH: number): number => {
      const arcAmp = word.curvature * word.lineHeight * 0.45;
      const x0 = Math.max(0, Math.floor(word.x - word.textWidth / 2));
      const x1 = Math.min(canvasW - 1, Math.ceil(word.x + word.textWidth / 2));
      // For column px: word.y settles where word.y + arcOffset + lineHeight/2 = heightMap[px]
      // → landingY = heightMap[px] - arcOffset - lineHeight/2
      // Take the minimum (first column to hit as word falls downward)
      let landingCenterY = canvasH;
      for (let px = x0; px <= x1; px++) {
        const localX = px - word.x;
        const progress = Math.max(0, Math.min(1, (localX + word.textWidth / 2) / word.textWidth));
        const arcOffset = arcAmp * Math.sin(Math.PI * progress);
        landingCenterY = Math.min(landingCenterY, heightMap[px] - arcOffset - word.lineHeight / 2);
      }
      return landingCenterY;
    };

    // Sample the surface shape under the word and set curvature + angle to conform to it.
    // A convex hill → word sags over it. A concave bowl → word arches into it.
    const conformToSurface = (word: PileWord, heightMap: Float32Array, canvasW: number) => {
      const NUM_SAMPLES = 7;
      const hVals: number[] = [];
      for (let s = 0; s < NUM_SAMPLES; s++) {
        const px = Math.round(word.x - word.textWidth / 2 + (s / (NUM_SAMPLES - 1)) * word.textWidth);
        hVals.push(heightMap[Math.max(0, Math.min(canvasW - 1, px))]);
      }
      const centerH = hVals[Math.floor(NUM_SAMPLES / 2)];
      const edgeAvg = (hVals[0] + hVals[NUM_SAMPLES - 1]) / 2;
      // Positive concavity = hill (center higher pile); negative = bowl (center lower pile)
      const concavity = edgeAvg - centerH;
      word.curvature = Math.max(-2.0, Math.min(2.0, concavity / word.lineHeight * 3.5));
      // Tilt to follow surface slope
      const slope = (hVals[NUM_SAMPLES - 1] - hVals[0]) / word.textWidth;
      word.angle = Math.max(-0.3, Math.min(0.3, -slope * 1.4));
      word.settleSkewX = word.angularVel * 0.04;
    };

    const tick = (now: number) => {
      const dt = pileLastTimeRef.current !== null
        ? Math.min((now - pileLastTimeRef.current) / 1000, 0.05)
        : 0;
      pileLastTimeRef.current = now;

      const W = canvas.width;
      const H = canvas.height;
      const heightMap = pileHeightMapRef.current!;

      // ── Spawn ──────────────────────────────────────────────────────────────
      pileSpawnTimerRef.current += dt * 1000;
      const spawnInterval = PILE_SPAWN_PRESETS[pileSpeedRef.current];
      if (pileQueueRef.current.length > 0 && pileSpawnTimerRef.current >= spawnInterval) {
        pileSpawnTimerRef.current = 0;
        const item = pileQueueRef.current.shift()!;
        pileWordsRef.current.push(spawnWord(item, W, heightMap));
        pileSpawnedCountRef.current++;
        setPileSpawned(pileSpawnedCountRef.current);
      }

      // ── Physics update ────────────────────────────────────────────────────
      for (const word of pileWordsRef.current) {
        if (word.state === "falling") {
          word.opacity = Math.min(1, word.opacity + dt * 5);

          // Gravity + drag
          word.vy += PILE_GRAVITY * dt;
          word.vx *= Math.max(0, 1 - PILE_DAMP_VX * dt);
          word.angularVel *= Math.max(0, 1 - PILE_DAMP_ANG * dt);
          word.angle += word.angularVel * dt;

          // Curvature mirrors current spin so word visually arcs as it tumbles
          word.curvature = word.angularVel * PILE_CURVATURE_SPIN;

          // Soft wall guide: push back toward canvas, no hard bounce
          const halfTW = word.textWidth / 2;
          word.x = Math.min(Math.max(word.x + word.vx * dt, halfTW + 4), W - halfTW - 4);

          // Surface hit: settle immediately, no bounce.
          // landingCenterY is the word center Y when the first column of the arc touches the pile.
          if (word.vy > 0) {
            const landingCenterY = surfaceUnder(word, heightMap, W, H);

            if (word.y + word.vy * dt >= landingCenterY) {
              word.y = landingCenterY;
              word.settleY = word.y;
              word.vy = 0;
              word.vx = 0;
              word.state = "settled";
              word.vibration = Math.min(0.7, Math.abs(word.angularVel) * 0.15 + 0.2);
              conformToSurface(word, heightMap, W);
              stampHeightMap(word, heightMap, W);
            } else {
              word.y += word.vy * dt;
            }
          } else {
            word.y += word.vy * dt;
          }

          word.vibration = Math.max(0, word.vibration - PILE_VIBRATION_DECAY * dt);

        } else if (word.state === "settled") {
          word.vibration = Math.max(0, word.vibration - PILE_VIBRATION_DECAY * dt);
        }
      }

      // ── Render ───────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, W, H);

      for (const word of pileWordsRef.current) {
        // Shear: leans with spin while falling, snaps to surface-derived lean when settled
        const skewX = word.state === "falling"
          ? Math.max(-0.6, Math.min(0.6, word.angularVel * 0.07))
          : word.settleSkewX;

        // Arc amplitude from physics-driven curvature
        const arcAmp = word.curvature * word.lineHeight * 0.45;
        const vibAmp = word.vibration > 0.05 ? word.vibration * word.lineHeight * 0.18 : 0;

        ctx.save();
        ctx.globalAlpha = word.opacity;
        ctx.translate(word.x, word.y);
        ctx.rotate(word.angle);
        ctx.transform(1, 0, skewX, 1, 0, 0);
        ctx.font = `700 ${word.fontSize}px 'Lora', 'Georgia', serif`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";

        const chars = [...word.title];
        let cx = -word.textWidth / 2;
        for (let ci = 0; ci < chars.length; ci++) {
          const cw = ctx.measureText(chars[ci]).width;
          const charCenterX = cx + cw / 2;
          const progress = (charCenterX + word.textWidth / 2) / word.textWidth;
          const curveY = arcAmp * Math.sin(Math.PI * progress);
          const vibY = vibAmp * Math.sin(now * 0.013 + ci * 1.2 + word.x * 0.004);
          // Each char rotates to sit tangent to the arc
          const tangent = (arcAmp * Math.PI / word.textWidth) * Math.cos(Math.PI * progress);

          ctx.save();
          ctx.translate(charCenterX, curveY + vibY);
          ctx.rotate(tangent);
          ctx.fillText(chars[ci], -cw / 2, 0);
          ctx.restore();

          cx += cw;
        }

        ctx.restore();
      }

      ctx.globalAlpha = 1;
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    // Click: hit-test words (top of stack gets priority)
    const handleCanvasClick = (e: MouseEvent) => {
      const words = pileWordsRef.current;
      for (let i = words.length - 1; i >= 0; i--) {
        const word = words[i];
        const dx = Math.abs(e.offsetX - word.x);
        const dy = Math.abs(e.offsetY - word.y);
        if (dx <= word.textWidth / 2 + 4 && dy <= word.lineHeight / 2 + 4) {
          window.open(word.url, "_blank", "noopener,noreferrer");
          break;
        }
      }
    };

    canvas.style.cursor = "pointer";
    canvas.addEventListener("click", handleCanvasClick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("click", handleCanvasClick);
    };
  }, [mode]); // speed/titles/heightMap read via refs

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
        <div className="vignette vignette-top" />
        <div className="vignette vignette-bottom" />

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

        {/* Scroll + pile modes — canvas driven by rAF */}
        {(mode === "scroll" || mode === "pile") && (
          <canvas
            ref={canvasRef}
            style={{ position: "absolute", top: STAGE_TOP_OFFSET, left: 0, pointerEvents: "auto" }}
          />
        )}
      </div>

      {/* ── Bottom info bar ── */}
      <div className="info-bar">
        <span className="info-label">wikipedia rabbit hole</span>

        {!loading && titles.length > 0 && mode !== "pile" && (
          <>
            <span className="info-stat">{titles.length.toLocaleString()} pages</span>
            <span className="info-stat" style={{ color: "#3e3a36" }}>·</span>
            <span className="info-stat">{formatDateRange(titles)}</span>
          </>
        )}

        {mode === "pile" && !loading && titles.length > 0 && (
          <span className="info-stat">
            {pileSpawned} / {titles.length}
            {pileSpawned === titles.length && " — settled"}
          </span>
        )}

        {loading && <span className="info-loading">fetching…</span>}
        {error && <span className="info-error" title={error}>error</span>}

        <span className="speed-control">
          {(["step", "scroll", "pile"] as Mode[]).map((m) => (
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

        <button className="refresh-btn" onClick={onRefresh} disabled={loading}>↺</button>
      </div>
    </div>
  );
};
