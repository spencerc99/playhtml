// ABOUTME: "occupied territories" — a live map of collective human attention on the web.
// ABOUTME: Corporate platform domains cluster into gravitational bodies; the independent
// ABOUTME: web scatters in the outer ring. Live WebSocket stream shows real-time navigation
// ABOUTME: arcs and visitor presence orbiting each domain.

import "./enclosures.css";
import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import ReactDOM from "react-dom/client";
import { RECENT_EVENTS_URL, STREAM_URL } from "../shared/config";
import type { CollectionEvent } from "../shared/types";

// ─── Corporate ownership ──────────────────────────────────────────────────────

// Maps bare domain (www-stripped) to a corporate owner key.
// Sub-domains are matched by walking up the hierarchy.
const CORPORATE_OWNERS: Record<string, string> = {
  // Alphabet / Google
  "google.com": "alphabet",
  "youtube.com": "alphabet",
  "gmail.com": "alphabet",
  "drive.google.com": "alphabet",
  "docs.google.com": "alphabet",
  "sheets.google.com": "alphabet",
  "slides.google.com": "alphabet",
  "maps.google.com": "alphabet",
  "calendar.google.com": "alphabet",
  "meet.google.com": "alphabet",
  "photos.google.com": "alphabet",
  "news.google.com": "alphabet",
  "translate.google.com": "alphabet",
  "play.google.com": "alphabet",
  "chrome.google.com": "alphabet",
  "developer.chrome.com": "alphabet",
  "chromium.org": "alphabet",
  "waymo.com": "alphabet",
  // Meta
  "facebook.com": "meta",
  "instagram.com": "meta",
  "whatsapp.com": "meta",
  "threads.net": "meta",
  "meta.com": "meta",
  "messenger.com": "meta",
  // Amazon
  "amazon.com": "amazon",
  "aws.amazon.com": "amazon",
  "twitch.tv": "amazon",
  "audible.com": "amazon",
  "goodreads.com": "amazon",
  "imdb.com": "amazon",
  "prime.amazon.com": "amazon",
  "music.amazon.com": "amazon",
  "zappos.com": "amazon",
  // Microsoft
  "microsoft.com": "microsoft",
  "linkedin.com": "microsoft",
  "github.com": "microsoft",
  "office.com": "microsoft",
  "bing.com": "microsoft",
  "outlook.com": "microsoft",
  "live.com": "microsoft",
  "hotmail.com": "microsoft",
  "azure.com": "microsoft",
  "onedrive.live.com": "microsoft",
  "sharepoint.com": "microsoft",
  "skype.com": "microsoft",
  "xbox.com": "microsoft",
  // Apple
  "apple.com": "apple",
  "icloud.com": "apple",
  // ByteDance
  "tiktok.com": "bytedance",
  "douyin.com": "bytedance",
  "capcut.com": "bytedance",
  // X / Twitter
  "twitter.com": "x",
  "x.com": "x",
};

const CORPORATE_COLORS: Record<string, string> = {
  alphabet: "#4285F4",
  meta: "#1877F2",
  amazon: "#FF9900",
  microsoft: "#00A4EF",
  apple: "#A2AAAD",
  bytedance: "#EE1D52",
  x: "#E7E9EA",
  independent: "#FFD166",
};

const CORPORATE_NAMES: Record<string, string> = {
  alphabet: "ALPHABET",
  meta: "META",
  amazon: "AMAZON",
  microsoft: "MICROSOFT",
  apple: "APPLE",
  bytedance: "BYTEDANCE",
  x: "X CORP",
  independent: "INDEPENDENT WEB",
};

// Clockwise from top, 7 corporate clusters evenly placed
const CLUSTER_ANGLES_DEG: Record<string, number> = {
  alphabet: -90, // 12 o'clock
  meta: -38,     // 1 o'clock
  amazon: 13,    // 2 o'clock
  microsoft: 64, // 4 o'clock
  apple: 115,    // 5 o'clock
  bytedance: 167,// 7 o'clock
  x: 218,        // 9 o'clock
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface Planet {
  id: string;
  domain: string;
  owner: string;
  visitCount: number;
  radius: number;
  x: number;
  y: number;
  color: string;
  dimmed: boolean;
  clusterX: number;
  clusterY: number;
}

interface Visitor {
  pid: string;
  domain: string;
  color: string;
  angle: number;  // radians, current orbit angle
  speed: number;  // radians per frame
}

interface NavArc {
  id: string;
  fromDomain: string;
  toDomain: string;
  color: string;
  progress: number; // 0–1
  startTime: number;
  duration: number; // ms
}

interface Star {
  x: number;
  y: number;
  r: number;
  a: number;
}

interface TooltipInfo {
  x: number;
  y: number;
  planet: Planet;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function extractDomain(url: string): string {
  if (!url) return "";
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function getCorporateOwner(domain: string): string {
  if (!domain) return "independent";
  if (CORPORATE_OWNERS[domain]) return CORPORATE_OWNERS[domain];
  // Walk up the subdomain hierarchy
  const parts = domain.split(".");
  for (let i = 1; i < parts.length - 1; i++) {
    const parent = parts.slice(i).join(".");
    if (CORPORATE_OWNERS[parent]) return CORPORATE_OWNERS[parent];
  }
  return "independent";
}

// Deterministic pseudo-random (stable across renders for the same seed)
function seededRandom(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m
    ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
    : null;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

interface LayoutResult {
  planets: Map<string, Planet>;
  clusterCenters: Map<string, { x: number; y: number }>;
}

function buildLayout(
  domainCounts: Map<string, number>,
  w: number,
  h: number,
): LayoutResult {
  const cx = w / 2;
  const cy = h / 2;
  const shortSide = Math.min(w, h);
  const clusterRing = shortSide * 0.30;
  const outerRing = shortSide * 0.45;
  const maxCount = Math.max(...domainCounts.values(), 1);

  const getRadius = (count: number): number =>
    3 + (Math.log(count + 1) / Math.log(maxCount + 1)) * 26;

  // Group by owner
  const byOwner = new Map<string, Array<{ domain: string; count: number }>>();
  for (const [domain, count] of domainCounts) {
    const owner = getCorporateOwner(domain);
    const list = byOwner.get(owner) ?? [];
    list.push({ domain, count });
    byOwner.set(owner, list);
  }

  const planets = new Map<string, Planet>();
  const clusterCenters = new Map<string, { x: number; y: number }>();

  // Corporate clusters — place planets in a golden-angle spiral around the cluster center
  for (const [owner, entries] of byOwner) {
    if (owner === "independent") continue;
    const angleDeg = CLUSTER_ANGLES_DEG[owner] ?? 0;
    const angle = (angleDeg * Math.PI) / 180;
    const clusterX = cx + Math.cos(angle) * clusterRing;
    const clusterY = cy + Math.sin(angle) * clusterRing;
    clusterCenters.set(owner, { x: clusterX, y: clusterY });

    entries.sort((a, b) => b.count - a.count);
    entries.forEach(({ domain, count }, i) => {
      // Largest planet at center (i=0 gets orbit radius 0), rest spiral out
      const orbitAngle = (i * 137.508 * Math.PI) / 180; // golden angle
      const orbitR = i === 0 ? 0 : 12 + (i - 1) * 18;
      planets.set(domain, {
        id: domain,
        domain,
        owner,
        visitCount: count,
        radius: getRadius(count),
        x: clusterX + Math.cos(orbitAngle) * orbitR,
        y: clusterY + Math.sin(orbitAngle) * orbitR,
        color: CORPORATE_COLORS[owner] ?? "#ffffff",
        dimmed: false,
        clusterX,
        clusterY,
      });
    });
  }

  // Independent sites — outer ring with seeded variance
  const indie = (byOwner.get("independent") ?? [])
    .sort((a, b) => b.count - a.count)
    .slice(0, 120); // cap to avoid clutter

  const indieClusterX = cx;
  const indieClusterY = cy;
  clusterCenters.set("independent", { x: indieClusterX, y: indieClusterY });

  indie.forEach(({ domain, count }, i) => {
    const seed = hashStr(domain);
    const baseAngle = (i / indie.length) * Math.PI * 2;
    const angVariance = (seededRandom(seed) - 0.5) * 0.4;
    const rVariance = (seededRandom(seed + 1) - 0.5) * 55;
    const r = outerRing + rVariance;
    const a = baseAngle + angVariance;
    planets.set(domain, {
      id: domain,
      domain,
      owner: "independent",
      visitCount: count,
      radius: getRadius(count),
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r,
      color: CORPORATE_COLORS.independent,
      dimmed: true,
      clusterX: indieClusterX,
      clusterY: indieClusterY,
    });
  });

  return { planets, clusterCenters };
}

// ─── Star field ───────────────────────────────────────────────────────────────

function genStars(w: number, h: number, n = 350): Star[] {
  return Array.from({ length: n }, (_, i) => ({
    x: seededRandom(i * 7 + 1) * w,
    y: seededRandom(i * 7 + 2) * h,
    r: seededRandom(i * 7 + 3) * 1.1 + 0.2,
    a: seededRandom(i * 7 + 4) * 0.35 + 0.04,
  }));
}

// ─── Canvas drawing ───────────────────────────────────────────────────────────

function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, stars: Star[]) {
  ctx.fillStyle = "#060611";
  ctx.fillRect(0, 0, w, h);

  for (const s of stars) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(200,215,240,${s.a})`;
    ctx.fill();
  }
}

function drawClusterZone(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  color: string,
  label: string,
) {
  const rgb = hexToRgb(color);
  if (!rgb) return;
  const [R, G, B] = rgb;

  // Soft radial glow
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(${R},${G},${B},0.06)`);
  g.addColorStop(0.5, `rgba(${R},${G},${B},0.025)`);
  g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Label at top of zone
  ctx.font = "8px Martian Mono, monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = `rgba(${R},${G},${B},0.28)`;
  ctx.fillText(label, cx, cy - r + 13);
}

function drawIndependentRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,209,102,0.06)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 9]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = "8px Martian Mono, monospace";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,209,102,0.18)";
  ctx.fillText("INDEPENDENT WEB", cx, cy - r - 6);
}

function drawPlanet(
  ctx: CanvasRenderingContext2D,
  p: Planet,
  hovered: boolean,
) {
  const rgb = hexToRgb(p.color);
  if (!rgb) return;
  const [R, G, B] = rgb;
  const baseAlpha = p.dimmed ? 0.55 : 0.95;
  const glowScale = hovered ? 5 : p.dimmed ? 1.5 : 3;
  const glowAlpha = hovered ? 0.3 : p.dimmed ? 0.04 : 0.1;

  // Glow halo
  const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * glowScale);
  glow.addColorStop(0, `rgba(${R},${G},${B},${glowAlpha})`);
  glow.addColorStop(1, `rgba(${R},${G},${B},0)`);
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius * glowScale, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // Planet disc
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${R},${G},${B},${baseAlpha})`;
  ctx.fill();

  // Domain label (only for meaningful-sized planets or hovered)
  const showLabel = (p.radius >= 7 && !p.dimmed) || hovered;
  if (showLabel) {
    const fs = hovered ? 10 : Math.max(8, Math.min(10, p.radius * 0.85));
    ctx.font = `${fs}px Martian Mono, monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(255,255,255,${hovered ? 0.75 : 0.55})`;
    ctx.fillText(p.domain, p.x, p.y + p.radius + fs + 2);
  }
}

function drawVisitor(
  ctx: CanvasRenderingContext2D,
  planet: Planet,
  visitor: Visitor,
) {
  const orbitR = planet.radius + 7;
  const vx = planet.x + Math.cos(visitor.angle) * orbitR;
  const vy = planet.y + Math.sin(visitor.angle) * orbitR;

  const rgb = hexToRgb(visitor.color) ?? [255, 255, 255] as [number, number, number];
  const [R, G, B] = rgb;

  // Glow
  const g = ctx.createRadialGradient(vx, vy, 0, vx, vy, 6);
  g.addColorStop(0, `rgba(${R},${G},${B},0.5)`);
  g.addColorStop(1, `rgba(${R},${G},${B},0)`);
  ctx.beginPath();
  ctx.arc(vx, vy, 6, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();

  // Dot
  ctx.beginPath();
  ctx.arc(vx, vy, 2.2, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${R},${G},${B},0.9)`;
  ctx.fill();
}

function evalBezier(
  x0: number, y0: number,
  cx: number, cy: number,
  x1: number, y1: number,
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * x0 + 2 * mt * t * cx + t * t * x1,
    y: mt * mt * y0 + 2 * mt * t * cy + t * t * y1,
  };
}

function drawNavArc(
  ctx: CanvasRenderingContext2D,
  from: Planet,
  to: Planet,
  arc: NavArc,
) {
  const t = arc.progress;
  const rgb = hexToRgb(arc.color) ?? ([255, 255, 255] as [number, number, number]);
  const [R, G, B] = rgb;

  // Control point — arc upward (perpendicular to midpoint)
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  const perp = { x: -dy / dist, y: dx / dist };
  const arcHeight = Math.min(dist * 0.4, 120);
  const cpX = midX + perp.x * arcHeight;
  const cpY = midY + perp.y * arcHeight;

  // Fading trail behind the particle (last 25% of the path)
  const tailLen = 0.25;
  const tailSteps = 20;
  for (let i = 0; i < tailSteps; i++) {
    const t0 = Math.max(0, t - tailLen * (tailSteps - i) / tailSteps);
    const t1 = Math.max(0, t - tailLen * (tailSteps - i - 1) / tailSteps);
    if (t0 >= t1 || t1 <= 0) continue;
    const p0 = evalBezier(from.x, from.y, cpX, cpY, to.x, to.y, t0);
    const p1 = evalBezier(from.x, from.y, cpX, cpY, to.x, to.y, t1);
    const alpha = (i / tailSteps) * 0.45;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.strokeStyle = `rgba(${R},${G},${B},${alpha})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Leading glow particle
  if (t > 0) {
    const pos = evalBezier(from.x, from.y, cpX, cpY, to.x, to.y, t);
    const g = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 5);
    g.addColorStop(0, `rgba(${R},${G},${B},0.95)`);
    g.addColorStop(1, `rgba(${R},${G},${B},0)`);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,0.9)`;
    ctx.fill();
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

const LEGEND_ITEMS = [
  ...Object.entries(CORPORATE_NAMES).map(([owner, name]) => ({
    owner,
    name,
    color: CORPORATE_COLORS[owner],
  })),
];

export const EnclosuresViz: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Mutable refs — updated every frame without triggering re-renders
  const planetsRef = useRef<Map<string, Planet>>(new Map());
  const clusterCentersRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const visitorsRef = useRef<Map<string, Visitor>>(new Map());
  const arcsRef = useRef<NavArc[]>([]);
  const starsRef = useRef<Star[]>([]);
  const hoveredPlanetRef = useRef<Planet | null>(null);
  const arcIdRef = useRef(0);

  // Layout inputs, held for re-layout on resize
  const domainCountsRef = useRef<Map<string, number>>(new Map());

  // React state (only for UI overlay)
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [totalDomains, setTotalDomains] = useState(0);
  const [activeVisitors, setActiveVisitors] = useState(0);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);

  // Re-compute layout when window resizes or domain data changes
  const rebuildLayout = useCallback(() => {
    const counts = domainCountsRef.current;
    if (counts.size === 0) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const { planets, clusterCenters } = buildLayout(counts, w, h);
    planetsRef.current = planets;
    clusterCentersRef.current = clusterCenters;
    starsRef.current = genStars(w, h);
    setTotalDomains(planets.size);
  }, []);

  // Fetch historical navigation events to build the planet map
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      try {
        const res = await fetch(`${RECENT_EVENTS_URL}?type=navigation&limit=10000`);
        if (!res.ok || cancelled) return;
        const events: CollectionEvent[] = await res.json();

        const counts = new Map<string, number>();
        for (const e of events) {
          const domain = (e.domain as string | undefined) ?? extractDomain(e.meta.url);
          if (!domain) continue;
          const data = e.data as { event?: string } | null;
          // Only count focus events (actual page visits, not blur/unload)
          if (data?.event && data.event !== "focus") continue;
          counts.set(domain, (counts.get(domain) ?? 0) + 1);
        }

        if (cancelled) return;
        domainCountsRef.current = counts;
        rebuildLayout();
      } catch (err) {
        console.error("[enclosures] fetch error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [rebuildLayout]);

  // Handle window resize
  useEffect(() => {
    const handler = () => rebuildLayout();
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [rebuildLayout]);

  // Live WebSocket stream — update visitor presence and emit navigation arcs
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let backoff = 1000;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(STREAM_URL);

      ws.onopen = () => {
        setConnected(true);
        backoff = 1000;
      };

      ws.onclose = () => {
        setConnected(false);
        if (!closed) setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 15_000);
      };

      ws.onerror = () => ws?.close();

      ws.onmessage = (msg) => {
        let frame: { events: CollectionEvent[] };
        try { frame = JSON.parse(msg.data as string); }
        catch { return; }
        if (!Array.isArray(frame.events)) return;

        const planets = planetsRef.current;
        const visitors = visitorsRef.current;
        const arcs = arcsRef.current;
        const now = Date.now();

        for (const e of frame.events) {
          const domain = (e.domain as string | undefined) ?? extractDomain(e.meta.url);
          if (!domain) continue;

          const pid = e.meta.pid;
          const cursorColor = e.meta.cursor_color || "#aaaaff";
          const prev = visitors.get(pid);

          // Update visitor position
          if (!prev || prev.domain !== domain) {
            // Navigation: emit an arc if both ends are known planets
            if (prev?.domain && planets.has(prev.domain) && planets.has(domain)) {
              arcs.push({
                id: String(arcIdRef.current++),
                fromDomain: prev.domain,
                toDomain: domain,
                color: cursorColor,
                progress: 0,
                startTime: now,
                duration: 2000,
              });
              // Keep arcs bounded
              while (arcs.length > 25) arcs.shift();
            }
            visitors.set(pid, {
              pid,
              domain,
              color: cursorColor,
              angle: prev?.angle ?? (seededRandom(hashStr(pid)) * Math.PI * 2),
              speed: 0.006 + seededRandom(hashStr(pid) + 1) * 0.007,
            });
          } else {
            // Same domain — update color in case it changed
            prev.color = cursorColor;
          }
        }

        // Remove visitors not seen for a while (prune stale state)
        // (simple: cap to 200 most recently active pids)
        if (visitors.size > 200) {
          const keys = [...visitors.keys()];
          keys.slice(0, keys.length - 200).forEach((k) => visitors.delete(k));
        }

        setActiveVisitors(visitors.size);
      };
    };

    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, []);

  // Canvas render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const dpr = window.devicePixelRatio || 1;

    const setupCanvas = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const resizeHandler = () => setupCanvas();
    window.addEventListener("resize", resizeHandler);
    setupCanvas();

    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const now = Date.now();
      const planets = planetsRef.current;
      const visitors = visitorsRef.current;
      const arcs = arcsRef.current;
      const clusterCenters = clusterCentersRef.current;

      drawBackground(ctx, w, h, starsRef.current);

      // Cluster zone glows (corporate territories)
      for (const [owner, center] of clusterCenters) {
        if (owner === "independent") continue;
        drawClusterZone(
          ctx,
          center.x,
          center.y,
          105,
          CORPORATE_COLORS[owner] ?? "#fff",
          CORPORATE_NAMES[owner] ?? owner.toUpperCase(),
        );
      }

      // Independent web ring
      const shortSide = Math.min(w, h);
      drawIndependentRing(ctx, w / 2, h / 2, shortSide * 0.45);

      // Navigation arcs (animate and prune)
      for (let i = arcs.length - 1; i >= 0; i--) {
        const arc = arcs[i];
        arc.progress = Math.min(1, (now - arc.startTime) / arc.duration);
        const from = planets.get(arc.fromDomain);
        const to = planets.get(arc.toDomain);
        if (from && to) drawNavArc(ctx, from, to, arc);
        if (arc.progress >= 1) arcs.splice(i, 1);
      }

      // Advance and draw visitor orbits
      for (const visitor of visitors.values()) {
        visitor.angle += visitor.speed;
        const planet = planets.get(visitor.domain);
        if (planet) drawVisitor(ctx, planet, visitor);
      }

      // Planets (draw hovered last so it's on top)
      const hovered = hoveredPlanetRef.current;
      for (const p of planets.values()) {
        if (p === hovered) continue;
        drawPlanet(ctx, p, false);
      }
      if (hovered) drawPlanet(ctx, hovered, true);

      rafId = requestAnimationFrame(draw);
    };

    rafId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resizeHandler);
    };
  }, []);

  // Hover detection — find nearest planet within click radius
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const mx = e.clientX;
    const my = e.clientY;
    let nearest: Planet | null = null;
    let nearestDist = Infinity;

    for (const p of planetsRef.current.values()) {
      const d = Math.hypot(p.x - mx, p.y - my);
      const threshold = Math.max(p.radius + 5, 10);
      if (d <= threshold && d < nearestDist) {
        nearest = p;
        nearestDist = d;
      }
    }

    hoveredPlanetRef.current = nearest;
    setTooltip(nearest ? { x: mx, y: my, planet: nearest } : null);
  }, []);

  const handleMouseLeave = useCallback(() => {
    hoveredPlanetRef.current = null;
    setTooltip(null);
  }, []);

  return (
    <div className="enc-root" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <canvas ref={canvasRef} />

      <div className="enc-header">
        <h1>occupied territories</h1>
        <p>collective attention, concentrated</p>
      </div>

      <div className="enc-legend">
        {LEGEND_ITEMS.map(({ owner, name, color }) => (
          <div key={owner} className="enc-legend-item">
            <div className="enc-legend-dot" style={{ background: color }} />
            <span className="enc-legend-label">{name}</span>
          </div>
        ))}
      </div>

      <div className="enc-stats">
        <div className="enc-stat">{totalDomains} domains mapped</div>
        {activeVisitors > 0 && (
          <div className="enc-stat">{activeVisitors} online now</div>
        )}
        <div className={`enc-stat ${connected ? "live" : "offline"}`}>
          {connected ? "● live" : "○ connecting..."}
        </div>
      </div>

      {tooltip && (
        <div
          className="enc-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="enc-tooltip-domain">{tooltip.planet.domain}</div>
          <div className="enc-tooltip-detail">
            <span>{tooltip.planet.visitCount} visits</span>
            {tooltip.planet.owner !== "independent" && (
              <span>{CORPORATE_NAMES[tooltip.planet.owner] ?? tooltip.planet.owner}</span>
            )}
          </div>
        </div>
      )}

      {loading && (
        <div className="enc-loading">mapping the territory...</div>
      )}

      <div className="enc-attr">wewere.online</div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("reactContent") as HTMLElement).render(
  <EnclosuresViz />,
);
