// ABOUTME: Entry point for "night shift" — a live city where every lit window is a
// ABOUTME: person browsing right now, housed in buildings owned by whoever owns the domain.
//
// The live stream only carries cursor events — pure human gesture — but each one
// knows where it happened (meta.url), what time it is for that person (meta.tz),
// and what color they chose. This piece reads that as: people, and the buildings
// they're inside of. Corporate towers grow with their share of collected
// attention; the independent web stays a low street of little houses, each with
// its own name. The humans are the lights; the consolidation is the architecture.

import "./nightshift.scss";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactDOM from "react-dom/client";
import type { CollectionEvent } from "../shared/types";
import { RECENT_EVENTS_URL } from "../shared/config";
import { useLiveEvents } from "../shared/hooks/useLiveEvents";
import { LiveIndicator } from "../shared/components/LiveIndicator";
import {
  ACTIVE_PEOPLE_WINDOW_MS,
  extractDomain,
  hashParticipantId,
  summarizeActiveLocations,
} from "../shared/utils/eventUtils";
import { getOwner, resolveOwner } from "../shared/utils/corporations";
import {
  buildingKeyFor,
  derivePeople,
  layoutSkyline,
  type HouseInput,
  type PersonLight,
  type SkylineLayout,
  type TowerInput,
} from "../shared/utils/skyline";

const SEED_LIMIT = 3000;
/** Dark houses stay on the street this long after their last light goes out. */
const HOUSE_LINGER_MS = 10 * 60_000;
const GROUND_MARGIN = 96;
const LAYOUT_INTERVAL_MS = 2000;
const TICKER_INTERVAL_MS = 1600;
const MAX_TICKER_LINES = 5;
const MAX_LINES_PER_TICK = 4;

// ── Small helpers ─────────────────────────────────────────────────────────────

/** "4:12 am" in the participant's own timezone, or null if tz is unusable. */
function localTimeFor(tz: string | undefined, now: number): string | null {
  if (!tz) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    })
      .format(new Date(now))
      .toLowerCase();
  } catch {
    return null;
  }
}

function viewerClock(now: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(now));
}

// ── Seed fetch: pre-warm the city from recent history ─────────────────────────

function useSeedEvents(): { seed: CollectionEvent[]; seedLoaded: boolean } {
  const [seed, setSeed] = useState<CollectionEvent[]>([]);
  const [seedLoaded, setSeedLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${RECENT_EVENTS_URL}?type=cursor&limit=${SEED_LIMIT}`,
        );
        if (!res.ok) throw new Error(`seed fetch failed: ${res.status}`);
        const data: CollectionEvent[] = await res.json();
        if (!cancelled) setSeed(data);
      } catch (err) {
        // The live stream alone still works; the city just starts empty.
        console.warn("[nightshift] seed fetch failed:", err);
      } finally {
        if (!cancelled) setSeedLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { seed, seedLoaded };
}

// ── Ticker types ──────────────────────────────────────────────────────────────

interface TickerLine {
  id: number;
  time: string;
  text: string;
}

interface SlotAssignment {
  slot: number;
  /** When this person's light first came on (drives the fade-in). */
  since: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  phase: number;
  speed: number;
}

// ── Main component ────────────────────────────────────────────────────────────

const NightShift = () => {
  const { seed, seedLoaded } = useSeedEvents();
  const { events: live, connected } = useLiveEvents({ maxEvents: 2000 });

  const merged = useMemo(() => {
    const seenIds = new Set<string>();
    const out: CollectionEvent[] = [];
    for (const e of [...seed, ...live]) {
      if (!e.id || seenIds.has(e.id)) continue;
      seenIds.add(e.id);
      out.push(e);
    }
    return out;
  }, [seed, live]);

  // Cumulative, monotonic counters — the architecture remembers everything the
  // session has seen even after events age out of the sliding buffer. Towers
  // never shrink; dark houses linger and then the street forgets them.
  const cumRef = useRef({
    counted: new Set<string>(),
    ownerCounts: new Map<string, number>(),
    domainLastTs: new Map<string, number>(),
  });

  const peopleRef = useRef<Map<string, PersonLight>>(new Map());

  useEffect(() => {
    const now = Date.now();
    const cum = cumRef.current;
    for (const e of merged) {
      if (e.type !== "cursor" || !e.id || cum.counted.has(e.id)) continue;
      cum.counted.add(e.id);
      const domain = extractDomain(e.meta?.url ?? "");
      if (!domain) continue;
      const owner = resolveOwner(domain);
      const ts = Math.min(e.ts, now);
      if (owner.kind === "indie") {
        const prev = cum.domainLastTs.get(domain) ?? 0;
        cum.domainLastTs.set(domain, Math.max(prev, ts));
      } else {
        cum.ownerCounts.set(owner.id, (cum.ownerCounts.get(owner.id) ?? 0) + 1);
      }
    }
    peopleRef.current = derivePeople(merged, now);
  }, [merged]);

  // ── Layout + slot assignment (slow cadence, so windows don't jump) ─────────

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  const layoutRef = useRef<SkylineLayout>({
    buildings: [],
    overflowDomains: 0,
    scale: 1,
  });
  const assignRef = useRef<Map<string, Map<string, SlotAssignment>>>(new Map());
  const starsRef = useRef<Star[]>([]);

  const recomputeLayout = useCallback(() => {
    const now = Date.now();
    const cum = cumRef.current;
    const active = [...peopleRef.current.values()].filter(
      (p) => now - p.lastTs < ACTIVE_PEOPLE_WINDOW_MS,
    );

    const occupantsByKey = new Map<string, number>();
    for (const p of active) {
      const key = buildingKeyFor(p);
      occupantsByKey.set(key, (occupantsByKey.get(key) ?? 0) + 1);
    }

    const towers: TowerInput[] = [...cum.ownerCounts.entries()].map(
      ([id, count]) => ({
        owner: getOwner(id),
        cumEvents: count,
        occupants: occupantsByKey.get(id) ?? 0,
      }),
    );

    const houses: HouseInput[] = [...cum.domainLastTs.entries()]
      .filter(
        ([domain, ts]) =>
          now - ts < HOUSE_LINGER_MS ||
          (occupantsByKey.get(`indie:${domain}`) ?? 0) > 0,
      )
      .map(([domain, ts]) => ({
        domain,
        occupants: occupantsByKey.get(`indie:${domain}`) ?? 0,
        lastTs: ts,
      }));

    const { width, height } = sizeRef.current;
    if (width === 0) return;
    layoutRef.current = layoutSkyline({
      width,
      groundY: height - GROUND_MARGIN,
      maxHeight: height * 0.6,
      towers,
      houses,
    });

    // Reconcile window-slot assignments: people keep their window while they
    // stay in a building; departures free slots; arrivals take the lowest one.
    const buildingsByKey = new Map(
      layoutRef.current.buildings.map((b) => [b.key, b]),
    );
    const next = new Map<string, Map<string, SlotAssignment>>();
    for (const p of active) {
      const key = buildingKeyFor(p);
      const building = buildingsByKey.get(key);
      if (!building) continue;
      let perBuilding = next.get(key);
      if (!perBuilding) {
        perBuilding = new Map();
        next.set(key, perBuilding);
      }
      const prev = assignRef.current.get(key)?.get(p.pid);
      perBuilding.set(p.pid, prev ?? { slot: -1, since: now });
    }
    for (const [key, perBuilding] of next) {
      const building = buildingsByKey.get(key)!;
      const used = new Set<number>();
      for (const a of perBuilding.values()) {
        if (a.slot >= 0 && a.slot < building.slots.length && !used.has(a.slot)) {
          used.add(a.slot);
        } else {
          a.slot = -1;
        }
      }
      // Scatter arrivals across the building instead of stacking the bottom
      // floor: start from a pid-hashed slot and probe upward for a free one.
      // Buildings at night have lights all over, not a full ground floor.
      for (const [pid, a] of perBuilding) {
        if (a.slot >= 0) continue;
        const len = building.slots.length;
        if (used.size >= len) break; // building is full
        const start = hashParticipantId(pid) % len;
        for (let i = 0; i < len; i++) {
          const candidate = (start + i) % len;
          if (!used.has(candidate)) {
            a.slot = candidate;
            used.add(candidate);
            break;
          }
        }
      }
    }
    assignRef.current = next;
  }, []);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const width = window.innerWidth;
      const height = window.innerHeight;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      sizeRef.current = { width, height, dpr };

      const starCount = Math.round((width * height) / 9000);
      const stars: Star[] = [];
      for (let i = 0; i < starCount; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * (height - GROUND_MARGIN) * 0.92,
          r: 0.4 + Math.random() * 1.1,
          phase: Math.random() * Math.PI * 2,
          speed: 0.0004 + Math.random() * 0.0012,
        });
      }
      starsRef.current = stars;
      recomputeLayout();
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [recomputeLayout]);

  useEffect(() => {
    const interval = setInterval(recomputeLayout, LAYOUT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [recomputeLayout]);

  // Recompute promptly once data first lands so the city doesn't wait 2s.
  useEffect(() => {
    recomputeLayout();
  }, [merged, recomputeLayout]);

  // ── Hover tooltip ───────────────────────────────────────────────────────────

  const litWindowsRef = useRef<
    Array<{ x: number; y: number; w: number; h: number; person: PersonLight }>
  >([]);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    person: PersonLight;
  } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const PADDING = 3;
      const hit = litWindowsRef.current.find(
        (w) =>
          e.clientX >= w.x - PADDING &&
          e.clientX <= w.x + w.w + PADDING &&
          e.clientY >= w.y - PADDING &&
          e.clientY <= w.y + w.h + PADDING,
      );
      // Avoid a state churn per mousemove while nothing is hovered.
      setTooltip((prev) =>
        hit
          ? { x: e.clientX, y: e.clientY, person: hit.person }
          : prev === null
            ? prev
            : null,
      );
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // ── Ticker + stats ──────────────────────────────────────────────────────────

  const [ticker, setTicker] = useState<TickerLine[]>([]);
  const [stats, setStats] = useState({
    people: 0,
    timezones: 0,
    continents: 0,
    corpShare: 0,
    corpCount: 0,
  });
  const prevActiveRef = useRef<Map<
    string,
    { domain: string; ownerName: string; ownerKind: string }
  > | null>(null);
  const lineIdRef = useRef(0);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const active = [...peopleRef.current.values()].filter(
        (p) => now - p.lastTs < ACTIVE_PEOPLE_WINDOW_MS,
      );

      const current = new Map(
        active.map((p) => [
          p.pid,
          {
            domain: p.domain,
            ownerName: p.owner.name,
            ownerKind: p.owner.kind,
          },
        ]),
      );

      const inCorp = active.filter((p) => p.owner.kind === "corp");
      const corpOwners = new Set(inCorp.map((p) => p.owner.id));
      const located = summarizeActiveLocations(merged, undefined, now);
      setStats({
        people: active.length,
        timezones: located.timezones,
        continents: located.continents,
        corpShare: active.length === 0 ? 0 : inCorp.length / active.length,
        corpCount: corpOwners.size,
      });

      const prev = prevActiveRef.current;
      prevActiveRef.current = current;
      // First pass after connect replays the whole buffer; narrate from the
      // second pass on so the opening isn't a flood of "light comes on".
      if (prev === null) return;

      const fresh: TickerLine[] = [];
      const time = viewerClock(now);
      const push = (text: string) => {
        if (fresh.length >= MAX_LINES_PER_TICK) return;
        fresh.push({ id: lineIdRef.current++, time, text });
      };

      for (const [pid, cur] of current) {
        const was = prev.get(pid);
        const person = peopleRef.current.get(pid);
        const them = localTimeFor(person?.tz, now);
        if (!was) {
          push(
            `a light comes on in ${cur.domain} — ${cur.ownerName}${them ? ` · ${them} for them` : ""}`,
          );
        } else if (was.domain !== cur.domain) {
          push(`someone moves from ${was.domain} into ${cur.domain}`);
        }
      }
      for (const [pid, was] of prev) {
        if (!current.has(pid)) push(`a light goes out in ${was.domain}`);
      }

      if (fresh.length > 0) {
        setTicker((lines) => [...lines, ...fresh].slice(-MAX_TICKER_LINES));
      }
    };

    const interval = setInterval(tick, TICKER_INTERVAL_MS);
    tick();
    return () => clearInterval(interval);
  }, [merged]);

  // ── Canvas draw loop ────────────────────────────────────────────────────────

  useEffect(() => {
    let raf: number;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { width, height, dpr } = sizeRef.current;
      if (width === 0) return;
      const now = Date.now();
      const t = performance.now();
      const groundY = height - GROUND_MARGIN;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Sky
      const sky = ctx.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, "#05080f");
      sky.addColorStop(0.65, "#0b1322");
      sky.addColorStop(1, "#141d33");
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, width, height);

      // Stars
      for (const s of starsRef.current) {
        const twinkle = 0.35 + 0.3 * Math.sin(t * s.speed + s.phase);
        ctx.globalAlpha = twinkle;
        ctx.fillStyle = "#dfe6f5";
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Moon
      const moonX = width * 0.82;
      const moonY = height * 0.16;
      ctx.save();
      ctx.shadowColor = "rgba(232, 226, 213, 0.6)";
      ctx.shadowBlur = 26;
      ctx.fillStyle = "rgba(232, 226, 213, 0.8)";
      ctx.beginPath();
      ctx.arc(moonX, moonY, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "#0a111f";
      ctx.beginPath();
      ctx.arc(moonX - 6, moonY - 4, 12, 0, Math.PI * 2);
      ctx.fill();

      // Ground
      ctx.fillStyle = "#04060c";
      ctx.fillRect(0, groundY, width, height - groundY);
      ctx.strokeStyle = "rgba(232, 226, 213, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, groundY + 0.5);
      ctx.lineTo(width, groundY + 0.5);
      ctx.stroke();

      const layout = layoutRef.current;
      const people = peopleRef.current;
      const litWindows: typeof litWindowsRef.current = [];

      // Tallest towers get the blinking aircraft-warning light.
      const towerTops = layout.buildings
        .filter((b) => b.owner.kind === "corp")
        .map((b) => b.topY)
        .sort((a, b) => a - b);
      const antennaCutoff = towerTops.length > 0 ? towerTops[Math.min(1, towerTops.length - 1)] : -1;

      for (const b of layout.buildings) {
        const bodyH = b.baseY - b.topY;
        const shade = 8 + (b.seed % 5);
        ctx.fillStyle = `rgb(${shade + 4}, ${shade + 8}, ${shade + 18})`;
        ctx.fillRect(b.x, b.topY, b.w, bodyH);
        ctx.strokeStyle = "rgba(223, 230, 245, 0.07)";
        ctx.strokeRect(b.x + 0.5, b.topY + 0.5, b.w - 1, bodyH - 1);

        // Roofline by kind
        if (b.owner.kind === "indie") {
          // Gabled roof
          ctx.fillStyle = `rgb(${shade + 8}, ${shade + 12}, ${shade + 22})`;
          ctx.beginPath();
          ctx.moveTo(b.x - 3, b.topY);
          ctx.lineTo(b.x + b.w / 2, b.topY - 12);
          ctx.lineTo(b.x + b.w + 3, b.topY);
          ctx.closePath();
          ctx.fill();
        } else if (b.owner.kind === "nonprofit") {
          // Civic pediment — the library of the internet
          ctx.fillStyle = `rgb(${shade + 10}, ${shade + 14}, ${shade + 24})`;
          ctx.beginPath();
          ctx.moveTo(b.x - 4, b.topY);
          ctx.lineTo(b.x + b.w / 2, b.topY - 16);
          ctx.lineTo(b.x + b.w + 4, b.topY);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "rgba(223, 230, 245, 0.12)";
          ctx.stroke();
        } else {
          // Corporate flat roof + antenna on the tallest
          if (b.topY <= antennaCutoff) {
            const ax = b.x + b.w / 2;
            ctx.strokeStyle = "rgba(223, 230, 245, 0.25)";
            ctx.beginPath();
            ctx.moveTo(ax, b.topY);
            ctx.lineTo(ax, b.topY - 18);
            ctx.stroke();
            const blink = 0.35 + 0.65 * Math.abs(Math.sin(t / 900 + b.seed));
            ctx.globalAlpha = blink;
            ctx.fillStyle = "#ff5a4e";
            ctx.beginPath();
            ctx.arc(ax, b.topY - 20, 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }

        // Unlit windows first
        ctx.fillStyle = "rgba(190, 205, 235, 0.055)";
        for (const s of b.slots) {
          ctx.fillRect(s.x, s.y, s.w, s.h);
        }

        // Lit windows: one per person assigned to this building
        const assignments = assignRef.current.get(b.key);
        if (assignments) {
          for (const [pid, a] of assignments) {
            if (a.slot < 0 || a.slot >= b.slots.length) continue;
            const p = people.get(pid);
            if (!p) continue;
            const age = now - p.lastTs;
            if (age > ACTIVE_PEOPLE_WINDOW_MS) continue;

            const s = b.slots[a.slot];
            const fadeIn = Math.min(1, (now - a.since) / 1200);
            const movement = Math.min(1, p.recentCount / 12);
            const recencyDim =
              age < 12_000
                ? 1
                : 1 - 0.6 * ((age - 12_000) / (ACTIVE_PEOPLE_WINDOW_MS - 12_000));
            const flicker =
              1 + 0.07 * Math.sin(t / 240 + hashParticipantId(pid) % 7);
            const clickAge = now - p.lastClickTs;
            const clickBoost = clickAge < 650 ? 1 - clickAge / 650 : 0;

            const alpha = Math.min(
              1,
              (0.45 + 0.4 * movement) * recencyDim * flicker * fadeIn +
                clickBoost * 0.5,
            );

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.shadowColor = p.color;
            ctx.shadowBlur = 7 + clickBoost * 14;
            ctx.fillStyle = p.color;
            ctx.fillRect(s.x, s.y, s.w, s.h);
            ctx.restore();

            litWindows.push({ x: s.x, y: s.y, w: s.w, h: s.h, person: p });
          }
        }

        // Labels
        ctx.fillStyle = "rgba(223, 230, 245, 0.35)";
        ctx.textAlign = "center";
        if (b.owner.kind === "indie") {
          ctx.save();
          ctx.translate(b.x + b.w / 2, b.baseY + 12);
          ctx.rotate(Math.PI / 7);
          ctx.textAlign = "left";
          ctx.font = "8.5px 'Martian Mono', monospace";
          ctx.fillStyle = "rgba(223, 230, 245, 0.3)";
          ctx.fillText(b.label, 0, 0, 110);
          ctx.restore();
        } else {
          ctx.font = "9px 'Martian Mono', monospace";
          // Stagger label rows (stable per building) so narrow neighbors
          // don't overlap each other.
          const labelY = b.baseY + (b.seed % 2 === 0 ? 16 : 30);
          ctx.fillText(b.label.toUpperCase(), b.x + b.w / 2, labelY, b.w + 26);
        }
      }

      // Street sign where the independent web begins
      const firstHouse = layout.buildings.find((b) => b.owner.kind === "indie");
      if (firstHouse) {
        const signX = firstHouse.x - 26 * layout.scale;
        ctx.strokeStyle = "rgba(223, 230, 245, 0.3)";
        ctx.beginPath();
        ctx.moveTo(signX, groundY);
        ctx.lineTo(signX, groundY - 34);
        ctx.stroke();
        ctx.font = "italic 12px 'Source Serif 4', serif";
        ctx.fillStyle = "rgba(232, 226, 213, 0.55)";
        ctx.textAlign = "left";
        ctx.fillText("the independent web →", signX - 4, groundY - 40);
      }

      // Overflow note: lights further down the street than we can draw
      if (layout.overflowDomains > 0) {
        ctx.font = "italic 11px 'Source Serif 4', serif";
        ctx.fillStyle = "rgba(232, 226, 213, 0.4)";
        ctx.textAlign = "right";
        ctx.fillText(
          `+ ${layout.overflowDomains} more down the road…`,
          width - 16,
          groundY - 8,
        );
      }

      ctx.restore();
      litWindowsRef.current = litWindows;
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Chrome ──────────────────────────────────────────────────────────────────

  const consolidationLabel =
    stats.people > 0 && stats.corpCount > 0
      ? `${Math.round(stats.corpShare * 100)}% of lights are inside ${stats.corpCount} ${stats.corpCount === 1 ? "corporation" : "corporations"}`
      : null;

  const showEmpty = seedLoaded && connected && stats.people === 0;
  const tooltipPerson = tooltip?.person;
  const tooltipTime = tooltipPerson
    ? localTimeFor(tooltipPerson.tz, Date.now())
    : null;
  const tooltipActivity = tooltipPerson
    ? Date.now() - tooltipPerson.lastClickTs < 2000
      ? "clicking"
      : tooltipPerson.recentCount > 3
        ? "moving"
        : "reading, maybe"
    : null;

  return (
    <>
      <canvas ref={canvasRef} className="nightshift-canvas" />

      <div className="nightshift-wordmark">
        <div className="title">we were online</div>
        <div className="subtitle">
          night shift — every lit window is a person browsing right now. the
          buildings are who owns where they are.
        </div>
      </div>

      <div className="nightshift-stats">
        <LiveIndicator
          connected={connected}
          peopleCount={stats.people}
          timezones={stats.timezones}
          continents={stats.continents}
        />
        {consolidationLabel && (
          <span className="consolidation">{consolidationLabel}</span>
        )}
      </div>

      <div className="nightshift-ticker">
        {ticker.map((line, i) => (
          <div
            key={line.id}
            className="line"
            style={{ opacity: 0.35 + (0.65 * (i + 1)) / ticker.length }}
          >
            <span className="time">{line.time}</span>
            {line.text}
          </div>
        ))}
      </div>

      {showEmpty && (
        <div className="nightshift-empty">
          the street is dark right now — everyone has logged off.
        </div>
      )}

      {tooltip && tooltipPerson && (
        <div
          className="nightshift-tooltip"
          style={{
            left: Math.min(tooltip.x + 14, window.innerWidth - 290),
            top: tooltip.y - 12,
          }}
        >
          someone on {tooltipPerson.domain}
          <br />
          <span className="owner">
            {tooltipPerson.owner.kind === "indie"
              ? "the independent web"
              : `owned by ${tooltipPerson.owner.name}`}
            {tooltipTime ? ` · ${tooltipTime} where they are` : ""}
            {tooltipActivity ? ` · ${tooltipActivity}` : ""}
          </span>
        </div>
      )}
    </>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<NightShift />);
