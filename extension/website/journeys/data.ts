// ABOUTME: Loads navigation events (live worker, synthetic fallback) and turns each
// ABOUTME: page focus into a routed Journey from the user's origin to the server.

import { RECENT_EVENTS_URL } from "../shared/config";
import { GeoPoint, domainToGeo, haversineKm, hashString, tzToGeo } from "./geo";
import { routeJourney } from "./cables";

const FIBER_KM_PER_MS = 200; // ~⅔ c — propagation speed of light in glass fiber.
const MIN_LIVE_JOURNEYS = 12; // below this, fall back to the synthetic swarm.
const MAX_JOURNEYS = 900; // cap for animation performance.

export interface Journey {
  pid: string;
  domain: string;
  ts: number;
  color: string;
  origin: GeoPoint;
  originKey: string; // stable key for de-duping origin glyphs
  dest: GeoPoint;
  waypoints: GeoPoint[];
  cableName: string | null;
  km: number;
  latencyMs: number; // one-way real propagation time
}

export interface LoadResult {
  journeys: Journey[];
  source: "live" | "synthetic";
}

// ── Raw event shape (subset of the navigation event we consume) ───────────────
interface RawEvent {
  type: string;
  ts: number;
  data?: { event?: string };
  meta?: {
    pid?: string;
    sid?: string;
    url?: string;
    tz?: string;
    cursor_color?: string | null;
  };
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function colorForPid(pid: string, given?: string | null): string {
  if (given) return given;
  return `hsl(${hashString(pid) % 360}, 55%, 70%)`;
}

function buildJourney(
  pid: string,
  color: string,
  domain: string,
  ts: number,
  origin: GeoPoint,
  originKey: string,
): Journey | null {
  const { geo: dest } = domainToGeo(domain);
  const { waypoints, cableName } = routeJourney(origin, dest);
  let km = 0;
  for (let i = 1; i < waypoints.length; i++) {
    km += haversineKm(waypoints[i - 1], waypoints[i]);
  }
  return {
    pid,
    domain,
    ts,
    color,
    origin,
    originKey,
    dest,
    waypoints,
    cableName,
    km,
    latencyMs: km / FIBER_KM_PER_MS,
  };
}

// ── Live transform ────────────────────────────────────────────────────────────
function transformEvents(events: RawEvent[]): Journey[] {
  const focus = events
    .filter((e) => e.type === "navigation" && e.data?.event === "focus" && e.meta?.url)
    .sort((a, b) => a.ts - b.ts);

  const journeys: Journey[] = [];
  const lastDomainBySession = new Map<string, string>();

  for (const e of focus) {
    const meta = e.meta!;
    const url = meta.url!;
    const domain = hostnameOf(url);
    if (!domain) continue;
    const pid = meta.pid ?? "anon";
    const sid = meta.sid ?? pid;

    // Collapse consecutive focuses on the same domain within a session.
    if (lastDomainBySession.get(sid) === domain) continue;
    lastDomainBySession.set(sid, domain);

    const origin = tzToGeo(meta.tz);
    if (!origin) continue;
    const originKey = meta.tz ?? pid;

    const j = buildJourney(pid, colorForPid(pid, meta.cursor_color), domain, e.ts, origin, originKey);
    if (j) journeys.push(j);
  }

  return journeys.slice(-MAX_JOURNEYS);
}

// ── Synthetic swarm ───────────────────────────────────────────────────────────
// A believable stand-in: a handful of participants in different timezones, each
// with a session of page visits over the last ~18 hours.
const SYNTH_PARTICIPANTS: { pid: string; tz: string; color: string }[] = [
  { pid: "syn-ny", tz: "America/New_York", color: "hsl(8, 70%, 72%)" },
  { pid: "syn-sf", tz: "America/Los_Angeles", color: "hsl(48, 70%, 72%)" },
  { pid: "syn-ldn", tz: "Europe/London", color: "hsl(150, 55%, 70%)" },
  { pid: "syn-ber", tz: "Europe/Berlin", color: "hsl(200, 60%, 72%)" },
  { pid: "syn-sao", tz: "America/Sao_Paulo", color: "hsl(280, 55%, 74%)" },
  { pid: "syn-tok", tz: "Asia/Tokyo", color: "hsl(330, 60%, 74%)" },
  { pid: "syn-sgp", tz: "Asia/Singapore", color: "hsl(95, 50%, 70%)" },
  { pid: "syn-syd", tz: "Australia/Sydney", color: "hsl(20, 65%, 72%)" },
];

const SYNTH_DOMAINS = [
  "google.com", "youtube.com", "wikipedia.org", "reddit.com", "twitter.com",
  "github.com", "nytimes.com", "bbc.co.uk", "amazon.com", "netflix.com",
  "spotify.com", "chatgpt.com", "claude.ai", "stackoverflow.com", "instagram.com",
  "baidu.com", "taobao.com", "rakuten.co.jp", "flipkart.com", "mercadolibre.com",
  "theguardian.com", "apple.com", "booking.com", "naver.com",
];

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthesize(): Journey[] {
  const rand = mulberry32(20240611);
  const now = Date.now();
  const windowMs = 18 * 60 * 60 * 1000;
  const journeys: Journey[] = [];

  for (const p of SYNTH_PARTICIPANTS) {
    const origin = tzToGeo(p.tz)!;
    const visits = 14 + Math.floor(rand() * 18);
    let t = now - windowMs + rand() * windowMs * 0.3;
    let lastDomain = "";
    for (let i = 0; i < visits; i++) {
      t += rand() * (windowMs / visits);
      if (t > now) break;
      const domain = SYNTH_DOMAINS[Math.floor(rand() * SYNTH_DOMAINS.length)];
      if (domain === lastDomain) continue;
      lastDomain = domain;
      const j = buildJourney(p.pid, p.color, domain, t, origin, p.tz);
      if (j) journeys.push(j);
    }
  }

  journeys.sort((a, b) => a.ts - b.ts);
  return journeys;
}

// ── Public loader ─────────────────────────────────────────────────────────────
export async function loadJourneys(): Promise<LoadResult> {
  try {
    const params = new URLSearchParams({
      type: "navigation",
      limit: "4000",
      require_title: "true",
    });
    const res = await fetch(`${RECENT_EVENTS_URL}?${params}`);
    if (res.ok) {
      const events = (await res.json()) as RawEvent[];
      const journeys = transformEvents(events);
      if (journeys.length >= MIN_LIVE_JOURNEYS) {
        return { journeys, source: "live" };
      }
      console.warn(
        `[journeys] only ${journeys.length} live journeys — using synthetic swarm`,
      );
    }
  } catch (err) {
    console.warn("[journeys] live fetch failed — using synthetic swarm", err);
  }
  return { journeys: synthesize(), source: "synthetic" };
}
