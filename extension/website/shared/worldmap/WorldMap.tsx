// ABOUTME: Canvas world map in a cartographer's-parchment style with fog of war.
// ABOUTME: Renders one deterministic geography; an exploration record lights it up.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import {
  ExplorationRecord,
  RevealTier,
  Route,
  ScoutMark,
  WorldSite,
} from "./types";
import {
  PlacedSite,
  placeSites,
  settlementClass,
  SCOUT_RADIUS,
  WORLD_RADIUS,
} from "./geography";

export interface WorldMapProps {
  sites: WorldSite[];
  exploration: ExplorationRecord;
  scoutMarks?: ScoutMark[];
  /** Hyperlink connections drawn as sea routes once both ends are charted */
  routes?: Route[];
  /** Debug/dev: lift all fog and reveal every landmark */
  revealAll?: boolean;
  onTravel?: (site: WorldSite) => void;
  onScout?: (point: { x: number; y: number }, nearbyDomains: string[]) => void;
}

const INK = "#3d3833";
const INK_FADED = "#8a8279";
const PAPER = "#f5f0e8";
const ISLAND_FILL = "#ebe3d1";
const COAST = "#6b5f52";
const CANDLE_FLAME = "#c4724e";
const FOG_PAPER = "#f3eee3";

/** Fog clearing radius per tier, world units */
const TIER_CLEAR: Record<RevealTier, number> = { 0: 0, 1: 48, 2: 100, 3: 170 };

/** Founded on or before this year renders with old-town patina */
const OLD_YEAR = 2012;
/** Founded on or after this year renders as a freshly-surveyed settlement */
const NEW_YEAR = 2025;

interface View {
  cx: number;
  cy: number;
  scale: number;
}

interface Hover {
  placed: PlacedSite;
  screenX: number;
  screenY: number;
  tier: RevealTier;
}

function makeSpecklePattern(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 160;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, 160, 160);
  for (let i = 0; i < 260; i++) {
    const a = Math.random();
    ctx.fillStyle = `rgba(61, 56, 51, ${0.015 + a * 0.035})`;
    ctx.fillRect(Math.random() * 160, Math.random() * 160, 1.2, 1.2);
  }
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `rgba(138, 130, 121, ${0.02 + Math.random() * 0.03})`;
    ctx.beginPath();
    ctx.arc(
      Math.random() * 160,
      Math.random() * 160,
      6 + Math.random() * 18,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  return c;
}

function makeMistPattern(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 220;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = FOG_PAPER;
  ctx.fillRect(0, 0, 220, 220);
  for (let i = 0; i < 26; i++) {
    const r = 14 + Math.random() * 40;
    const x = Math.random() * 220;
    const y = Math.random() * 220;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const warm = Math.random() > 0.5;
    g.addColorStop(
      0,
      warm ? "rgba(255,253,247,0.30)" : "rgba(216,208,192,0.22)"
    );
    g.addColorStop(1, "rgba(243,238,227,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c;
}

export function WorldMap({
  sites,
  exploration,
  scoutMarks = [],
  routes = [],
  revealAll = false,
  onTravel,
  onScout,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const specklePattern = useMemo(makeSpecklePattern, []);
  const mistPattern = useMemo(makeMistPattern, []);

  const placed = useMemo(() => placeSites(sites), [sites]);
  const placedByDomain = useMemo(
    () => new Map(placed.map((p) => [p.site.domain, p])),
    [placed]
  );

  // favicon seals load lazily, only once a charted landmark is drawn zoomed-in
  const iconCache = useRef(new Map<string, HTMLImageElement | null>());
  const iconFor = useCallback((site: WorldSite): HTMLImageElement | null => {
    if (!site.favicon || !/^https?:/.test(site.favicon)) return null;
    const cache = iconCache.current;
    if (cache.has(site.domain)) return cache.get(site.domain) ?? null;
    const img = new Image();
    img.onerror = () => cache.set(site.domain, null);
    img.src = site.favicon;
    cache.set(site.domain, img);
    return img;
  }, []);

  const viewRef = useRef<View>({ cx: 0, cy: 0, scale: 0.8 });
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const [hover, setHover] = useState<Hover | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  hoverRef.current = hover;

  const explorationRef = useRef(exploration);
  explorationRef.current = exploration;
  const scoutRef = useRef(scoutMarks);
  scoutRef.current = scoutMarks;
  const revealAllRef = useRef(revealAll);
  revealAllRef.current = revealAll;

  const tierOf = useCallback((domain: string): RevealTier => {
    const real = explorationRef.current[domain]?.tier ?? 0;
    if (revealAllRef.current) return real > 2 ? real : 2;
    return real;
  }, []);

  // --- rendering ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let running = true;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      sizeRef.current = { w, h, dpr };
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      if (!fogCanvasRef.current) {
        fogCanvasRef.current = document.createElement("canvas");
      }
      fogCanvasRef.current.width = w * dpr;
      fogCanvasRef.current.height = h * dpr;
      if (viewRef.current.scale === 0.8 && Math.min(w, h) > 0) {
        viewRef.current.scale = Math.min(w, h) / 950;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const worldToScreen = (x: number, y: number) => {
      const { w, h } = sizeRef.current;
      const v = viewRef.current;
      return {
        x: w / 2 + (x - v.cx) * v.scale,
        y: h / 2 + (y - v.cy) * v.scale,
      };
    };

    const drawFog = () => {
      const fog = fogCanvasRef.current!;
      const fctx = fog.getContext("2d")!;
      const { w, h, dpr } = sizeRef.current;
      const v = viewRef.current;
      fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fctx.globalCompositeOperation = "source-over";
      fctx.clearRect(0, 0, w, h);
      fctx.globalAlpha = 0.97;
      fctx.fillStyle = fctx.createPattern(mistPattern, "repeat")!;
      fctx.fillRect(0, 0, w, h);
      fctx.globalAlpha = 1;
      fctx.globalCompositeOperation = "destination-out";
      const punch = (wx: number, wy: number, wr: number, soft = 0.45) => {
        const s = worldToScreen(wx, wy);
        const r = wr * v.scale;
        if (
          s.x < -r || s.y < -r || s.x > w + r || s.y > h + r || r <= 0
        )
          return;
        const g = fctx.createRadialGradient(s.x, s.y, r * soft, s.x, s.y, r);
        g.addColorStop(0, "rgba(0,0,0,1)");
        g.addColorStop(1, "rgba(0,0,0,0)");
        fctx.fillStyle = g;
        fctx.beginPath();
        fctx.arc(s.x, s.y, r, 0, Math.PI * 2);
        fctx.fill();
      };
      for (const p of placed) {
        const t = tierOf(p.site.domain);
        if (t > 0) punch(p.x, p.y, TIER_CLEAR[t]);
      }
      for (const m of scoutRef.current) punch(m.x, m.y, m.r, 0.3);
    };

    const draw = (time: number) => {
      if (!running) return;
      const { w, h, dpr } = sizeRef.current;
      const v = viewRef.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // paper
      ctx.fillStyle = ctx.createPattern(specklePattern, "repeat")!;
      ctx.fillRect(0, 0, w, h);

      // world-space layers
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(v.scale, v.scale);
      ctx.translate(-v.cx, -v.cy);

      // graticule
      ctx.strokeStyle = "rgba(61,56,51,0.055)";
      ctx.lineWidth = 1 / v.scale;
      const G = 100;
      ctx.beginPath();
      for (let g = -WORLD_RADIUS; g <= WORLD_RADIUS; g += G) {
        ctx.moveTo(g, -WORLD_RADIUS - 60);
        ctx.lineTo(g, WORLD_RADIUS + 60);
        ctx.moveTo(-WORLD_RADIUS - 60, g);
        ctx.lineTo(WORLD_RADIUS + 60, g);
      }
      ctx.stroke();

      // edge of the known world
      ctx.strokeStyle = "rgba(61,56,51,0.28)";
      ctx.lineWidth = 1.6 / v.scale;
      ctx.setLineDash([10 / v.scale, 7 / v.scale]);
      ctx.beginPath();
      ctx.arc(0, 0, WORLD_RADIUS + 40, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // islands, tinted and stroked by age: old places are darker and
      // re-inked, new places are lighter with a just-surveyed dotted coast
      for (const p of placed) {
        ctx.beginPath();
        const pts = p.island;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i <= pts.length; i++) {
          const a = pts[i % pts.length];
          const prev = pts[(i - 1) % pts.length];
          const mx = (prev.x + a.x) / 2;
          const my = (prev.y + a.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        }
        ctx.closePath();
        const founded = p.site.founded;
        const isOld = founded !== undefined && founded <= OLD_YEAR;
        const isNew = founded !== undefined && founded >= NEW_YEAR;
        ctx.fillStyle = isOld ? "#e5dac2" : isNew ? "#f0ead9" : ISLAND_FILL;
        ctx.fill();
        ctx.strokeStyle = COAST;
        ctx.globalAlpha = isOld ? 0.75 : 0.55;
        ctx.lineWidth = (isOld ? 2.1 : 1.4) / v.scale;
        if (isNew) ctx.setLineDash([5 / v.scale, 4 / v.scale]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // sea routes: hyperlinks between charted places, drawn as dashed
      // voyages with a slight deterministic bow
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.1 / v.scale;
      ctx.setLineDash([5 / v.scale, 6 / v.scale]);
      ctx.globalAlpha = 0.24;
      for (const [a, b] of routes) {
        const pa = placedByDomain.get(a);
        const pb = placedByDomain.get(b);
        if (!pa || !pb) continue;
        if (tierOf(a) < 2 || tierOf(b) < 2) continue;
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2;
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        const dist = Math.hypot(dx, dy) || 1;
        const bowSign = (pa.x * pb.y - pa.y * pb.x) % 2 >= 0 ? 1 : -1;
        const bow = Math.min(dist * 0.14, 55) * bowSign;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.quadraticCurveTo(
          mx + (-dy / dist) * bow,
          my + (dx / dist) * bow,
          pb.x,
          pb.y
        );
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // landmarks
      for (const p of placed) {
        const t = tierOf(p.site.domain);
        if (t === 0) continue;
        // marks stay ink-sized on screen instead of ballooning with zoom
        const drawR = Math.min(p.markR, 13 / v.scale);
        if (t === 1) {
          ctx.fillStyle = INK_FADED;
          ctx.globalAlpha = 0.45;
          ctx.beginPath();
          ctx.arc(p.x, p.y, drawR * 0.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }
        // visited/inhabited: inked mark, or the site's favicon as a wax-seal
        // stamp once you're close enough to read the place
        const icon = v.scale >= 0.9 ? iconFor(p.site) : null;
        const sealed = !!(icon && icon.complete && icon.naturalWidth > 0);
        if (sealed) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(p.x, p.y, drawR, 0, Math.PI * 2);
          ctx.fillStyle = "#faf7f2";
          ctx.fill();
          ctx.clip();
          ctx.filter = "sepia(0.35) saturate(0.8)";
          ctx.drawImage(
            icon,
            p.x - drawR * 0.86,
            p.y - drawR * 0.86,
            drawR * 1.72,
            drawR * 1.72
          );
          ctx.restore();
          ctx.strokeStyle = INK;
          ctx.lineWidth = 1.4 / v.scale;
          ctx.beginPath();
          ctx.arc(p.x, p.y, drawR, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.fillStyle = INK;
          ctx.beginPath();
          ctx.arc(p.x, p.y, drawR, 0, Math.PI * 2);
          ctx.fill();
        }
        // settlement buildings: density shows how lived-in the place is
        ctx.fillStyle = INK;
        ctx.globalAlpha = 0.72;
        for (const b of p.buildings) {
          const bx = p.x + b.dx;
          const by = p.y + b.dy;
          ctx.fillRect(bx - b.size / 2, by - b.size, b.size, b.size);
          if (b.roof) {
            ctx.beginPath();
            ctx.moveTo(bx - b.size * 0.7, by - b.size);
            ctx.lineTo(bx, by - b.size * 1.8);
            ctx.lineTo(bx + b.size * 0.7, by - b.size);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
        if (t === 3) {
          ctx.strokeStyle = INK;
          ctx.globalAlpha = 0.5;
          ctx.lineWidth = 1.2 / v.scale;
          ctx.beginPath();
          ctx.arc(p.x, p.y, drawR + 4 / v.scale, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        if (p.site.playhtml) {
          // candle glow with a slow flicker
          const flicker =
            0.75 +
            0.25 *
              Math.sin(time / 320 + p.x * 0.13 + p.y * 0.07) *
              Math.sin(time / 173 + p.x);
          const glowR = (drawR + 6) * (0.9 + 0.2 * flicker);
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
          g.addColorStop(0, `rgba(212, 184, 92, ${0.32 * flicker})`);
          g.addColorStop(1, "rgba(212, 184, 92, 0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
          ctx.fill();
          if (!sealed) {
            ctx.fillStyle = CANDLE_FLAME;
            ctx.beginPath();
            ctx.arc(p.x, p.y, Math.max(1.4, drawR * 0.38), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      ctx.restore();

      // labels in screen space (crisp at any zoom), greedily culled so they
      // never pile up: strongest places keep their names, others wait for zoom
      ctx.textAlign = "center";
      const candidates = placed
        .map((p) => ({ p, t: tierOf(p.site.domain) }))
        .filter(({ p, t }) => {
          if (t < 2) return false;
          if (v.scale < 0.55 && t < 3 && p.weight < 0.4) return false;
          return true;
        })
        .sort((a, b) => b.t - a.t || b.p.weight - a.p.weight);
      const kept: { x: number; y: number; w: number; h: number }[] = [];
      for (const { p, t } of candidates) {
        const s = worldToScreen(p.x, p.y);
        if (s.x < -80 || s.y < -20 || s.x > w + 80 || s.y > h + 20) continue;
        const size = t === 3 ? 13 : 11;
        const lw = p.site.domain.length * size * 0.52;
        const rect = {
          x: s.x - lw / 2,
          y: s.y - p.markR * v.scale - 6 - size,
          w: lw,
          h: size + 4,
        };
        const collides = kept.some(
          (k) =>
            rect.x < k.x + k.w &&
            rect.x + rect.w > k.x &&
            rect.y < k.y + k.h &&
            rect.y + rect.h > k.y
        );
        if (collides) continue;
        kept.push(rect);
        const founded = p.site.founded;
        const isOld = founded !== undefined && founded <= OLD_YEAR;
        const nameY = s.y - p.markR * v.scale - 6;
        const styled = ctx as CanvasRenderingContext2D & {
          letterSpacing?: string;
        };
        ctx.fillStyle = INK;
        if (isOld) {
          // engraved style for old towns: spaced capitals, slightly faded
          ctx.font = `600 ${size - 1}px Georgia, 'Times New Roman', serif`;
          styled.letterSpacing = "1.5px";
          ctx.globalAlpha = 0.78;
          ctx.fillText(p.site.domain.toUpperCase(), s.x, nameY);
          styled.letterSpacing = "0px";
        } else {
          ctx.font = `${t === 3 ? "600 " : ""}${size}px Georgia, 'Times New Roman', serif`;
          ctx.globalAlpha = t === 3 ? 0.95 : 0.8;
          ctx.fillText(p.site.domain, s.x, nameY);
        }
        if (founded !== undefined && (t === 3 || isOld) && v.scale > 0.5) {
          ctx.font = "italic 9px Georgia, serif";
          ctx.globalAlpha = 0.55;
          ctx.fillText(`est. ${founded}`, s.x, nameY - size - 1);
        }
        ctx.globalAlpha = 1;
      }

      // fog
      if (!revealAllRef.current) {
        drawFog();
        ctx.drawImage(fogCanvasRef.current!, 0, 0, w, h);
      }

      // vignette
      const vg = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.35,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.75
      );
      vg.addColorStop(0, "rgba(107,90,70,0)");
      vg.addColorStop(1, "rgba(107,90,70,0.22)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      // compass rose
      const crx = w - 64;
      const cry = 72;
      ctx.save();
      ctx.translate(crx, cry);
      ctx.strokeStyle = INK;
      ctx.fillStyle = INK;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const major = i % 2 === 0;
        const ang = (i / 8) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * (major ? 24 : 14), Math.sin(ang) * (major ? 24 : 14));
        ctx.lineTo(Math.cos(ang + 2.6) * 4, Math.sin(ang + 2.6) * 4);
        ctx.lineTo(Math.cos(ang - 2.6) * 4, Math.sin(ang - 2.6) * 4);
        ctx.closePath();
        ctx.fill();
      }
      ctx.font = "600 11px Georgia, serif";
      ctx.textAlign = "center";
      ctx.fillText("N", 0, -32);
      ctx.restore();
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [placed, placedByDomain, routes, specklePattern, mistPattern, tierOf, iconFor]);

  // --- interaction --------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;

    const screenToWorld = (sx: number, sy: number) => {
      const { w, h } = sizeRef.current;
      const v = viewRef.current;
      return {
        x: v.cx + (sx - w / 2) / v.scale,
        y: v.cy + (sy - h / 2) / v.scale,
      };
    };

    const hitTest = (sx: number, sy: number): PlacedSite | null => {
      const v = viewRef.current;
      let best: PlacedSite | null = null;
      let bestD = Infinity;
      for (const p of placed) {
        if (!revealAllRef.current && (explorationRef.current[p.site.domain]?.tier ?? 0) === 0)
          continue;
        const { w, h } = sizeRef.current;
        const px = w / 2 + (p.x - v.cx) * v.scale;
        const py = h / 2 + (p.y - v.cy) * v.scale;
        const d = Math.hypot(px - sx, py - sy);
        if (d < Math.max(p.markR * v.scale + 4, 12) && d < bestD) {
          best = p;
          bestD = d;
        }
      }
      return best;
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
        viewRef.current.cx -= dx / viewRef.current.scale;
        viewRef.current.cy -= dy / viewRef.current.scale;
        lastX = e.clientX;
        lastY = e.clientY;
        canvas.style.cursor = "grabbing";
        return;
      }
      const hit = hitTest(sx, sy);
      if (hit) {
        const tier = revealAllRef.current
          ? 3
          : explorationRef.current[hit.site.domain]?.tier ?? 0;
        setHover({ placed: hit, screenX: sx, screenY: sy, tier });
        canvas.style.cursor = "pointer";
      } else {
        if (hoverRef.current) setHover(null);
        canvas.style.cursor = "grab";
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      dragging = false;
      canvas.style.cursor = "grab";
      if (moved) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hit = hitTest(sx, sy);
      if (hit) {
        const tier = explorationRef.current[hit.site.domain]?.tier ?? 0;
        if (tier >= 1 || revealAllRef.current) {
          onTravel?.(hit.site);
          return;
        }
      }
      const pt = screenToWorld(sx, sy);
      const within = placed
        .filter((p) => Math.hypot(p.x - pt.x, p.y - pt.y) < SCOUT_RADIUS)
        .map((p) => p.site.domain);
      onScout?.(pt, within);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const before = screenToWorld(sx, sy);
      const v = viewRef.current;
      const factor = Math.exp(-e.deltaY * 0.0015);
      v.scale = Math.min(6, Math.max(0.18, v.scale * factor));
      const after = screenToWorld(sx, sy);
      v.cx += before.x - after.x;
      v.cy += before.y - after.y;
    };

    canvas.style.cursor = "grab";
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [placed, onTravel, onScout]);

  const entry = hover ? exploration[hover.placed.site.domain] : undefined;

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
      {hover && hover.tier >= 1 && (
        <div
          style={{
            position: "absolute",
            left: hover.screenX + 14,
            top: hover.screenY + 14,
            background: "rgba(250, 247, 242, 0.96)",
            border: `1px solid ${INK_FADED}`,
            borderRadius: 3,
            padding: "6px 10px",
            font: "12px Georgia, serif",
            color: INK,
            pointerEvents: "none",
            maxWidth: 240,
            boxShadow: "1px 2px 6px rgba(61,56,51,0.18)",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 13 }}>
            {hover.tier >= 2 && hover.placed.site.favicon && (
              <img
                src={hover.placed.site.favicon}
                alt=""
                style={{
                  width: 14,
                  height: 14,
                  marginRight: 5,
                  verticalAlign: "-2px",
                  filter: "sepia(0.3) saturate(0.85)",
                }}
              />
            )}
            {hover.tier >= 2 ? (
              hover.placed.site.domain
            ) : (
              <span style={{ fontStyle: "italic" }}>
                an unnamed {settlementClass(hover.placed.site.activity)}
              </span>
            )}
          </div>
          {hover.tier >= 2 && hover.placed.site.title &&
            hover.placed.site.title.toLowerCase() !==
              hover.placed.site.domain && (
              <div style={{ fontStyle: "italic", color: INK_FADED }}>
                "{hover.placed.site.title}"
              </div>
            )}
          {hover.tier >= 2 && (
            <div style={{ color: INK_FADED }}>
              {settlementClass(hover.placed.site.activity)}
              {hover.placed.site.founded
                ? ` · est. ${hover.placed.site.founded}`
                : ""}
              {hover.placed.site.rooms
                ? ` · ${hover.placed.site.rooms} room${hover.placed.site.rooms === 1 ? "" : "s"}`
                : ""}
            </div>
          )}
          {hover.tier >= 3 && entry?.visits ? (
            <div style={{ color: INK_FADED }}>
              traveled {entry.visits} time{entry.visits === 1 ? "" : "s"}
            </div>
          ) : null}
          <div style={{ fontStyle: "italic", marginTop: 2 }}>
            click to travel
          </div>
        </div>
      )}
    </div>
  );
}
