// ABOUTME: Derives calendar-period walking records from locally collected browsing events.
// ABOUTME: Ranks departures, dormant familiar sites, time spent, and representative traces.

import type {
  CollectionEvent,
  CursorEventData,
  NavigationEventData,
} from "../collectors/types";
import type {
  ScreenTimeSession,
  WalkingRecordTrace,
  WalkingRecordTracePoint,
  WalkingRecordTraceTarget,
} from "../storage/LocalEventStore";
import { risoInkColor } from "../utils/risoInk";
import { extractDomain, normalizeUrl } from "../utils/urlNormalization";
import { parseColorToHsl } from "@movement/utils/eventUtils";

const DAY_MS = 24 * 60 * 60 * 1000;
const SMALL_SITE_MAX_VISITS = 5;
const FAMILIAR_SITE_MIN_VISITS = 10;
const FAMILIAR_SITE_MIN_SPAN_DAYS = 14;
const MAIN_ROAD_LIMIT = 20;
const DEPARTURE_TRACE_MAX_MS = 30 * 60_000;
const TIME_SPENT_SITE_LIMIT = 6;
const PAGE_HUE_SHIFTS = [-28, -18, -10, 10, 18, 28];

const POPULAR_DOMAIN_ROOTS = [
  "amazon.com",
  "apple.com",
  "bing.com",
  "canva.com",
  "chatgpt.com",
  "claude.ai",
  "discord.com",
  "docs.google.com",
  "dropbox.com",
  "ebay.com",
  "facebook.com",
  "figma.com",
  "github.com",
  "gmail.com",
  "google.com",
  "instagram.com",
  "linkedin.com",
  "medium.com",
  "microsoft.com",
  "netflix.com",
  "notion.so",
  "nytimes.com",
  "office.com",
  "pinterest.com",
  "reddit.com",
  "slack.com",
  "spotify.com",
  "tiktok.com",
  "twitch.tv",
  "twitter.com",
  "wikipedia.org",
  "x.com",
  "yahoo.com",
  "youtube.com",
] as const;

export interface WalkingRecordRange {
  startTs: number;
  endTs: number;
}

export type WalkingRecordPeriod = "week" | "month" | "year";

export interface WalkingRecordPeriodSummary {
  offset: number;
  range: WalkingRecordRange;
  totalTimeMs: number;
}

interface BrowsingPortrait {
  totalTimeMs: number;
  cursorDistancePx: number;
  pageCount: number;
  hourBuckets: number[];
}

export interface WalkingRecordDomain {
  domain: string;
  eventCount: number;
  lastVisit: number;
  firstVisit: number;
  totalTimeMs: number;
  uniquePageCount: number;
  sessionCount: number;
  eventCounts: Record<string, number>;
}

export interface Departure {
  day: string;
  verb: "departed";
  from: string;
  to: string;
  toUrl: string;
  note: string;
  familiarity: string;
  hue: string;
  accentHue: string;
  score: number;
  traceTarget?: WalkingRecordTraceTarget;
  tracePaths: WalkingRecordTracePoint[][];
}

export interface Revisit {
  span: string;
  site: string;
  href: string;
  memory: string;
  hue: string;
  score: number;
}

export interface DayPlate {
  date: string;
  day: string;
  vignette: string;
  hue: string;
  traceTarget?: WalkingRecordTraceTarget;
  tracePaths: WalkingRecordTracePoint[][];
}

export interface TimeSpentEntry {
  rank: number;
  site: string;
  time: string;
  percentage: number;
  hue: string;
  note: string;
  href?: string;
}

export interface WalkingRecord {
  period: WalkingRecordPeriod;
  range: WalkingRecordRange;
  rangeLabel: string;
  totalTimeMs: number;
  totalTimeLabel: string;
  cursorDistancePx: number;
  pageCount: number;
  hourBuckets: number[];
  movementCount: number;
  departures: Departure[];
  revisits: Revisit[];
  dayPlates: DayPlate[];
  timeSpent: TimeSpentEntry[];
  timeSpentIntro: string;
}

interface WalkingRecordInput {
  period: WalkingRecordPeriod;
  baseColor: string;
  events: CollectionEvent[];
  sessions: ScreenTimeSession[];
  domains: WalkingRecordDomain[];
  range: WalkingRecordRange;
  cursorDistancePx?: number;
  nowTs?: number;
}

interface DomainTime {
  domain: string;
  totalMs: number;
  sessions: ScreenTimeSession[];
}

interface FocusVisit {
  ts: number;
  domain: string;
  url: string;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getWalkingRecordPeriodRange(
  period: WalkingRecordPeriod,
  periodOffset = 0,
  now = new Date(),
): WalkingRecordRange {
  const currentDay = startOfLocalDay(now);
  if (period === "week") {
    const daysSinceMonday = (currentDay.getDay() + 6) % 7;
    const periodStart = new Date(currentDay);
    periodStart.setDate(
      periodStart.getDate() - daysSinceMonday + periodOffset * 7,
    );
    const nextPeriod = new Date(periodStart);
    nextPeriod.setDate(nextPeriod.getDate() + 7);
    return {
      startTs: periodStart.getTime(),
      endTs: nextPeriod.getTime() - 1,
    };
  }

  if (period === "month") {
    const periodStart = new Date(
      currentDay.getFullYear(),
      currentDay.getMonth() + periodOffset,
      1,
    );
    const nextPeriod = new Date(
      periodStart.getFullYear(),
      periodStart.getMonth() + 1,
      1,
    );
    return {
      startTs: periodStart.getTime(),
      endTs: nextPeriod.getTime() - 1,
    };
  }

  const periodStart = new Date(
    currentDay.getFullYear() + periodOffset,
    0,
    1,
  );
  const nextPeriod = new Date(periodStart.getFullYear() + 1, 0, 1);
  return {
    startTs: periodStart.getTime(),
    endTs: nextPeriod.getTime() - 1,
  };
}

export function summarizeWalkingRecordPeriods(
  period: WalkingRecordPeriod,
  sessions: ScreenTimeSession[],
  count = 12,
  now = new Date(),
): WalkingRecordPeriodSummary[] {
  return Array.from({ length: count }, (_, index) => {
    const offset = index - count + 1;
    const range = getWalkingRecordPeriodRange(period, offset, now);
    const totalTimeMs = sessions
      .filter(
        (session) =>
          session.focusTs >= range.startTs && session.focusTs <= range.endTs,
      )
      .reduce((sum, session) => sum + session.durationMs, 0);

    return { offset, range, totalTimeMs };
  });
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return "0 min";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "< 1 min";
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourLabel = `${hours} hr${hours === 1 ? "" : "s"}`;
  return minutes === 0 ? hourLabel : `${hourLabel} ${minutes} min`;
}

export function formatRange(range: WalkingRecordRange): string {
  const start = new Date(range.startTs);
  const end = new Date(range.endTs);
  const month = new Intl.DateTimeFormat("en", { month: "short" });

  if (
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth()
  ) {
    return `${month.format(start).toLowerCase()} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
  }

  return `${month.format(start).toLowerCase()} ${start.getDate()} – ${month
    .format(end)
    .toLowerCase()} ${end.getDate()}, ${end.getFullYear()}`;
}

function domainMatchesRoot(domain: string, root: string): boolean {
  return domain === root || domain.endsWith(`.${root}`);
}

function isPopularDomain(domain: string): boolean {
  return POPULAR_DOMAIN_ROOTS.some((root) => domainMatchesRoot(domain, root));
}

function hashDomain(domain: string): number {
  let hash = 0;
  for (const character of domain) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function seededValue(seed: number, offset: number): number {
  const value = Math.sin(seed + offset * 12.9898) * 43_758.5453;
  return value - Math.floor(value);
}

function derivedSessionPath(
  target: WalkingRecordTraceTarget,
): WalkingRecordTracePoint[][] {
  const seed = hashDomain(`${target.url}:${target.startTs}:${target.endTs}`);
  const durationMinutes = Math.max(
    1,
    (target.endTs - target.startTs) / 60_000,
  );
  const pointCount = Math.min(
    11,
    4 + Math.floor(Math.log2(durationMinutes + 1)),
  );
  const points: WalkingRecordTracePoint[] = [];
  let x = 0.18 + seededValue(seed, 0) * 0.64;
  let y = 0.18 + seededValue(seed, 1) * 0.64;

  points.push({ x, y });
  for (let index = 1; index < pointCount; index++) {
    x = Math.max(
      0.08,
      Math.min(0.92, x + (seededValue(seed, index * 2) - 0.5) * 0.42),
    );
    y = Math.max(
      0.08,
      Math.min(
        0.92,
        y + (seededValue(seed, index * 2 + 1) - 0.5) * 0.42,
      ),
    );
    points.push({ x, y });
  }

  return [points];
}

export function colorForDomain(baseColor: string, domain: string): string {
  const base = parseColorToHsl(baseColor);
  if (!base) return baseColor;

  const shift = PAGE_HUE_SHIFTS[hashDomain(domain) % PAGE_HUE_SHIFTS.length];
  const hue = (base.h + shift + 360) % 360;
  return `hsl(${hue}, ${base.s}%, ${base.l}%)`;
}

export function paletteColorForIndex(index: number): string {
  return risoInkColor(index);
}

function getMainRoads(domains: WalkingRecordDomain[]): Set<string> {
  const rankedPersonalRoads = [...domains]
    .filter((domain) => domain.sessionCount > SMALL_SITE_MAX_VISITS)
    .sort((a, b) => b.sessionCount - a.sessionCount)
    .slice(0, MAIN_ROAD_LIMIT)
    .map((domain) => domain.domain);

  return new Set(rankedPersonalRoads);
}

function isMainRoad(domain: string, mainRoads: Set<string>): boolean {
  if (isPopularDomain(domain)) return true;
  return [...mainRoads].some((road) => domainMatchesRoot(domain, road));
}

function focusVisits(events: CollectionEvent[]): FocusVisit[] {
  const visits = events
    .filter((event) => {
      if (event.type !== "navigation") return false;
      const data = event.data as NavigationEventData;
      return data.event === "focus";
    })
    .map((event) => ({
      ts: event.ts,
      domain: extractDomain(event.meta.url),
      url: event.meta.url,
    }))
    .filter((visit) => visit.domain && /^https?:\/\//.test(visit.url))
    .sort((a, b) => a.ts - b.ts);

  return visits.filter((visit, index) => {
    const previous = visits[index - 1];
    return !previous || previous.domain !== visit.domain || visit.ts - previous.ts > 120_000;
  });
}

function sessionsByDomain(sessions: ScreenTimeSession[]): Map<string, DomainTime> {
  const grouped = new Map<string, DomainTime>();

  for (const session of sessions) {
    const domain = extractDomain(session.url);
    if (!domain) continue;

    const current = grouped.get(domain) ?? { domain, totalMs: 0, sessions: [] };
    current.totalMs += session.durationMs;
    current.sessions.push(session);
    grouped.set(domain, current);
  }

  return grouped;
}

function cursorSamplesByUrl(events: CollectionEvent[]): Map<string, number[]> {
  const samples = new Map<string, number[]>();

  for (const event of events) {
    if (event.type !== "cursor") continue;
    const data = event.data as CursorEventData;
    if (data.event !== "move" && data.event !== undefined) continue;

    const url = normalizeUrl(event.meta.url);
    const timestamps = samples.get(url) ?? [];
    timestamps.push(event.ts);
    samples.set(url, timestamps);
  }

  return samples;
}

function getVisitSession(
  visit: FocusVisit,
  domainTime: DomainTime | undefined,
): ScreenTimeSession | undefined {
  if (!domainTime) return undefined;

  return domainTime.sessions
    .filter((session) => Math.abs(session.focusTs - visit.ts) <= 60_000)
    .sort(
      (a, b) =>
        Math.abs(a.focusTs - visit.ts) - Math.abs(b.focusTs - visit.ts),
    )[0];
}

function buildDepartureNote(
  visit: FocusVisit,
  session: ScreenTimeSession | undefined,
  domain: WalkingRecordDomain,
  visitsThisPeriod: number,
): string {
  const notes: string[] = [];

  if (session && session.durationMs >= 10 * 60_000) {
    notes.push(`stayed ${Math.round(session.durationMs / 60_000)} minutes`);
  }
  if (domain.firstVisit >= visit.ts - 60_000) {
    notes.push("your first visit");
  }
  if (visitsThisPeriod > 1) {
    notes.push(`went back ${visitsThisPeriod - 1 === 1 ? "once" : `${visitsThisPeriod - 1} times`}`);
  }
  if (new Date(visit.ts).getHours() < 5) {
    notes.push("found after midnight");
  }

  return notes.slice(0, 2).join(" · ");
}

function buildDepartures(
  events: CollectionEvent[],
  sessions: ScreenTimeSession[],
  domains: WalkingRecordDomain[],
  mainRoads: Set<string>,
  range: WalkingRecordRange,
  baseColor: string,
): { departures: Departure[]; movementCount: number } {
  const visits = focusVisits(events);
  const domainByName = new Map(domains.map((domain) => [domain.domain, domain]));
  const timeByDomain = sessionsByDomain(sessions);
  const movementByUrl = cursorSamplesByUrl(events);
  const visitsByDomain = new Map<string, number>();

  for (const visit of visits) {
    visitsByDomain.set(visit.domain, (visitsByDomain.get(visit.domain) ?? 0) + 1);
  }

  const candidates: Array<Omit<Departure, "accentHue"> & { dayKey: string }> =
    [];
  for (let index = 1; index < visits.length; index++) {
    const previous = visits[index - 1];
    const visit = visits[index];
    const nextVisit = visits[index + 1];
    const domain = domainByName.get(visit.domain);

    if (!domain) continue;
    if (!isMainRoad(previous.domain, mainRoads)) continue;
    if (isMainRoad(visit.domain, mainRoads)) continue;
    if (domain.sessionCount > SMALL_SITE_MAX_VISITS) continue;

    const session = getVisitSession(visit, timeByDomain.get(visit.domain));
    const rarityScore = SMALL_SITE_MAX_VISITS - domain.sessionCount + 1;
    const dwellScore = session ? Math.min(session.durationMs / 60_000, 30) / 10 : 0;
    const date = new Date(visit.ts);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const traceEndTs = Math.max(
      visit.ts,
      Math.min(
        range.endTs,
        visit.ts + DEPARTURE_TRACE_MAX_MS,
        session?.blurTs ?? Infinity,
        nextVisit ? nextVisit.ts - 1 : Infinity,
      ),
    );
    const isFirstVisit = domain.firstVisit >= visit.ts - 60_000;
    const movementSamples = (
      movementByUrl.get(normalizeUrl(visit.url)) ?? []
    ).filter((timestamp) => timestamp >= visit.ts && timestamp <= traceEndTs).length;
    const movementScore = Math.min(movementSamples, 3) * 2;

    const traceTarget = {
      id: `departure:${visit.ts}:${visit.domain}`,
      url: visit.url,
      startTs: visit.ts,
      endTs: traceEndTs,
    };

    candidates.push({
      dayKey,
      day: date.toLocaleDateString("en", { weekday: "short" }).toLowerCase(),
      verb: "departed",
      from: previous.domain,
      to: visit.domain,
      toUrl: visit.url,
      note: buildDepartureNote(
        visit,
        session,
        domain,
        visitsByDomain.get(visit.domain) ?? 1,
      ),
      familiarity:
        isFirstVisit
          ? "new to you"
          : domain.sessionCount > 0
            ? `${domain.sessionCount} visits by you`
            : "seen before",
      hue: colorForDomain(baseColor, visit.domain),
      score: rarityScore + dwellScore + movementScore,
      traceTarget,
      tracePaths: derivedSessionPath(traceTarget),
    });
  }

  const deduped = new Map<
    string,
    Omit<Departure, "accentHue"> & { dayKey: string }
  >();
  for (const candidate of candidates) {
    const key = `${candidate.dayKey}:${candidate.to}`;
    const existing = deduped.get(key);
    if (!existing || candidate.score > existing.score) {
      deduped.set(key, candidate);
    }
  }

  const ranked = [...deduped.values()].sort((a, b) => b.score - a.score);
  return {
    movementCount: ranked.length,
    departures: ranked.slice(0, 4).map((candidate, index) => {
      const { dayKey: _, ...departure } = candidate;
      return {
        ...departure,
        accentHue: paletteColorForIndex(index),
      };
    }),
  };
}

function formatGap(ms: number): string {
  const days = Math.max(1, Math.floor(ms / DAY_MS));
  if (days < 60) return `${days} day${days === 1 ? "" : "s"}`;

  const months = Math.floor(days / 30);
  if (months < 24) return `${months} month${months === 1 ? "" : "s"}`;

  const years = Math.floor(days / 365);
  return `${years} year${years === 1 ? "" : "s"}`;
}

function buildRevisits(
  domains: WalkingRecordDomain[],
  range: WalkingRecordRange,
): Revisit[] {
  return domains
    .filter(
      (domain) =>
        domain.sessionCount >= FAMILIAR_SITE_MIN_VISITS &&
        domain.firstVisit > 0 &&
        domain.lastVisit > domain.firstVisit &&
        Math.floor((domain.lastVisit - domain.firstVisit) / DAY_MS) + 1 >=
          FAMILIAR_SITE_MIN_SPAN_DAYS &&
        domain.lastVisit > 0 &&
        domain.lastVisit < range.startTs &&
        !isPopularDomain(domain.domain),
    )
    .map((domain) => {
      const gapMs = range.endTs - domain.lastVisit;
      const visitSpanMs = domain.lastVisit - domain.firstVisit;
      const visitSpanDays = Math.max(
        1,
        Math.floor(visitSpanMs / DAY_MS) + 1,
      );
      const cappedVisitCount = Math.min(domain.sessionCount, visitSpanDays);
      const visitsPerSpanDay = domain.sessionCount / visitSpanDays;
      const concentrationPenalty = Math.sqrt(
        Math.max(1, visitsPerSpanDay),
      );
      return {
        span: formatGap(gapMs),
        site: domain.domain,
        href: `https://${domain.domain}`,
        memory: `part of your browsing for ${formatGap(visitSpanMs)} before the gap`,
        score:
          (Math.log2(visitSpanDays + 1) ** 2 *
            Math.log2(cappedVisitCount + 1) *
            Math.log2(gapMs / DAY_MS + 1)) /
          concentrationPenalty,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((revisit, index) => ({
      ...revisit,
      hue: paletteColorForIndex(index),
    }));
}

function cursorDistance(events: CollectionEvent[]): number {
  const moves = events
    .filter((event) => {
      if (event.type !== "cursor") return false;
      const data = event.data as CursorEventData;
      return data.event === "move" || data.event === undefined;
    })
    .sort((a, b) => a.ts - b.ts);

  let distance = 0;
  for (let index = 1; index < moves.length; index++) {
    const previousEvent = moves[index - 1];
    const event = moves[index];
    if (normalizeUrl(previousEvent.meta.url) !== normalizeUrl(event.meta.url)) continue;
    if (event.ts - previousEvent.ts > 5_000) continue;

    const previous = previousEvent.data as CursorEventData;
    const current = event.data as CursorEventData;
    const width = event.meta.vw || previousEvent.meta.vw;
    const height = event.meta.vh || previousEvent.meta.vh;
    const dx = (current.x - previous.x) * width;
    const dy = (current.y - previous.y) * height;
    distance += Math.sqrt(dx * dx + dy * dy);
  }

  return distance;
}

function hourBuckets(sessions: ScreenTimeSession[]): number[] {
  const buckets = new Array<number>(24).fill(0);
  for (const session of sessions) {
    buckets[new Date(session.focusTs).getHours()] += session.durationMs;
  }
  return buckets;
}

function deriveBrowsingPortrait({
  events,
  sessions,
  cursorDistancePx: measuredCursorDistance,
}: Pick<
  WalkingRecordInput,
  "events" | "sessions" | "cursorDistancePx"
>): BrowsingPortrait {
  const uniquePages = new Set(
    events
      .map((event) => event.meta.url)
      .filter((url) => /^https?:\/\//.test(url))
      .map(normalizeUrl),
  );

  return {
    totalTimeMs: sessions.reduce((sum, session) => sum + session.durationMs, 0),
    cursorDistancePx: measuredCursorDistance ?? cursorDistance(events),
    pageCount: uniquePages.size,
    hourBuckets: hourBuckets(sessions),
  };
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

interface TraceInterval {
  key: string;
  label: string;
  startTs: number;
  endTs: number;
}

function traceIntervals(
  period: WalkingRecordPeriod,
  range: WalkingRecordRange,
): TraceInterval[] {
  const intervals: TraceInterval[] = [];
  const rangeEnd = range.endTs;

  if (period === "week") {
    const cursor = startOfLocalDay(new Date(range.startTs));
    while (cursor.getTime() <= rangeEnd) {
      const nextDay = new Date(cursor);
      nextDay.setDate(nextDay.getDate() + 1);
      intervals.push({
        key: `day:${localDateKey(cursor.getTime())}`,
        label: cursor
          .toLocaleDateString("en", { weekday: "short" })
          .toLowerCase(),
        startTs: cursor.getTime(),
        endTs: Math.min(rangeEnd, nextDay.getTime() - 1),
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    return intervals;
  }

  if (period === "month") {
    const cursor = startOfLocalDay(new Date(range.startTs));
    let week = 1;
    while (cursor.getTime() <= rangeEnd) {
      const nextWeek = new Date(cursor);
      nextWeek.setDate(nextWeek.getDate() + 7);
      intervals.push({
        key: `week:${localDateKey(cursor.getTime())}`,
        label: `week ${week}`,
        startTs: cursor.getTime(),
        endTs: Math.min(rangeEnd, nextWeek.getTime() - 1),
      });
      cursor.setDate(cursor.getDate() + 7);
      week += 1;
    }
    return intervals;
  }

  const cursor = new Date(new Date(range.startTs).getFullYear(), 0, 1);
  while (cursor.getTime() <= rangeEnd) {
    const nextMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    intervals.push({
      key: `month:${localDateKey(cursor.getTime())}`,
      label: cursor.toLocaleDateString("en", { month: "short" }).toLowerCase(),
      startTs: cursor.getTime(),
      endTs: Math.min(rangeEnd, nextMonth.getTime() - 1),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return intervals;
}

function buildDayPlates(
  events: CollectionEvent[],
  sessions: ScreenTimeSession[],
  range: WalkingRecordRange,
  domains: WalkingRecordDomain[],
  period: WalkingRecordPeriod,
  baseColor: string,
  nowTs: number,
): DayPlate[] {
  const domainByName = new Map(domains.map((domain) => [domain.domain, domain]));
  const movementByUrl = cursorSamplesByUrl(events);

  return traceIntervals(period, range).map((interval) => {
    const sessionsForInterval = sessions
      .filter(
        (session) =>
          session.focusTs >= interval.startTs &&
          session.focusTs <= interval.endTs,
      )
      .sort((a, b) => {
        const aMovement = (
          movementByUrl.get(normalizeUrl(a.url)) ?? []
        ).some((timestamp) => timestamp >= a.focusTs && timestamp <= a.blurTs);
        const bMovement = (
          movementByUrl.get(normalizeUrl(b.url)) ?? []
        ).some((timestamp) => timestamp >= b.focusTs && timestamp <= b.blurTs);
        if (aMovement !== bMovement) return aMovement ? -1 : 1;
        if (a.durationMs !== b.durationMs) return b.durationMs - a.durationMs;
        const aVisits = domainByName.get(extractDomain(a.url))?.sessionCount ?? Infinity;
        const bVisits = domainByName.get(extractDomain(b.url))?.sessionCount ?? Infinity;
        return aVisits - bVisits;
      });
    const session = sessionsForInterval[0];

    if (!session) {
      return {
        date: interval.key,
        day: interval.label,
        vignette:
          interval.startTs > nowTs ? "still to come" : "no trace kept",
        hue: "#b5aea5",
        tracePaths: [],
      };
    }

    const domain = extractDomain(session.url);
    const minutes = Math.max(1, Math.round(session.durationMs / 60_000));
    const traceTarget = {
      id: interval.key,
      url: session.url,
      startTs: session.focusTs,
      endTs: session.blurTs,
    };

    return {
      date: interval.key,
      day: interval.label,
      vignette: `${minutes} quiet minute${minutes === 1 ? "" : "s"} on ${domain}`,
      hue: colorForDomain(baseColor, domain),
      traceTarget,
      tracePaths: derivedSessionPath(traceTarget),
    };
  });
}

function topHourNote(sessions: ScreenTimeSession[]): string {
  const buckets = hourBuckets(sessions);
  const topHour = buckets.indexOf(Math.max(...buckets));
  if (topHour < 0 || buckets[topHour] === 0) return "";

  const formatter = new Intl.DateTimeFormat("en", { hour: "numeric" });
  const start = new Date(2020, 0, 1, topHour);
  const end = new Date(2020, 0, 1, (topHour + 1) % 24);
  return `mostly around ${formatter.format(start)}–${formatter.format(end)}`;
}

function buildTimeSpent(
  sessions: ScreenTimeSession[],
  domains: WalkingRecordDomain[],
  mainRoads: Set<string>,
): { entries: TimeSpentEntry[]; intro: string } {
  const grouped = [...sessionsByDomain(sessions).values()].sort(
    (a, b) => b.totalMs - a.totalMs,
  );
  const domainByName = new Map(domains.map((domain) => [domain.domain, domain]));
  const quiet = grouped.filter((entry) => {
    const domain = domainByName.get(entry.domain);
    return (
      domain &&
      domain.sessionCount <= SMALL_SITE_MAX_VISITS &&
      !isMainRoad(entry.domain, mainRoads)
    );
  });
  const quietDomains = new Set(quiet.map((entry) => entry.domain));
  const top = grouped
    .filter((entry) => !quietDomains.has(entry.domain))
    .slice(0, TIME_SPENT_SITE_LIMIT);
  const quietMs = quiet.reduce((sum, entry) => sum + entry.totalMs, 0);
  const quietLongReads = quiet.flatMap((entry) => entry.sessions).filter(
    (session) => session.durationMs >= 10 * 60_000,
  ).length;
  const rows: Array<DomainTime & { quiet?: boolean }> = [...top];

  if (quietMs > 0) {
    rows.push({
      domain: "the quiet streets, together",
      totalMs: quietMs,
      sessions: quiet.flatMap((entry) => entry.sessions),
      quiet: true,
    });
  }

  const maxMs = Math.max(...rows.map((row) => row.totalMs), 1);
  const entries = rows.map((row, index): TimeSpentEntry => {
    if (row.quiet) {
      return {
        rank: index + 1,
        site: row.domain,
        time: formatDuration(row.totalMs),
        percentage: (row.totalMs / maxMs) * 100,
        hue: paletteColorForIndex(index),
        note: `${quiet.length} small site${quiet.length === 1 ? "" : "s"} · ${quietLongReads} long read${quietLongReads === 1 ? "" : "s"}`,
      };
    }

    return {
      rank: index + 1,
      site: row.domain,
      time: formatDuration(row.totalMs),
      percentage: (row.totalMs / maxMs) * 100,
      hue: paletteColorForIndex(index),
      note: topHourNote(row.sessions),
      href: `https://${row.domain}`,
    };
  });

  if (grouped.length === 0) {
    return {
      entries: [],
      intro: "there is no completed screen-time record for this period.",
    };
  }

  const quietSentence =
    quiet.length > 0
      ? ` ${quiet.length} quiet street${quiet.length === 1 ? "" : "s"} held ${formatDuration(quietMs)}.`
      : "";
  return {
    entries,
    intro: `you spent the most time on ${grouped[0].domain}.${quietSentence}`,
  };
}

export function deriveWalkingRecord({
  period,
  baseColor,
  events,
  sessions,
  domains,
  range,
  cursorDistancePx: measuredCursorDistance,
  nowTs = Date.now(),
}: WalkingRecordInput): WalkingRecord {
  const portrait = deriveBrowsingPortrait({
    events,
    sessions,
    cursorDistancePx: measuredCursorDistance,
  });
  const mainRoads = getMainRoads(domains);
  const { departures, movementCount } = buildDepartures(
    events,
    sessions,
    domains,
    mainRoads,
    range,
    baseColor,
  );
  const { entries: timeSpent, intro: timeSpentIntro } = buildTimeSpent(
    sessions,
    domains,
    mainRoads,
  );

  return {
    period,
    range,
    rangeLabel: formatRange(range),
    totalTimeMs: portrait.totalTimeMs,
    totalTimeLabel: formatDuration(portrait.totalTimeMs),
    cursorDistancePx: portrait.cursorDistancePx,
    pageCount: portrait.pageCount,
    hourBuckets: portrait.hourBuckets,
    movementCount,
    departures,
    revisits: buildRevisits(domains, range),
    dayPlates: buildDayPlates(
      events,
      sessions,
      range,
      domains,
      period,
      baseColor,
      nowTs,
    ),
    timeSpent,
    timeSpentIntro,
  };
}

export function getWalkingRecordTraceTargets(
  record: WalkingRecord,
): WalkingRecordTraceTarget[] {
  return [
    ...record.dayPlates.map((plate) => plate.traceTarget),
    ...record.departures.map((departure) => departure.traceTarget),
  ].filter((target): target is WalkingRecordTraceTarget => target !== undefined);
}

function pathsForTarget(
  target: WalkingRecordTraceTarget | undefined,
  fallbackPaths: WalkingRecordTracePoint[][],
  pathsByTarget: Map<string, WalkingRecordTracePoint[][]>,
): WalkingRecordTracePoint[][] {
  if (!target) return [];

  const storedPaths = pathsByTarget.get(target.id);
  return storedPaths?.some((path) => path.length >= 2)
    ? storedPaths
    : fallbackPaths;
}

export function attachWalkingRecordTraces(
  record: WalkingRecord,
  traces: WalkingRecordTrace[],
): WalkingRecord {
  const pathsByTarget = new Map(
    traces.map((trace) => [trace.targetId, trace.paths]),
  );

  return {
    ...record,
    dayPlates: record.dayPlates.map((plate) => ({
      ...plate,
      tracePaths: pathsForTarget(
        plate.traceTarget,
        plate.tracePaths,
        pathsByTarget,
      ),
    })),
    departures: record.departures.map((departure) => ({
      ...departure,
      tracePaths: pathsForTarget(
        departure.traceTarget,
        departure.tracePaths,
        pathsByTarget,
      ),
    })),
  };
}
