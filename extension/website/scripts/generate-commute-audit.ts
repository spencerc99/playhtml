// ABOUTME: Fetches the complete retained production navigation stream in bounded intervals.
// ABOUTME: Writes a local, gitignored aggregate for the Internet Commute audit dashboard.

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deserialize, serialize } from "node:v8";

import type { CollectionEvent } from "@playhtml/extension-types";

import { HistoryAuditBuilder } from "../commute-audit/auditAnalysis";

const WORKER_URL = "https://playhtml-game-api.spencerc99.workers.dev";
const MAX_EVENTS = 20_000;
const MIN_INTERVAL_MS = 1;
const MAX_CONCURRENT_REQUESTS = 4;
const DEFAULT_START = "2026-01-19T00:00:00.000Z";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CHECKPOINT_DIRECTORY = path.join(repositoryRoot, "private-data/commute-audit-checkpoints");
const STATE_PATH = path.join(repositoryRoot, "private-data/commute-audit-state.bin");
const ORIGIN_HEADERS = {
  Origin: "https://wewere.online",
  Referer: "https://wewere.online/commute/",
};

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseDate(value: string, name: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${name} must be an ISO date`);
  return timestamp;
}

class RequestGate {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_CONCURRENT_REQUESTS) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiters.shift()?.();
    }
  }
}

const requestGate = new RequestGate();

async function fetchInterval(from: number, to: number, attempt = 1): Promise<CollectionEvent[]> {
  const url = new URL("/events/recent", WORKER_URL);
  url.searchParams.set("type", "navigation");
  url.searchParams.set("limit", String(MAX_EVENTS));
  url.searchParams.set("from", new Date(from).toISOString());
  url.searchParams.set("to", new Date(to).toISOString());

  try {
    return await requestGate.run(async () => {
      const response = await fetch(url, {
        headers: ORIGIN_HEADERS,
        signal: AbortSignal.timeout(180_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const payload = await response.json();
      if (!Array.isArray(payload)) throw new Error("History response must be an array");
      return payload as CollectionEvent[];
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.match(/^HTTP (\d+)$/)?.[1];
    const retryable = status === undefined || status === "429" || Number(status) >= 500;
    if (attempt < 20 && retryable) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(30_000, attempt * 2_000)));
      return fetchInterval(from, to, attempt + 1);
    }
    throw new Error(`History request failed for ${url.searchParams.get("from")} to ${url.searchParams.get("to")}: ${message}`);
  }
}

async function loadInterval(from: number, to: number): Promise<CollectionEvent[]> {
  const events = await fetchInterval(from, to);
  const capped = events.length === MAX_EVENTS;

  if (!capped) {
    return events.reverse();
  }

  if (to - from <= MIN_INTERVAL_MS) {
    throw new Error(`More than ${MAX_EVENTS} events share the interval at ${new Date(from).toISOString()}`);
  }

  const midpoint = Math.floor((from + to) / 2);
  const [first, second] = await Promise.all([
    loadInterval(from, midpoint),
    loadInterval(midpoint + 1, to),
  ]);
  for (const event of second) first.push(event);
  return first;
}

function checkpointPath(from: number, to: number): string {
  return path.join(CHECKPOINT_DIRECTORY, `${from}-${to}.json`);
}

async function loadDay(from: number, to: number): Promise<CollectionEvent[]> {
  const filePath = checkpointPath(from, to);
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as CollectionEvent[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const hourMs = 60 * 60 * 1_000;
  const intervals: Array<{ from: number; to: number }> = [];
  let hourStart = from;
  while (hourStart <= to) {
    const hourEnd = Math.min(to, hourStart + hourMs - 1);
    intervals.push({ from: hourStart, to: hourEnd });
    hourStart = hourEnd + 1;
  }
  const hourlyEvents = await Promise.all(
    intervals.map((interval) => loadInterval(interval.from, interval.to)),
  );
  const events = hourlyEvents.flat();
  await writeFile(filePath, JSON.stringify(events), { encoding: "utf8", mode: 0o600 });
  return events;
}

async function run(): Promise<void> {
  const start = parseDate(option("from") ?? DEFAULT_START, "from");
  const requestedEnd = parseDate(option("to") ?? new Date().toISOString(), "to");
  let end = Math.min(requestedEnd, Date.now());
  if (end <= start) throw new Error("to must be after from");

  let builder = new HistoryAuditBuilder();
  let completedThrough = start - 1;
  await mkdir(CHECKPOINT_DIRECTORY, { recursive: true, mode: 0o700 });
  try {
    const state = deserialize(await readFile(STATE_PATH)) as {
      builder: HistoryAuditBuilder;
      completedThrough: number;
      end?: number;
      start: number;
    };
    if (state.start === start && (!option("to") || state.end === end)) {
      builder = state.builder;
      Object.setPrototypeOf(builder, HistoryAuditBuilder.prototype);
      completedThrough = state.completedThrough;
      if (Number.isFinite(state.end)) end = state.end as number;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const dayMs = 24 * 60 * 60 * 1_000;
  const intervals: Array<{ from: number; to: number }> = [];
  let dayStart = Math.max(start, completedThrough + 1);
  let completedDays = Math.max(0, Math.ceil((dayStart - start) / dayMs));
  const totalDays = Math.ceil((end - start) / dayMs);

  if (hasFlag("checkpoint-only")) {
    while (dayStart < end) {
      try {
        const events = JSON.parse(await readFile(checkpointPath(dayStart, Math.min(end, dayStart + dayMs - 1)), "utf8")) as CollectionEvent[];
        builder.addEvents(events);
        const dayEnd = Math.min(end, dayStart + dayMs - 1);
        completedThrough = dayEnd;
        completedDays++;
        process.stdout.write(`\rPrepared ${completedDays}/${totalDays} UTC days`);
        dayStart = dayEnd + 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        break;
      }
    }
    await writeFile(STATE_PATH, serialize({ builder, completedThrough, end, start }), { mode: 0o600 });
    process.stdout.write("\n");
    console.log(`Prepared state through ${new Date(completedThrough).toISOString()}`);
    return;
  }

  while (dayStart < end) {
    const dayEnd = Math.min(end, dayStart + dayMs - 1);
    intervals.push({ from: dayStart, to: dayEnd });
    dayStart = dayEnd + 1;
  }

  for (let index = 0; index < intervals.length; index += 4) {
    const batch = intervals.slice(index, index + 4);
    const eventBatches = await Promise.all(
      batch.map((interval) => loadDay(interval.from, interval.to)),
    );
    for (const events of eventBatches) {
      builder.addEvents(events);
      completedDays++;
      process.stdout.write(`\rAudited ${completedDays}/${totalDays} UTC days`);
    }
    completedThrough = batch.at(-1)?.to ?? completedThrough;
    await writeFile(STATE_PATH, serialize({ builder, completedThrough, end, start }), { mode: 0o600 });
  }

  const data = builder.finalize(new Date(start).toISOString(), new Date(end).toISOString());
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const outputPath = path.resolve(scriptDirectory, "../../../private-data/commute-audit-data.json");
  await mkdir(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  await writeFile(outputPath, `${JSON.stringify(data)}\n`, { encoding: "utf8", mode: 0o600 });
  await rm(CHECKPOINT_DIRECTORY, { recursive: true });
  await rm(STATE_PATH);
  process.stdout.write("\n");
  console.log(`Wrote ${outputPath}`);
  console.log(JSON.stringify(data.summary, null, 2));
}

await run();
