// ABOUTME: Derives calendar-period walking records from locally collected browsing events.
// ABOUTME: Ranks departures, settled small sites, time spent, and representative traces.

import type {
  CollectionEvent,
  CursorEventData,
  NavigationEventData,
} from "../collectors/types";
import {
  WALKING_RECORD_FAVICON_DOMAIN_LIMIT,
  type ScreenTimeSession,
  type WalkingRecordActivity,
  type WalkingRecordTrace,
  type WalkingRecordTracePoint,
  type WalkingRecordTraceTarget,
} from "../storage/LocalEventStore";
import { risoInkColor } from "../utils/risoInk";
import { extractDomain, normalizeUrl } from "../utils/urlNormalization";
import { parseColorToHsl } from "@movement/utils/eventUtils";

const DAY_MS = 24 * 60 * 60 * 1000;
const SMALL_SITE_MAX_VISITS = 5;
const MAIN_ROAD_LIMIT = 20;
const TIME_SPENT_SITE_LIMIT = 5;
const SETTLED_PLACE_LIMIT = 5;
const ACTIVE_WINDOW_MS = 30_000;
const MIN_DEPARTURE_DWELL_MS = 60_000;
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
  activeDayCount: number;
  eventCounts: Record<string, number>;
  latestFaviconUrl?: string;
}

export interface Departure {
  day: string;
  from: string;
  to: string;
  toUrl: string;
  fromFaviconUrl?: string;
  toFaviconUrl?: string;
  time: string;
  note: string;
  score: number;
}

export interface SettledPlace {
  site: string;
  href: string;
  faviconUrl?: string;
  activeTime: string;
  evidence: string;
  hue: string;
  score: number;
}

export interface DayPlate {
  date: string;
  day: string;
  vignette: string;
  hue: string;
  future: boolean;
  portraitDay?: string;
  traceTargets: WalkingRecordTraceTarget[];
  tracePaths: WalkingRecordTracePoint[][];
}

export interface TimeSpentEntry {
  rank: number;
  site: string;
  faviconUrl?: string;
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
  settledPlaces: SettledPlace[];
  dayPlates: DayPlate[];
  landscapePaths: CollectionEvent[][];
  timeSpent: TimeSpentEntry[];
}

interface WalkingRecordInput {
  period: WalkingRecordPeriod;
  baseColor: string;
  events: CollectionEvent[];
  activity?: WalkingRecordActivity[];
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

  const periodStart = new Date(currentDay.getFullYear() + periodOffset, 0, 1);
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

export function formatCompactDuration(
  ms: number,
  unitSeparator = " ",
): string {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 1) return "<1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0
    ? `${hours}h`
    : `${hours}h${unitSeparator}${minutes}m`;
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
  const durationMinutes = Math.max(1, (target.endTs - target.startTs) / 60_000);
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
      Math.min(0.92, y + (seededValue(seed, index * 2 + 1) - 0.5) * 0.42),
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
    return (
      !previous ||
      previous.domain !== visit.domain ||
      visit.ts - previous.ts > 120_000
    );
  });
}

function sessionsByDomain(
  sessions: ScreenTimeSession[],
): Map<string, DomainTime> {
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

function faviconsByDomain(events: CollectionEvent[]): Map<string, string> {
  const favicons = new Map<string, string>();

  for (const event of events) {
    if (event.type !== "navigation") continue;
    const faviconUrl = (event.data as NavigationEventData).favicon_url;
    if (typeof faviconUrl !== "string" || faviconUrl.length === 0) continue;

    try {
      const parsed = new URL(faviconUrl);
      if (
        parsed.protocol === "https:" ||
        parsed.protocol === "http:" ||
        parsed.protocol === "data:"
      ) {
        favicons.set(extractDomain(event.meta.url), faviconUrl);
      }
    } catch {
      // Ignore malformed favicon metadata from the visited page.
    }
  }

  return favicons;
}

function logarithmicScore(valueMinutes: number, capMinutes: number): number {
  return (
    Math.log1p(Math.min(Math.max(0, valueMinutes), capMinutes)) /
    Math.log1p(capMinutes)
  );
}

function formatDepartureDuration(ms: number): string {
  return ms < 60_000 ? "< 1 min" : formatDuration(ms);
}

function activeTimeForSession(
  session: ScreenTimeSession | undefined,
  activityByUrl: Map<string, number[]>,
): number {
  if (!session) return 0;
  const windows = activityByUrl.get(normalizeUrl(session.url)) ?? [];
  const activeWindows = windows.filter(
    (timestamp) =>
      timestamp < session.blurTs &&
      timestamp + ACTIVE_WINDOW_MS > session.focusTs,
  ).length;
  return Math.min(session.durationMs, activeWindows * ACTIVE_WINDOW_MS);
}

function getVisitSession(
  visit: FocusVisit,
  domainTime: DomainTime | undefined,
): ScreenTimeSession | undefined {
  if (!domainTime) return undefined;

  return domainTime.sessions
    .filter((session) => Math.abs(session.focusTs - visit.ts) <= 60_000)
    .sort(
      (a, b) => Math.abs(a.focusTs - visit.ts) - Math.abs(b.focusTs - visit.ts),
    )[0];
}

function buildDepartureNote(
  visit: FocusVisit,
  session: ScreenTimeSession | undefined,
  activeTimeMs: number,
  domain: WalkingRecordDomain,
  visitsThisPeriod: number,
): string {
  const notes: string[] = [];

  if (domain.firstVisit >= visit.ts - 60_000) {
    notes.push("your first visit");
  }
  if (activeTimeMs >= 60_000) {
    notes.push(`${Math.round(activeTimeMs / 60_000)} active minutes`);
  } else if (activeTimeMs > 0) {
    notes.push("actively browsed");
  } else if (session && session.durationMs >= 10 * 60_000) {
    notes.push(`stayed ${Math.round(session.durationMs / 60_000)} minutes`);
  }
  if (visitsThisPeriod > 1) {
    notes.push(
      `returned ${visitsThisPeriod - 1 === 1 ? "once" : `${visitsThisPeriod - 1} times`}`,
    );
  }
  if (new Date(visit.ts).getHours() < 5) {
    notes.push("found after midnight");
  }

  return notes.slice(0, 2).join(" · ");
}

function buildDepartures(
  events: CollectionEvent[],
  activity: WalkingRecordActivity[],
  sessions: ScreenTimeSession[],
  domains: WalkingRecordDomain[],
  mainRoads: Set<string>,
): { departures: Departure[]; movementCount: number } {
  const visits = focusVisits(events);
  const domainByName = new Map(
    domains.map((domain) => [domain.domain, domain]),
  );
  const timeByDomain = sessionsByDomain(sessions);
  const activityByUrl = new Map(
    activity.map((entry) => [entry.url, entry.windowStarts]),
  );
  const hasActivityCoverage = activity.some(
    (entry) => entry.windowStarts.length > 0,
  );
  const faviconByDomain = faviconsByDomain(events);
  const visitsByDomain = new Map<string, number>();

  for (const visit of visits) {
    visitsByDomain.set(
      visit.domain,
      (visitsByDomain.get(visit.domain) ?? 0) + 1,
    );
  }

  const candidates: Array<Departure & { dayKey: string }> = [];
  for (let index = 1; index < visits.length; index++) {
    const previous = visits[index - 1];
    const visit = visits[index];
    const domain = domainByName.get(visit.domain);

    if (!domain) continue;
    if (!isMainRoad(previous.domain, mainRoads)) continue;
    if (isMainRoad(visit.domain, mainRoads)) continue;
    if (domain.sessionCount > SMALL_SITE_MAX_VISITS) continue;

    const session = getVisitSession(visit, timeByDomain.get(visit.domain));
    const activeTimeMs = activeTimeForSession(session, activityByUrl);
    if (
      activeTimeMs < ACTIVE_WINDOW_MS &&
      (session?.durationMs ?? 0) < MIN_DEPARTURE_DWELL_MS
    ) {
      continue;
    }
    const dwellMinutes = (session?.durationMs ?? 0) / 60_000;
    const activeMinutes = activeTimeMs / 60_000;
    const activeScore = logarithmicScore(activeMinutes, 30);
    const dwellScore = logarithmicScore(dwellMinutes, 30);
    const browsingScore = hasActivityCoverage
      ? activeScore * 0.8 + dwellScore * 0.2
      : dwellScore;
    const rarityScore =
      (SMALL_SITE_MAX_VISITS - domain.sessionCount + 1) /
      (SMALL_SITE_MAX_VISITS + 1);
    const date = new Date(visit.ts);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const isFirstVisit = domain.firstVisit >= visit.ts - 60_000;
    const visitsThisPeriod = visitsByDomain.get(visit.domain) ?? 1;
    const discoveryScore =
      (isFirstVisit ? 0.6 : 0) + (visitsThisPeriod > 1 ? 0.4 : 0);

    candidates.push({
      dayKey,
      day: date.toLocaleDateString("en", { weekday: "short" }).toLowerCase(),
      from: previous.domain,
      to: visit.domain,
      toUrl: visit.url,
      fromFaviconUrl: faviconByDomain.get(previous.domain),
      toFaviconUrl: faviconByDomain.get(visit.domain),
      time:
        activeTimeMs > 0
          ? `${formatDepartureDuration(activeTimeMs)} active`
          : formatDepartureDuration(session!.durationMs),
      note: buildDepartureNote(
        visit,
        session,
        activeTimeMs,
        domain,
        visitsThisPeriod,
      ),
      score: browsingScore * 0.6 + rarityScore * 0.25 + discoveryScore * 0.15,
    });
  }

  const deduped = new Map<string, Departure & { dayKey: string }>();
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
    departures: ranked.map((candidate) => {
      const { dayKey: _, ...departure } = candidate;
      return departure;
    }),
  };
}

function periodKey(timestamp: number, period: "week" | "month"): string {
  const date = new Date(timestamp);
  if (period === "month") {
    return `${date.getFullYear()}-${date.getMonth()}`;
  }

  const weekStart = startOfLocalDay(date);
  const daysFromMonday = (weekStart.getDay() + 6) % 7;
  weekStart.setDate(weekStart.getDate() - daysFromMonday);
  return localDateKey(weekStart.getTime());
}

function timeOfDayLabel(hour: number): string {
  if (hour >= 5 && hour < 12) return "mornings";
  if (hour >= 12 && hour < 17) return "afternoons";
  if (hour >= 17 && hour < 22) return "evenings";
  return "late nights";
}

function recurringTimeOfDay(
  sessions: Array<{ session: ScreenTimeSession; activeTimeMs: number }>,
): string | null {
  const strongestSessionByDay = new Map<
    string,
    { session: ScreenTimeSession; activeTimeMs: number }
  >();
  for (const entry of sessions) {
    const day = localDateKey(entry.session.focusTs);
    const strongest = strongestSessionByDay.get(day);
    if (!strongest || entry.activeTimeMs > strongest.activeTimeMs) {
      strongestSessionByDay.set(day, entry);
    }
  }
  if (strongestSessionByDay.size < 3) return null;

  const counts = new Map<string, number>();
  for (const { session } of strongestSessionByDay.values()) {
    const label = timeOfDayLabel(new Date(session.focusTs).getHours());
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const [label, count] = [...counts].sort((a, b) => b[1] - a[1])[0]!;
  return count / strongestSessionByDay.size >= 0.6 ? label : null;
}

function qualifiesAsSettledPlace(
  period: WalkingRecordPeriod,
  activeDays: number,
  activeWeeks: number,
  activeMonths: number,
  uniquePages: number,
): boolean {
  if (activeDays < 2) return false;
  if (period === "week") return true;
  if (period === "month") {
    return (activeDays >= 3 && activeWeeks >= 2) || uniquePages >= 5;
  }
  return (activeDays >= 5 && activeMonths >= 3) || uniquePages >= 10;
}

function settledPlaceCaps(period: WalkingRecordPeriod) {
  if (period === "week") {
    return { minutes: 120, days: 5, pages: 12, sessions: 10 };
  }
  if (period === "month") {
    return { minutes: 600, days: 15, pages: 30, sessions: 30 };
  }
  return { minutes: 2_400, days: 60, pages: 100, sessions: 120 };
}

function buildSettledPlaces(
  activity: WalkingRecordActivity[],
  sessions: ScreenTimeSession[],
  period: WalkingRecordPeriod,
): SettledPlace[] {
  const activityByUrl = new Map(
    activity.map((entry) => [entry.url, entry.windowStarts]),
  );
  const grouped = [...sessionsByDomain(sessions).values()].sort(
    (a, b) => b.totalMs - a.totalMs,
  );
  const leadingDomains = new Set(
    grouped.slice(0, TIME_SPENT_SITE_LIMIT).map(({ domain }) => domain),
  );
  const caps = settledPlaceCaps(period);

  return grouped
    .flatMap((group): Omit<SettledPlace, "hue">[] => {
      if (leadingDomains.has(group.domain) || isPopularDomain(group.domain)) {
        return [];
      }

      const engagedSessions = group.sessions
        .map((session) => ({
          session,
          activeTimeMs: activeTimeForSession(session, activityByUrl),
        }))
        .filter(({ activeTimeMs }) => activeTimeMs > 0);
      const activeTimeMs = engagedSessions.reduce(
        (sum, entry) => sum + entry.activeTimeMs,
        0,
      );
      if (activeTimeMs < 5 * 60_000) return [];

      const activeDays = new Set(
        engagedSessions.map(({ session }) => localDateKey(session.focusTs)),
      ).size;
      const activeWeeks = new Set(
        engagedSessions.map(({ session }) =>
          periodKey(session.focusTs, "week"),
        ),
      ).size;
      const activeMonths = new Set(
        engagedSessions.map(({ session }) =>
          periodKey(session.focusTs, "month"),
        ),
      ).size;
      const uniquePages = new Set(
        engagedSessions.map(({ session }) => normalizeUrl(session.url)),
      ).size;
      if (
        !qualifiesAsSettledPlace(
          period,
          activeDays,
          activeWeeks,
          activeMonths,
          uniquePages,
        )
      ) {
        return [];
      }

      const recurringTime = recurringTimeOfDay(engagedSessions);
      const recurrenceScore = recurringTime ? 1 : 0;
      const score =
        logarithmicScore(activeTimeMs / 60_000, caps.minutes) * 0.35 +
        logarithmicScore(activeDays, caps.days) * 0.25 +
        logarithmicScore(uniquePages, caps.pages) * 0.2 +
        logarithmicScore(engagedSessions.length, caps.sessions) * 0.1 +
        recurrenceScore * 0.1;
      const returnEvidence = recurringTime
        ? `returned in the ${recurringTime} on ${activeDays} days`
        : `returned on ${activeDays} days`;

      return [
        {
          site: group.domain,
          href: `https://${group.domain}`,
          activeTime: `${formatCompactDuration(activeTimeMs)} active`,
          evidence: `${returnEvidence} · visited ${uniquePages} page${uniquePages === 1 ? "" : "s"}`,
          score,
        },
      ];
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, SETTLED_PLACE_LIMIT)
    .map((place, index) => ({
      ...place,
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
    if (normalizeUrl(previousEvent.meta.url) !== normalizeUrl(event.meta.url))
      continue;
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

function cursorMovementByUrl(events: CollectionEvent[]): Map<string, number[]> {
  const movementByUrl = new Map<string, number[]>();
  for (const event of events) {
    if (event.type !== "cursor") continue;
    const data = event.data as CursorEventData;
    if (data.event !== "move" && data.event !== undefined) continue;

    const url = normalizeUrl(event.meta.url);
    const timestamps = movementByUrl.get(url) ?? [];
    timestamps.push(event.ts);
    movementByUrl.set(url, timestamps);
  }
  return movementByUrl;
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
  const domainByName = new Map(
    domains.map((domain) => [domain.domain, domain]),
  );
  const movementByUrl = cursorMovementByUrl(events);
  const intervals = traceIntervals(period, range);
  const targetLimit = Math.max(1, Math.floor(16 / intervals.length));

  return intervals.map((interval) => {
    const sessionsForInterval = sessions
      .filter(
        (session) =>
          session.focusTs >= interval.startTs &&
          session.focusTs <= interval.endTs,
      )
      .map((session) => ({
        session,
        movementCount: (
          movementByUrl.get(normalizeUrl(session.url)) ?? []
        ).filter(
          (timestamp) =>
            timestamp >= session.focusTs && timestamp <= session.blurTs,
        ).length,
      }))
      .sort((a, b) => {
        if (a.movementCount !== b.movementCount) {
          return b.movementCount - a.movementCount;
        }
        if (a.session.durationMs !== b.session.durationMs) {
          return b.session.durationMs - a.session.durationMs;
        }
        const aVisits =
          domainByName.get(extractDomain(a.session.url))?.sessionCount ??
          Infinity;
        const bVisits =
          domainByName.get(extractDomain(b.session.url))?.sessionCount ??
          Infinity;
        return aVisits - bVisits;
      });
    const selectedSessions = sessionsForInterval
      .slice(0, targetLimit)
      .map((candidate) => candidate.session);
    const session = selectedSessions[0];

    if (!session) {
      const future = interval.startTs > nowTs;
      return {
        date: interval.key,
        day: interval.label,
        vignette: future ? "still to come" : "no trace kept",
        hue: "#b5aea5",
        future,
        traceTargets: [],
        tracePaths: [],
      };
    }

    const domain = extractDomain(session.url);
    const minutes = Math.max(1, Math.round(session.durationMs / 60_000));
    const traceTargets = selectedSessions.map((selectedSession, index) => ({
      id: index === 0 ? interval.key : `${interval.key}:${index + 1}`,
      url: selectedSession.url,
      startTs: selectedSession.focusTs,
      endTs: selectedSession.blurTs,
    }));

    return {
      date: interval.key,
      day: interval.label,
      vignette: `${minutes}m on ${domain}`,
      hue: colorForDomain(baseColor, domain),
      future: false,
      portraitDay: period === "week" ? interval.key.slice(4) : undefined,
      traceTargets,
      tracePaths: traceTargets.flatMap(derivedSessionPath),
    };
  });
}

function buildTimeSpent(
  events: CollectionEvent[],
  sessions: ScreenTimeSession[],
): { entries: TimeSpentEntry[] } {
  const grouped = [...sessionsByDomain(sessions).values()].sort(
    (a, b) => b.totalMs - a.totalMs,
  );
  const faviconByDomain = faviconsByDomain(events);
  const totalMs = grouped.reduce((sum, entry) => sum + entry.totalMs, 0);
  const top = grouped.slice(0, TIME_SPENT_SITE_LIMIT);
  const topMs = top.reduce((sum, entry) => sum + entry.totalMs, 0);
  const remaining = grouped.slice(TIME_SPENT_SITE_LIMIT);
  const remainingMs = totalMs - topMs;
  const entries = top.map(
    (row, index): TimeSpentEntry => ({
      rank: index + 1,
      site: row.domain,
      faviconUrl: faviconByDomain.get(row.domain),
      time: formatCompactDuration(row.totalMs, ""),
      percentage: (row.totalMs / Math.max(totalMs, 1)) * 100,
      hue: paletteColorForIndex(index),
      note: "",
      href: `https://${row.domain}`,
    }),
  );
  if (remainingMs > 0) {
    entries.push({
      rank: entries.length + 1,
      site: `${remaining.length} other${remaining.length === 1 ? "" : "s"}`,
      time: formatCompactDuration(remainingMs, ""),
      percentage: (remainingMs / Math.max(totalMs, 1)) * 100,
      hue: "#c8c3bb",
      note: "",
    });
  }

  if (grouped.length === 0) {
    return {
      entries: [],
    };
  }

  return {
    entries,
  };
}

export function deriveWalkingRecord({
  period,
  baseColor,
  events,
  activity = [],
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
    activity,
    sessions,
    domains,
    mainRoads,
  );
  const { entries: timeSpent } = buildTimeSpent(
    events,
    sessions,
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
    settledPlaces: buildSettledPlaces(activity, sessions, period),
    dayPlates: buildDayPlates(
      events,
      sessions,
      range,
      domains,
      period,
      baseColor,
      nowTs,
    ),
    landscapePaths: [],
    timeSpent,
  };
}

export function getWalkingRecordTraceTargets(
  record: WalkingRecord,
): WalkingRecordTraceTarget[] {
  return record.dayPlates.flatMap((plate) => plate.traceTargets);
}

export function getWalkingRecordFaviconDomains(
  record: WalkingRecord,
): string[] {
  return [
    ...new Set([
      ...record.timeSpent.flatMap((entry) => (entry.href ? [entry.site] : [])),
      ...record.settledPlaces.map((place) => place.site),
      ...record.departures.flatMap((departure) => [
        departure.from,
        departure.to,
      ]),
    ]),
  ].slice(0, WALKING_RECORD_FAVICON_DOMAIN_LIMIT);
}

export function attachWalkingRecordFavicons(
  record: WalkingRecord,
  favicons: Record<string, string>,
): WalkingRecord {
  return {
    ...record,
    departures: record.departures.map((departure) => ({
      ...departure,
      fromFaviconUrl: favicons[departure.from],
      toFaviconUrl: favicons[departure.to],
    })),
    timeSpent: record.timeSpent.map((entry) => ({
      ...entry,
      faviconUrl: favicons[entry.site],
    })),
    settledPlaces: record.settledPlaces.map((place) => ({
      ...place,
      faviconUrl: favicons[place.site],
    })),
  };
}

function pathsForTarget(
  target: WalkingRecordTraceTarget,
  pathsByTarget: Map<string, WalkingRecordTracePoint[][]>,
): WalkingRecordTracePoint[][] {
  const storedPaths = pathsByTarget.get(target.id);
  return storedPaths?.some((path) => path.length >= 2)
    ? storedPaths
    : derivedSessionPath(target);
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
      tracePaths: plate.traceTargets.flatMap((target) =>
        pathsForTarget(target, pathsByTarget),
      ),
    })),
  };
}

export function attachWalkingRecordLandscape(
  record: WalkingRecord,
  landscapePaths: CollectionEvent[][],
): WalkingRecord {
  return {
    ...record,
    landscapePaths,
  };
}
