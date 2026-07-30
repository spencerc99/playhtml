// ABOUTME: Derives a weekly walking record from locally collected browsing events.
// ABOUTME: Ranks departures, dormant familiar sites, time spent, and daily movement plates.

import type {
  CollectionEvent,
  CursorEventData,
  NavigationEventData,
  ViewportEventData,
} from "../collectors/types";
import type { ScreenTimeSession } from "../storage/LocalEventStore";
import { extractDomain, normalizeUrl } from "../utils/urlNormalization";

const DAY_MS = 24 * 60 * 60 * 1000;
const SMALL_SITE_MAX_VISITS = 5;
const FAMILIAR_SITE_MIN_VISITS = 10;
const MAIN_ROAD_LIMIT = 20;
const RISO_HUES = ["#4a9a8a", "#c4724e", "#5b8db8", "#d4b85c", "#8b6b7f"];

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
  score: number;
}

export interface Revisit {
  span: string;
  site: string;
  href: string;
  memory: string;
  hue: string;
  score: number;
}

export type DayPlateKind = "read" | "skim" | "dwell" | "wander" | "night" | "empty";

export interface DayPlate {
  date: string;
  day: string;
  vignette: string;
  kind: DayPlateKind;
  hue: string;
  strokeCount: number;
  seed: number;
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
  events: CollectionEvent[];
  sessions: ScreenTimeSession[];
  domains: WalkingRecordDomain[];
  range: WalkingRecordRange;
  cursorDistancePx?: number;
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

export function getLastCompletedWeek(now = new Date()): WalkingRecordRange {
  const currentDay = startOfLocalDay(now);
  const daysSinceMonday = (currentDay.getDay() + 6) % 7;
  const currentMonday = new Date(currentDay);
  currentMonday.setDate(currentMonday.getDate() - daysSinceMonday);

  const previousMonday = new Date(currentMonday);
  previousMonday.setDate(previousMonday.getDate() - 7);

  return {
    startTs: previousMonday.getTime(),
    endTs: currentMonday.getTime() - 1,
  };
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

export function formatDistance(px: number): string {
  const millimeters = px * 0.311;
  if (millimeters < 1_000) return `${Math.round(millimeters)} mm`;

  const meters = millimeters / 1_000;
  if (meters < 1_000) return `${meters.toFixed(1)} m`;
  return `${(meters / 1_000).toFixed(2)} km`;
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

function colorForDomain(domain: string): string {
  let hash = 0;
  for (const character of domain) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return RISO_HUES[hash % RISO_HUES.length];
}

function seedFor(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
): { departures: Departure[]; movementCount: number } {
  const visits = focusVisits(events);
  const domainByName = new Map(domains.map((domain) => [domain.domain, domain]));
  const timeByDomain = sessionsByDomain(sessions);
  const visitsByDomain = new Map<string, number>();

  for (const visit of visits) {
    visitsByDomain.set(visit.domain, (visitsByDomain.get(visit.domain) ?? 0) + 1);
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
    const rarityScore = SMALL_SITE_MAX_VISITS - domain.sessionCount + 1;
    const dwellScore = session ? Math.min(session.durationMs / 60_000, 30) / 10 : 0;
    const date = new Date(visit.ts);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

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
        domain.sessionCount === 1
          ? "new to you"
          : `${domain.sessionCount} visits by you`,
      hue: colorForDomain(visit.domain),
      score: rarityScore + dwellScore,
    });
  }

  const deduped = new Map<string, Departure>();
  for (const candidate of candidates) {
    const key = `${candidate.dayKey}:${candidate.to}`;
    const existing = deduped.get(key);
    if (!existing || candidate.score > existing.score) {
      deduped.set(key, {
        day: candidate.day,
        verb: candidate.verb,
        from: candidate.from,
        to: candidate.to,
        toUrl: candidate.toUrl,
        note: candidate.note,
        familiarity: candidate.familiarity,
        hue: candidate.hue,
        score: candidate.score,
      });
    }
  }

  const ranked = [...deduped.values()].sort((a, b) => b.score - a.score);
  return {
    movementCount: ranked.length,
    departures: ranked.slice(0, 4),
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
        domain.lastVisit > 0 &&
        domain.lastVisit < range.startTs &&
        !isPopularDomain(domain.domain),
    )
    .map((domain) => {
      const gapMs = range.endTs - domain.lastVisit;
      return {
        span: formatGap(gapMs),
        site: domain.domain,
        href: `https://${domain.domain}`,
        memory: `you visited ${domain.sessionCount} times before the gap`,
        hue: colorForDomain(domain.domain),
        score: Math.log2(domain.sessionCount + 1) * Math.log2(gapMs / DAY_MS + 1),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
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

function eventsDuringSession(
  events: CollectionEvent[],
  session: ScreenTimeSession,
): CollectionEvent[] {
  const domain = extractDomain(session.url);
  return events.filter(
    (event) =>
      event.ts >= session.focusTs &&
      event.ts <= session.blurTs &&
      extractDomain(event.meta.url) === domain,
  );
}

function getPlateKind(
  session: ScreenTimeSession,
  sessionEvents: CollectionEvent[],
): DayPlateKind {
  if (new Date(session.focusTs).getHours() < 5) return "night";

  const cursorEvents = sessionEvents.filter((event) => event.type === "cursor");
  const viewportEvents = sessionEvents.filter((event) => event.type === "viewport");
  const cursorPoints = cursorEvents.map((event) => event.data as CursorEventData);
  const xValues = cursorPoints.map((point) => point.x);
  const yValues = cursorPoints.map((point) => point.y);
  const horizontalSpan =
    xValues.length > 1 ? Math.max(...xValues) - Math.min(...xValues) : 0;
  const verticalSpan =
    yValues.length > 1 ? Math.max(...yValues) - Math.min(...yValues) : 0;
  const scrollDistance = viewportEvents.reduce((sum, event) => {
    const data = event.data as ViewportEventData;
    return sum + (data.event === "scroll" ? data.scrollDistancePx ?? 0 : 0);
  }, 0);
  const minutes = Math.max(session.durationMs / 60_000, 1);
  const scrollPerMinute = scrollDistance / minutes;

  if (scrollPerMinute > 2_000 && session.durationMs < 10 * 60_000) return "skim";
  if (horizontalSpan > verticalSpan * 1.4 && scrollPerMinute < 1_000) return "read";
  if (
    cursorPoints.length >= 3 &&
    horizontalSpan < 0.25 &&
    verticalSpan < 0.25 &&
    session.durationMs >= 8 * 60_000
  ) {
    return "dwell";
  }
  return "wander";
}

function localDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function daysInRange(range: WalkingRecordRange): Date[] {
  const days: Date[] = [];
  const cursor = startOfLocalDay(new Date(range.startTs));
  const end = startOfLocalDay(new Date(range.endTs));

  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function buildDayPlates(
  events: CollectionEvent[],
  sessions: ScreenTimeSession[],
  range: WalkingRecordRange,
  domains: WalkingRecordDomain[],
): DayPlate[] {
  const domainByName = new Map(domains.map((domain) => [domain.domain, domain]));

  return daysInRange(range).map((date) => {
    const dateKey = localDateKey(date.getTime());
    const sessionsForDay = sessions
      .filter((session) => localDateKey(session.focusTs) === dateKey)
      .sort((a, b) => {
        if (a.durationMs !== b.durationMs) return b.durationMs - a.durationMs;
        const aVisits = domainByName.get(extractDomain(a.url))?.sessionCount ?? Infinity;
        const bVisits = domainByName.get(extractDomain(b.url))?.sessionCount ?? Infinity;
        return aVisits - bVisits;
      });
    const session = sessionsForDay[0];
    const day = date.toLocaleDateString("en", { weekday: "short" }).toLowerCase();

    if (!session) {
      return {
        date: dateKey,
        day,
        vignette: "no trace kept",
        kind: "empty",
        hue: "#b5aea5",
        strokeCount: 0,
        seed: seedFor(dateKey),
      };
    }

    const domain = extractDomain(session.url);
    const sessionEvents = eventsDuringSession(events, session);
    const kind = getPlateKind(session, sessionEvents);
    const minutes = Math.max(1, Math.round(session.durationMs / 60_000));

    return {
      date: dateKey,
      day,
      vignette: `${minutes} quiet minute${minutes === 1 ? "" : "s"} on ${domain}`,
      kind,
      hue: colorForDomain(domain),
      strokeCount: Math.min(12, Math.max(2, Math.ceil(sessionEvents.length / 8))),
      seed: seedFor(`${dateKey}:${domain}`),
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
  const top = grouped.slice(0, 3);
  const quiet = grouped.filter((entry) => {
    const domain = domainByName.get(entry.domain);
    return (
      domain &&
      domain.sessionCount <= SMALL_SITE_MAX_VISITS &&
      !isMainRoad(entry.domain, mainRoads)
    );
  });
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
        hue: "#4a9a8a",
        note: `${quiet.length} small site${quiet.length === 1 ? "" : "s"} · ${quietLongReads} long read${quietLongReads === 1 ? "" : "s"}`,
      };
    }

    return {
      rank: index + 1,
      site: row.domain,
      time: formatDuration(row.totalMs),
      percentage: (row.totalMs / maxMs) * 100,
      hue: colorForDomain(row.domain),
      note: topHourNote(row.sessions),
      href: `https://${row.domain}`,
    };
  });

  if (grouped.length === 0) {
    return {
      entries: [],
      intro: "there is no completed screen-time record for this week.",
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
  events,
  sessions,
  domains,
  range,
  cursorDistancePx: measuredCursorDistance,
}: WalkingRecordInput): WalkingRecord {
  const mainRoads = getMainRoads(domains);
  const { departures, movementCount } = buildDepartures(
    events,
    sessions,
    domains,
    mainRoads,
  );
  const { entries: timeSpent, intro: timeSpentIntro } = buildTimeSpent(
    sessions,
    domains,
    mainRoads,
  );
  const totalTimeMs = sessions.reduce((sum, session) => sum + session.durationMs, 0);
  const uniquePages = new Set(
    events
      .map((event) => event.meta.url)
      .filter((url) => /^https?:\/\//.test(url))
      .map(normalizeUrl),
  );

  return {
    range,
    rangeLabel: formatRange(range),
    totalTimeMs,
    totalTimeLabel: formatDuration(totalTimeMs),
    cursorDistancePx: measuredCursorDistance ?? cursorDistance(events),
    pageCount: uniquePages.size,
    hourBuckets: hourBuckets(sessions),
    movementCount,
    departures,
    revisits: buildRevisits(domains, range),
    dayPlates: buildDayPlates(events, sessions, range, domains),
    timeSpent,
    timeSpentIntro,
  };
}
