// ABOUTME: Aggregates browsing telemetry into per-domain engagement and discovery signals.
// ABOUTME: Uses disk buckets to order unsorted sessions and participant timelines with bounded memory.

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  type WriteStream,
} from "fs";
import { once } from "events";
import path from "path";
import { finished } from "stream/promises";
import { fileURLToPath } from "url";
import { baseDomain, SECOND_LEVEL_SUFFIXES } from "./lib";

const SESSION_BUCKET_COUNT = 256;
const PARTICIPANT_BUCKET_COUNT = 256;
const DOMAIN_BUCKET_COUNT = 128;
const MAX_INTERVAL_MS = 30 * 60 * 1000;
const MAX_SESSION_DOMAIN_MS = 15 * 60 * 1000;
const MAX_SPRINGBOARD_DOWNSTREAM_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FLUSH_EVERY_ROWS = 100_000;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const OUTPUT_PATH = path.join(
  path.dirname(SCRIPT_PATH),
  "out",
  "wwo-quality.json",
);
const EXTRA_REGISTRY_SUFFIXES = new Set([
  "co.id",
  "or.id",
  "web.id",
  "com.ve",
  "com.ph",
  "co.th",
]);

// The source cannot be ordered in memory. The first pass hashes minimal events into
// session buckets. Each ordered session bucket emits compact participant visits and
// domain facts, which are hashed again for timeline ordering and final aggregation.
// Processed buckets are removed immediately so temporary disk usage also stays bounded.

type EventClass = "start" | "end" | "other";

export interface SessionEvent {
  sessionId: string;
  timestamp: number;
  ordinal: number;
  participantId: string;
  domain: string;
  url: string;
  eventClass: EventClass;
  utcDay: number;
}

export interface ParticipantVisit {
  participantId: string;
  timestamp: number;
  sessionId: string;
  ordinal: number;
  domain: string;
  fromDomain: string | null;
  downstreamEngagedMs: number;
}

interface DomainSession {
  engagedMs: number;
  urls: Set<string>;
  participants: Set<string>;
  participantDays: Set<string>;
}

export interface DomainAggregate {
  domain: string;
  quality: number;
  engagedMs: number;
  sessions: number;
  participants: number;
  returnDays: number;
  breadthMean: number;
  springboards: number;
  downstreamMs: number;
}

interface SpringboardSignals {
  springboards: number;
  downstreamMs: number;
}

interface BucketPaths {
  sessions: string[];
  participants: string[];
  domains: string[];
}

function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return result >>> 0;
}

async function* readLines(filePath: string): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let remainder = "";
  for await (const chunk of createReadStream(filePath)) {
    const text = remainder + decoder.decode(chunk, { stream: true });
    let start = 0;
    while (true) {
      const newline = text.indexOf("\n", start);
      if (newline < 0) break;
      const end =
        newline > start && text[newline - 1] === "\r" ? newline - 1 : newline;
      yield text.slice(start, end);
      start = newline + 1;
    }
    remainder = text.slice(start);
  }
  remainder += decoder.decode();
  if (remainder.length > 0) yield remainder;
}

function decodeCopyText(value: string): string | null {
  if (value === "\\N") return null;
  return value.replace(/\\(?:[0-7]{1,3}|x[0-9a-fA-F]{1,2}|.)/g, (escape) => {
    const body = escape.slice(1);
    if (/^[0-7]{1,3}$/.test(body)) {
      return String.fromCharCode(Number.parseInt(body, 8));
    }
    if (/^x[0-9a-fA-F]{1,2}$/.test(body)) {
      return String.fromCharCode(Number.parseInt(body.slice(1), 16));
    }
    const escapes: Record<string, string> = {
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
      "\\": "\\",
    };
    return escapes[body] ?? body;
  });
}

function classifyEvent(data: string): EventClass {
  const event = data.match(/"event"\s*:\s*"([^"]+)"/)?.[1];
  const visibility = data.match(/"visibility_state"\s*:\s*"([^"]+)"/)?.[1];
  if (event === "focus" || (event === "pageshow" && visibility === "visible")) {
    return "start";
  }
  if (
    event === "blur" ||
    event === "pagehide" ||
    event === "beforeunload" ||
    event === "unload"
  ) {
    return "end";
  }
  return "other";
}

function parseTimestamp(value: string): number {
  const isoTimestamp = value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  return Date.parse(isoTimestamp);
}

function normalizeUrl(rawUrl: string): { domain: string; url: string } | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    parsed.search = "";
    parsed.hash = "";
    return { domain: baseDomain(parsed.hostname), url: parsed.href };
  } catch {
    return null;
  }
}

function createBucketPaths(tempDirectory: string): BucketPaths {
  const makePaths = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) =>
      path.join(
        tempDirectory,
        `${prefix}-${index.toString().padStart(3, "0")}.tsv`,
      ),
    );
  return {
    sessions: makePaths("sessions", SESSION_BUCKET_COUNT),
    participants: makePaths("participants", PARTICIPANT_BUCKET_COUNT),
    domains: makePaths("domains", DOMAIN_BUCKET_COUNT),
  };
}

function createSinks(paths: string[]): WriteStream[] {
  return paths.map((filePath) => createWriteStream(filePath));
}

async function flushSinks(sinks: WriteStream[]): Promise<void> {
  await Promise.all(
    sinks
      .filter((sink) => sink.writableNeedDrain)
      .map((sink) => once(sink, "drain")),
  );
}

async function closeSinks(sinks: WriteStream[]): Promise<void> {
  await flushSinks(sinks);
  for (const sink of sinks) sink.end();
  await Promise.all(sinks.map((sink) => finished(sink)));
}

async function bucketInput(
  inputPath: string,
  bucketPaths: BucketPaths,
): Promise<number> {
  const sinks = createSinks(bucketPaths.sessions);
  let validRows = 0;
  let ordinal = 0;
  try {
    for await (const line of readLines(inputPath)) {
      ordinal++;
      const columns = line.split("\t");
      if (columns.length !== 10) continue;
      const timestamp = parseTimestamp(columns[2]);
      const participantId = decodeCopyText(columns[3]);
      const sessionId = decodeCopyText(columns[4]);
      const rawUrl = decodeCopyText(columns[5]);
      const data = decodeCopyText(columns[9]);
      if (
        !Number.isFinite(timestamp) ||
        participantId === null ||
        sessionId === null ||
        rawUrl === null ||
        data === null
      ) {
        continue;
      }
      const normalized = normalizeUrl(rawUrl);
      if (normalized === null) continue;
      const eventClass = classifyEvent(data);
      const bucket = hash(sessionId) % SESSION_BUCKET_COUNT;
      sinks[bucket].write(
        `${sessionId}\t${timestamp}\t${ordinal}\t${participantId}\t${normalized.domain}\t` +
          `${normalized.url}\t${eventClass}\t${Math.floor(timestamp / DAY_MS)}\n`,
      );
      validRows++;
      if (validRows % FLUSH_EVERY_ROWS === 0) await flushSinks(sinks);
    }
  } finally {
    await closeSinks(sinks);
  }
  return validRows;
}

function parseSessionEvent(line: string): SessionEvent {
  const columns = line.split("\t");
  return {
    sessionId: columns[0],
    timestamp: Number(columns[1]),
    ordinal: Number(columns[2]),
    participantId: columns[3],
    domain: columns[4],
    url: columns[5],
    eventClass: columns[6] as EventClass,
    utcDay: Number(columns[7]),
  };
}

function compareSessionEvents(left: SessionEvent, right: SessionEvent): number {
  return (
    left.sessionId.localeCompare(right.sessionId) ||
    left.timestamp - right.timestamp ||
    left.ordinal - right.ordinal
  );
}

export function aggregateSession(events: SessionEvent[]): {
  domains: Map<string, DomainSession>;
  visits: ParticipantVisit[];
} {
  const domains = new Map<string, DomainSession>();
  const visits: ParticipantVisit[] = [];
  let activeDomain: string | null = null;
  let activeSince = 0;
  let previousDomain: string | null = null;

  const domainSession = (domain: string) => {
    let aggregate = domains.get(domain);
    if (aggregate === undefined) {
      aggregate = {
        engagedMs: 0,
        urls: new Set(),
        participants: new Set(),
        participantDays: new Set(),
      };
      domains.set(domain, aggregate);
    }
    return aggregate;
  };

  const closeActiveInterval = (timestamp: number) => {
    if (activeDomain === null) return;
    const duration = timestamp - activeSince;
    if (duration >= 0 && duration <= MAX_INTERVAL_MS) {
      const aggregate = domainSession(activeDomain);
      aggregate.engagedMs = Math.min(
        MAX_SESSION_DOMAIN_MS,
        aggregate.engagedMs + duration,
      );
    }
    activeDomain = null;
  };

  for (const event of events) {
    const aggregate = domainSession(event.domain);
    aggregate.urls.add(event.url);
    aggregate.participants.add(event.participantId);
    aggregate.participantDays.add(`${event.participantId}\0${event.utcDay}`);

    if (previousDomain !== event.domain) {
      visits.push({
        participantId: event.participantId,
        timestamp: event.timestamp,
        sessionId: event.sessionId,
        ordinal: event.ordinal,
        domain: event.domain,
        fromDomain: previousDomain,
        downstreamEngagedMs: 0,
      });
    }

    if (activeDomain !== null && activeDomain !== event.domain) {
      closeActiveInterval(event.timestamp);
    }
    if (event.eventClass === "end") {
      closeActiveInterval(event.timestamp);
    } else if (event.eventClass === "start" && activeDomain === null) {
      activeDomain = event.domain;
      activeSince = event.timestamp;
    }
    previousDomain = event.domain;
  }

  for (const visit of visits) {
    visit.downstreamEngagedMs = domains.get(visit.domain)?.engagedMs ?? 0;
  }

  return { domains, visits };
}

function writeDomainSession(
  sinks: WriteStream[],
  domain: string,
  sessionId: string,
  aggregate: DomainSession,
): void {
  const bucket = hash(domain) % DOMAIN_BUCKET_COUNT;
  sinks[bucket].write(
    `${domain}\tS\t${sessionId}\t${aggregate.engagedMs}\t${aggregate.urls.size}\n`,
  );
  for (const participantId of aggregate.participants) {
    sinks[bucket].write(`${domain}\tP\t${participantId}\n`);
  }
  for (const participantDay of aggregate.participantDays) {
    sinks[bucket].write(`${domain}\tR\t${participantDay}\n`);
  }
}

function writeParticipantVisit(
  sinks: WriteStream[],
  visit: ParticipantVisit,
): void {
  const bucket = hash(visit.participantId) % PARTICIPANT_BUCKET_COUNT;
  sinks[bucket].write(
    `${visit.participantId}\t${visit.timestamp}\t${visit.sessionId}\t${visit.ordinal}\t` +
      `${visit.domain}\t${visit.fromDomain ?? ""}\t${visit.downstreamEngagedMs}\n`,
  );
}

async function processSessionBuckets(
  bucketPaths: BucketPaths,
): Promise<number> {
  const participantSinks = createSinks(bucketPaths.participants);
  const domainSinks = createSinks(bucketPaths.domains);
  let sessionCount = 0;
  try {
    for (let bucket = 0; bucket < bucketPaths.sessions.length; bucket++) {
      const events: SessionEvent[] = [];
      for await (const line of readLines(bucketPaths.sessions[bucket])) {
        if (line.length > 0) events.push(parseSessionEvent(line));
      }
      events.sort(compareSessionEvents);

      let start = 0;
      while (start < events.length) {
        let end = start + 1;
        while (
          end < events.length &&
          events[end].sessionId === events[start].sessionId
        ) {
          end++;
        }
        const sessionEvents = events.slice(start, end);
        const result = aggregateSession(sessionEvents);
        for (const [domain, aggregate] of result.domains) {
          writeDomainSession(
            domainSinks,
            domain,
            events[start].sessionId,
            aggregate,
          );
        }
        for (const visit of result.visits)
          writeParticipantVisit(participantSinks, visit);
        sessionCount++;
        start = end;
      }

      rmSync(bucketPaths.sessions[bucket]);
      await flushSinks(participantSinks);
      await flushSinks(domainSinks);
      events.length = 0;
      process.stderr.write(
        `\rOrdered session buckets: ${bucket + 1}/${bucketPaths.sessions.length}`,
      );
    }
  } finally {
    await closeSinks(participantSinks);
    await closeSinks(domainSinks);
    process.stderr.write("\n");
  }
  return sessionCount;
}

function parseParticipantVisit(line: string): ParticipantVisit {
  const columns = line.split("\t");
  return {
    participantId: columns[0],
    timestamp: Number(columns[1]),
    sessionId: columns[2],
    ordinal: Number(columns[3]),
    domain: columns[4],
    fromDomain: columns[5] || null,
    downstreamEngagedMs: Number(columns[6]),
  };
}

function compareParticipantVisits(
  left: ParticipantVisit,
  right: ParticipantVisit,
): number {
  return (
    left.participantId.localeCompare(right.participantId) ||
    left.timestamp - right.timestamp ||
    left.sessionId.localeCompare(right.sessionId) ||
    left.ordinal - right.ordinal
  );
}

export function countParticipantSpringboards(
  visits: ParticipantVisit[],
): Map<string, SpringboardSignals> {
  const signals = new Map<string, SpringboardSignals>();
  let participantId: string | null = null;
  let visitedDomains = new Set<string>();
  let start = 0;
  while (start < visits.length) {
    let end = start + 1;
    while (
      end < visits.length &&
      visits[end].participantId === visits[start].participantId &&
      visits[end].timestamp === visits[start].timestamp
    ) {
      end++;
    }
    const visit = visits[start];
    if (visit.participantId !== participantId) {
      participantId = visit.participantId;
      visitedDomains = new Set();
    }
    for (let index = start; index < end; index++) {
      const current = visits[index];
      if (current.fromDomain !== null && !visitedDomains.has(current.domain)) {
        const aggregate = signals.get(current.fromDomain) ?? {
          springboards: 0,
          downstreamMs: 0,
        };
        aggregate.springboards++;
        aggregate.downstreamMs += Math.min(
          MAX_SPRINGBOARD_DOWNSTREAM_MS,
          current.downstreamEngagedMs,
        );
        signals.set(current.fromDomain, aggregate);
      }
    }
    for (let index = start; index < end; index++) {
      visitedDomains.add(visits[index].domain);
    }
    start = end;
  }
  return signals;
}

async function countSpringboards(
  participantPaths: string[],
): Promise<Map<string, SpringboardSignals>> {
  const totals = new Map<string, SpringboardSignals>();
  for (let bucket = 0; bucket < participantPaths.length; bucket++) {
    const visits: ParticipantVisit[] = [];
    for await (const line of readLines(participantPaths[bucket])) {
      if (line.length > 0) visits.push(parseParticipantVisit(line));
    }
    visits.sort(compareParticipantVisits);
    for (const [domain, signals] of countParticipantSpringboards(visits)) {
      const aggregate = totals.get(domain) ?? {
        springboards: 0,
        downstreamMs: 0,
      };
      aggregate.springboards += signals.springboards;
      aggregate.downstreamMs += signals.downstreamMs;
      totals.set(domain, aggregate);
    }

    rmSync(participantPaths[bucket]);
    visits.length = 0;
    process.stderr.write(
      `\rOrdered participant buckets: ${bucket + 1}/${participantPaths.length}`,
    );
  }
  process.stderr.write("\n");
  return totals;
}

async function aggregateDomains(
  domainPaths: string[],
  springboards: Map<string, SpringboardSignals>,
): Promise<DomainAggregate[]> {
  const results: DomainAggregate[] = [];
  for (let bucket = 0; bucket < domainPaths.length; bucket++) {
    const aggregates = new Map<
      string,
      {
        engagedMs: number;
        sessions: number;
        breadthTotal: number;
        participants: Set<string>;
        participantDays: Set<string>;
      }
    >();
    for await (const line of readLines(domainPaths[bucket])) {
      if (line.length === 0) continue;
      const columns = line.split("\t");
      const domain = columns[0];
      let aggregate = aggregates.get(domain);
      if (aggregate === undefined) {
        aggregate = {
          engagedMs: 0,
          sessions: 0,
          breadthTotal: 0,
          participants: new Set(),
          participantDays: new Set(),
        };
        aggregates.set(domain, aggregate);
      }
      if (columns[1] === "S") {
        aggregate.sessions++;
        aggregate.engagedMs += Number(columns[3]);
        aggregate.breadthTotal += Number(columns[4]);
      } else if (columns[1] === "P") {
        aggregate.participants.add(columns[2]);
      } else if (columns[1] === "R") {
        aggregate.participantDays.add(columns[2]);
      }
    }
    for (const [domain, aggregate] of aggregates) {
      results.push({
        domain,
        quality: 0,
        engagedMs: aggregate.engagedMs,
        sessions: aggregate.sessions,
        participants: aggregate.participants.size,
        returnDays: aggregate.participantDays.size,
        breadthMean: aggregate.breadthTotal / aggregate.sessions,
        springboards: springboards.get(domain)?.springboards ?? 0,
        downstreamMs: springboards.get(domain)?.downstreamMs ?? 0,
      });
    }
    rmSync(domainPaths[bucket]);
  }
  return results;
}

function isJunkDomain(domain: string): boolean {
  return (
    SECOND_LEVEL_SUFFIXES.has(domain) ||
    EXTRA_REGISTRY_SUFFIXES.has(domain) ||
    !/[a-z]/i.test(domain) ||
    /^[0-9.]+$/.test(domain)
  );
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function qualityComponents(domain: DomainAggregate): {
  reach: number;
  generosity: number;
  launch: number;
  return: number;
} {
  return {
    reach: clamp01(domain.participants / 25),
    generosity: clamp01(domain.springboards / domain.sessions / 0.5),
    launch: clamp01(
      domain.downstreamMs / Math.max(1, domain.springboards) / 300_000,
    ),
    return: clamp01(domain.returnDays / domain.participants / 3),
  };
}

export function scoreDomains(domains: DomainAggregate[]): DomainAggregate[] {
  const included = domains.filter((domain) => !isJunkDomain(domain.domain));
  for (const domain of included) domain.quality = 0;
  const qualified = included.filter(
    (domain) => domain.participants >= 2 && domain.sessions >= 4,
  );

  for (const domain of qualified) {
    const components = qualityComponents(domain);
    const product =
      components.reach *
      components.generosity *
      components.launch *
      components.return;
    domain.quality = Math.round(product ** 0.25 * 1000) / 1000;
  }
  return included.sort(
    (left, right) =>
      right.quality - left.quality || left.domain.localeCompare(right.domain),
  );
}

function printResults(domains: DomainAggregate[]): void {
  const sanityDomains = new Set([
    "are.na",
    "thehtml.review",
    "nownownow.com",
    "gossipsweb.net",
    "spencer.place",
    "jzhao.xyz",
    "waxy.org",
    "manuelmoreale.com",
    "atlassian.net",
    "spicychat.ai",
    "watchpeopledie.tv",
    "weebcentral.com",
    "youtube.com",
    "instagram.com",
  ]);
  const rows = [
    ...domains.slice(0, 25),
    ...domains.filter(
      (domain, index) => sanityDomains.has(domain.domain) && index >= 25,
    ),
  ];
  console.log(
    "domain\tquality\tnReach\tnGenerosity\tnLaunch\tnReturn\tdownstreamMs\t" +
      "sessions\tparticipants\treturnDays\tspringboards\tengagedMs\tbreadthMean",
  );
  for (const domain of rows) {
    const components = qualityComponents(domain);
    console.log(
      `${domain.domain}\t${domain.quality.toFixed(3)}\t` +
        `${components.reach.toFixed(3)}\t${components.generosity.toFixed(3)}\t` +
        `${components.launch.toFixed(3)}\t${components.return.toFixed(3)}\t` +
        `${domain.downstreamMs}\t${domain.sessions}\t${domain.participants}\t` +
        `${domain.returnDays}\t${domain.springboards}\t${domain.engagedMs}\t` +
        `${domain.breadthMean.toFixed(3)}`,
    );
  }
}

async function main(): Promise<void> {
  const inputPath = process.argv[2];
  if (inputPath === undefined) {
    throw new Error("Usage: bun tools/atlas/quality.ts <nav-events.tsv>");
  }
  if (!existsSync(inputPath)) {
    throw new Error(`Input file does not exist: ${inputPath}`);
  }

  const scratchpadDirectory = path.dirname(path.resolve(inputPath));
  const tempDirectory = path.join(
    scratchpadDirectory,
    `atlas-quality-${process.pid}-${Date.now()}`,
  );
  mkdirSync(tempDirectory);
  const bucketPaths = createBucketPaths(tempDirectory);
  const startedAt = performance.now();
  let peakRssBytes = process.memoryUsage().rss;
  const sampleMemory = () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
  };
  const memoryMonitor = setInterval(sampleMemory, 250);
  memoryMonitor.unref();

  try {
    process.stderr.write("Bucketing input by session...\n");
    const validRows = await bucketInput(inputPath, bucketPaths);
    process.stderr.write(
      `Bucketed ${validRows.toLocaleString()} valid rows.\n`,
    );
    const sessions = await processSessionBuckets(bucketPaths);
    process.stderr.write(`Aggregated ${sessions.toLocaleString()} sessions.\n`);
    const springboards = await countSpringboards(bucketPaths.participants);
    const domains = scoreDomains(
      await aggregateDomains(bucketPaths.domains, springboards),
    );
    mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    writeFileSync(OUTPUT_PATH, `${JSON.stringify(domains, null, 2)}\n`);
    printResults(domains);
    sampleMemory();
    process.stderr.write(
      `Runtime: ${((performance.now() - startedAt) / 1000).toFixed(2)}s. ` +
        `Peak RSS: ${(peakRssBytes / 1024 / 1024).toFixed(1)} MiB.\n`,
    );
  } finally {
    clearInterval(memoryMonitor);
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === SCRIPT_PATH
) {
  await main();
}
