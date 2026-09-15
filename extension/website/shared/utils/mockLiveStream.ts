// ABOUTME: Dev-only deterministic generator of synthetic live browsing events.
// ABOUTME: Stands in for the worker /stream WebSocket so live pages run offline.

import type {
  CollectionEvent,
  InputStyling,
  KeyboardEventData,
  TypingAction,
} from "../types";

export type MockLiveStreamKind = "cursor" | "keyboard" | "viewport";

export interface MockLiveStreamOptions {
  seed: number;
  people: number;
  kinds: ReadonlySet<MockLiveStreamKind>;
  backfillSeconds: number;
  tempo: number;
}

const ALL_KINDS: readonly MockLiveStreamKind[] = [
  "cursor",
  "keyboard",
  "viewport",
];

/** Query defaults and bounds. Bounds keep a mistyped URL from generating a
 * pathological amount of history or an unusable firehose. */
const DEFAULT_SEED = 1;
const DEFAULT_PEOPLE = 8;
const MIN_PEOPLE = 1;
const MAX_PEOPLE = 40;
const DEFAULT_BACKFILL_SECONDS = 0;
const MAX_BACKFILL_SECONDS = 600;
const DEFAULT_TEMPO = 1;
const MIN_TEMPO = 0.05;
const MAX_TEMPO = 20;

/** Batch cadence, mirroring the worker's roughly-1s flush. */
const BATCH_INTERVAL_MS = 1000;
const BATCH_JITTER_MS = 200;

/** A single drained batch never exceeds this. A long backfill generates far
 * more than any consumer retains, so the oldest surplus is dropped. */
const MAX_BATCH_EVENTS = 6000;

/** Cursor sampling matches the archival CursorCollector cadence. */
const CURSOR_SAMPLE_MS = 250;
const CURSOR_SAMPLE_JITTER_MS = 40;

/** Population-level cadence for the non-cursor recordings, before tempo. */
const TYPING_RECORDING_INTERVAL_MS = 8000;
const SCROLL_RECORDING_INTERVAL_MS = 5000;

/** Sub-steps inside one cursor sample get distinct, ascending timestamps. */
const MICRO_STEP_MS = 4;

// ---------------------------------------------------------------------------
// Seeded randomness
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Small seeded PRNG wrapper. Every draw in this module goes through one of
 * these so a given seed reproduces an identical stream. */
class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  unit(): number {
    return this.next();
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length) % items.length];
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}

// ---------------------------------------------------------------------------
// Option parsing
// ---------------------------------------------------------------------------

function readInt(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readFloat(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function readKinds(params: URLSearchParams): ReadonlySet<MockLiveStreamKind> {
  const raw = params.get("mockLiveKinds");
  if (raw === null || raw.trim() === "") return new Set(ALL_KINDS);
  const requested = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is MockLiveStreamKind =>
      (ALL_KINDS as readonly string[]).includes(entry),
    );
  // An unrecognized-only list reads as "no filter" rather than a silent
  // blank screen, which is the more useful failure for a dev URL typo.
  if (requested.length === 0) return new Set(ALL_KINDS);
  return new Set(requested);
}

/**
 * Read mock-stream options from a location search string. Returns null unless
 * `mockLive` is present with a value other than "0" or "false", which is the
 * signal that the caller should generate events instead of connecting.
 */
export function parseMockLiveStreamOptions(
  search: string,
): MockLiveStreamOptions | null {
  const params = new URLSearchParams(search);
  if (!params.has("mockLive")) return null;
  const flag = (params.get("mockLive") ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false") return null;

  return {
    seed: readInt(
      params,
      "mockLiveSeed",
      DEFAULT_SEED,
      Number.MIN_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ),
    people: readInt(
      params,
      "mockLivePeople",
      DEFAULT_PEOPLE,
      MIN_PEOPLE,
      MAX_PEOPLE,
    ),
    kinds: readKinds(params),
    backfillSeconds: readFloat(
      params,
      "mockLiveBackfill",
      DEFAULT_BACKFILL_SECONDS,
      0,
      MAX_BACKFILL_SECONDS,
    ),
    tempo: readFloat(params, "mockLiveTempo", DEFAULT_TEMPO, MIN_TEMPO, MAX_TEMPO),
  };
}

// ---------------------------------------------------------------------------
// Population fixtures
// ---------------------------------------------------------------------------

/** Half RISO-equivalent hexes, then pale and dark outliers so contrast
 * edge-cases show up early rather than only in large populations. One entry is
 * null, standing in for a participant with no chosen cursor color. */
const MOCK_CURSOR_COLORS: ReadonlyArray<string | null> = [
  "#0078bf", // riso blue
  "#f3dca6", // pale sand
  "#ff665e", // riso red
  "#2b2b2b", // near black
  "#00a95c", // riso green
  "#cfe3f5", // pale blue
  "#ff7b4b", // riso orange
  null,
  "#92378d", // riso purple
  "#f6c7d6", // pale pink
  "#ffe800", // riso yellow
  "#1f3a5f", // dark navy
  "#ff48b0", // riso fluorescent pink
  "#e8e3d3", // pale bone
  "#00838a", // riso teal
  "#3a2f2f", // dark brown
];

const MOCK_TIMEZONES: readonly string[] = [
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Adelaide",
  "America/Sao_Paulo",
];

const MOCK_VIEWPORTS: ReadonlyArray<{ vw: number; vh: number }> = [
  { vw: 1512, vh: 858 },
  { vw: 1440, vh: 810 },
  { vw: 1280, vh: 720 },
  { vw: 1920, vh: 1080 },
  { vw: 1366, vh: 768 },
  { vw: 1728, vh: 1000 },
];

const MOCK_URLS: readonly string[] = [
  "https://en.wikipedia.org/wiki/Riso_printing",
  "https://en.wikipedia.org/wiki/Mycelium",
  "https://www.are.na/spencer-chang/communal-computing",
  "https://www.are.na/explore",
  "https://news.ycombinator.com/",
  "https://news.ycombinator.com/item?id=41290000",
  "https://docs.google.com/document/d/1qmockdocumentid/edit",
  "https://github.com/spencerc99/playhtml",
  "https://wewere.online/portrait",
  "https://maps.google.com/maps",
  "https://www.nytimes.com/section/arts",
  "https://bandcamp.com/discover",
];

const MOCK_INPUT_SELECTORS: readonly string[] = [
  "#search",
  "#comment",
  ".search-input",
  ".comment-box",
  "textarea",
  "input",
  "#title",
  ".editor-body",
];

/** Redaction-safe filler. No names, no addresses, no contact details. */
const MOCK_WORDS: readonly string[] = [
  "lorem",
  "ipsum",
  "dolor",
  "quiet",
  "hours",
  "printing",
  "paper",
  "ink",
  "layers",
  "mycelium",
  "threads",
  "signal",
  "window",
  "notes",
  "toward",
  "slower",
  "weather",
  "archive",
  "drawing",
  "between",
  "cursor",
  "field",
];

// ---------------------------------------------------------------------------
// Person simulation state
// ---------------------------------------------------------------------------

interface MockPerson {
  pid: string;
  sid: string;
  tz: string;
  cursorColor: string | null;
  /** Pages this person has visited; grows as they browse so most sessions
   * start a new trail, the way real browsing spreads across many URLs. */
  urls: string[];
  vw: number;
  vh: number;
  rng: Rng;
  /** Per-kind id counters. Keeping them separate makes an event's id depend
   * only on how many events of that kind the person has produced, never on
   * how the generated timeline happened to be split into batches. */
  counters: Record<MockLiveStreamKind, number>;
  /** Simulated wall clock for this person's cursor activity. */
  clock: number;
  urlIndex: number;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  sessionEndsAt: number;
  idleUntil: number;
  dwellUntil: number;
  cursorStyle: string;
  cursorStyleUntil: number;
}

function createPerson(
  index: number,
  seed: number,
  originTs: number,
  tempo: number,
): MockPerson {
  const rng = new Rng(seed * 7919 + index * 104729 + 17);
  const viewport = MOCK_VIEWPORTS[index % MOCK_VIEWPORTS.length];
  const urlCount = rng.int(2, 4);
  const urls: string[] = [];
  while (urls.length < urlCount) {
    const candidate = rng.pick(MOCK_URLS);
    if (!urls.includes(candidate)) urls.push(candidate);
  }
  const label = String(index + 1).padStart(2, "0");
  return {
    pid: `mock-p${label}`,
    sid: `mock-s${label}-${seed}`,
    tz: MOCK_TIMEZONES[index % MOCK_TIMEZONES.length],
    cursorColor: MOCK_CURSOR_COLORS[index % MOCK_CURSOR_COLORS.length],
    urls,
    vw: viewport.vw,
    vh: viewport.vh,
    rng,
    counters: { cursor: 0, keyboard: 0, viewport: 0 },
    clock: originTs,
    urlIndex: 0,
    x: rng.range(0.15, 0.85),
    y: rng.range(0.15, 0.85),
    targetX: rng.range(0.05, 0.95),
    targetY: rng.range(0.05, 0.95),
    // A person begins idle so the population starts staggered instead of
    // every cursor moving on the same frame.
    sessionEndsAt: originTs,
    idleUntil: originTs + rng.range(0, 4000) / tempo,
    dwellUntil: originTs,
    cursorStyle: "default",
    cursorStyleUntil: originTs,
  };
}

function currentUrl(person: MockPerson): string {
  return person.urls[person.urlIndex] ?? person.urls[0];
}

function clamp01(value: number): number {
  return Math.min(0.995, Math.max(0.005, value));
}

function pickTarget(person: MockPerson): void {
  const rng = person.rng;
  if (rng.chance(0.25)) {
    // Edge hugging — scanning a margin, a scrollbar, or the tab strip.
    if (rng.chance(0.5)) {
      person.targetX = rng.chance(0.5) ? rng.range(0.01, 0.08) : rng.range(0.92, 0.99);
      person.targetY = rng.range(0.05, 0.95);
    } else {
      person.targetX = rng.range(0.05, 0.95);
      person.targetY = rng.chance(0.5) ? rng.range(0.01, 0.08) : rng.range(0.92, 0.99);
    }
    return;
  }
  person.targetX = rng.range(0.05, 0.95);
  person.targetY = rng.range(0.05, 0.95);
}

function startSession(person: MockPerson): void {
  const rng = person.rng;
  if (rng.chance(0.7)) {
    // A new page means a new trail for this person. Usually it is a page
    // they have not been to yet; sometimes they go back to an earlier one,
    // which resumes that page's trail if it is still on screen.
    if (person.urls.length < 2 || rng.chance(0.8)) {
      const base = rng.pick(MOCK_URLS);
      const separator = base.includes("?") ? "&" : "?";
      person.urls.push(`${base}${separator}visit=${person.urls.length + 1}`);
      person.urlIndex = person.urls.length - 1;
    } else {
      let nextIndex = rng.int(0, person.urls.length - 2);
      if (nextIndex >= person.urlIndex) nextIndex += 1;
      person.urlIndex = nextIndex;
    }
    person.x = rng.range(0.1, 0.9);
    person.y = rng.range(0.1, 0.9);
  }
  person.sessionEndsAt = person.clock + rng.range(4000, 25000);
  person.dwellUntil = person.clock;
  person.cursorStyle = "default";
  person.cursorStyleUntil = person.clock;
  pickTarget(person);
}

// ---------------------------------------------------------------------------
// Event construction
// ---------------------------------------------------------------------------

/** Id namespaces per event kind, wide enough that no run overflows one. */
const KIND_ID_BASE: Record<MockLiveStreamKind, number> = {
  cursor: 0,
  keyboard: 1_000_000,
  viewport: 2_000_000,
};

function nextEventId(person: MockPerson, kind: MockLiveStreamKind): string {
  person.counters[kind] += 1;
  return `mock-${person.pid}-${KIND_ID_BASE[kind] + person.counters[kind]}`;
}

function personMeta(person: MockPerson): CollectionEvent["meta"] {
  return {
    pid: person.pid,
    sid: person.sid,
    url: currentUrl(person),
    vw: person.vw,
    vh: person.vh,
    tz: person.tz,
    cursor_color: person.cursorColor,
  };
}

/** Keyboard and viewport payloads are wider than the cursor-shaped `data`
 * field on `CollectionEvent`, exactly as the real pipeline's are. Consumers
 * narrow them per event type. */
function asEventData(data: unknown): CollectionEvent["data"] {
  return data as CollectionEvent["data"];
}

function cursorEvent(
  person: MockPerson,
  ts: number,
  data: CollectionEvent["data"],
): CollectionEvent {
  return {
    id: nextEventId(person, "cursor"),
    type: "cursor",
    ts,
    data,
    meta: personMeta(person),
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

interface MockLiveStreamEngine {
  /** Generate and return every event at or before `limitTs` not yet emitted,
   * sorted ascending by timestamp. */
  advanceTo(limitTs: number): CollectionEvent[];
}

function createEngine(
  options: MockLiveStreamOptions,
  originTs: number,
): MockLiveStreamEngine {
  const tempo = options.tempo;
  const people: MockPerson[] = [];
  for (let index = 0; index < options.people; index++) {
    people.push(createPerson(index, options.seed, originTs, tempo));
  }

  const typingRng = new Rng(options.seed * 31 + 1013);
  const scrollRng = new Rng(options.seed * 37 + 2027);
  let typingNextTs =
    originTs + (TYPING_RECORDING_INTERVAL_MS / tempo) * typingRng.range(0.1, 1);
  let scrollNextTs =
    originTs + (SCROLL_RECORDING_INTERVAL_MS / tempo) * scrollRng.range(0.1, 1);

  let pending: CollectionEvent[] = [];

  const advanceCursorPerson = (person: MockPerson, limitTs: number): void => {
    while (person.clock <= limitTs) {
      if (person.clock < person.idleUntil) {
        person.clock = person.idleUntil;
        startSession(person);
        continue;
      }
      if (person.clock >= person.sessionEndsAt) {
        person.idleUntil = person.clock + person.rng.range(6000, 40000) / tempo;
        continue;
      }

      const rng = person.rng;
      const sampleTs = person.clock;
      let micro = 0;
      const stamp = () => sampleTs + micro++ * MICRO_STEP_MS;

      if (person.clock >= person.dwellUntil) {
        if (rng.chance(0.06)) {
          // Dwelling: the cursor rests, so nothing is sampled.
          person.dwellUntil = person.clock + rng.range(400, 2200);
        } else {
          if (person.clock >= person.cursorStyleUntil) {
            person.cursorStyle = "default";
          }
          if (rng.chance(0.017)) {
            person.cursorStyle = rng.chance(0.6) ? "pointer" : "text";
            person.cursorStyleUntil = person.clock + rng.range(2000, 6000);
            pending.push(
              cursorEvent(person, stamp(), {
                x: Number(person.x.toFixed(4)),
                y: Number(person.y.toFixed(4)),
                event: "cursor_change",
                cursor: person.cursorStyle,
              }),
            );
          }

          const dx = person.targetX - person.x;
          const dy = person.targetY - person.y;
          if (Math.hypot(dx, dy) < 0.02 || rng.chance(0.05)) pickTarget(person);
          const ease = rng.range(0.18, 0.3);
          person.x = clamp01(person.x + dx * ease + rng.range(-0.006, 0.006));
          person.y = clamp01(person.y + dy * ease + rng.range(-0.006, 0.006));
          if (rng.chance(0.04)) {
            // Quick flick across the page.
            person.x = clamp01(person.x + rng.range(-0.18, 0.18));
            person.y = clamp01(person.y + rng.range(-0.13, 0.13));
          }

          pending.push(
            cursorEvent(person, stamp(), {
              x: Number(person.x.toFixed(4)),
              y: Number(person.y.toFixed(4)),
              event: "move",
              cursor: person.cursorStyle,
            }),
          );

          // Roughly one click per 6s and one hold per 20s of movement.
          const roll = rng.unit();
          const clickChance = CURSOR_SAMPLE_MS / 6000;
          const holdChance = CURSOR_SAMPLE_MS / 20000;
          if (roll < clickChance) {
            pending.push(
              cursorEvent(person, stamp(), {
                x: Number(person.x.toFixed(4)),
                y: Number(person.y.toFixed(4)),
                event: "click",
                cursor: person.cursorStyle,
                button: 0,
              }),
            );
          } else if (roll < clickChance + holdChance) {
            pending.push(
              cursorEvent(person, stamp(), {
                x: Number(person.x.toFixed(4)),
                y: Number(person.y.toFixed(4)),
                event: "hold",
                cursor: person.cursorStyle,
                button: 0,
                duration: rng.int(300, 1500),
              }),
            );
          }
        }
      }

      person.clock +=
        CURSOR_SAMPLE_MS +
        rng.range(-CURSOR_SAMPLE_JITTER_MS, CURSOR_SAMPLE_JITTER_MS);
    }
  };

  const buildTypingSequence = (
    rng: Rng,
    wordCount: number,
  ): { sequence: TypingAction[]; endMs: number } => {
    const sequence: TypingAction[] = [];
    let elapsed = rng.range(0, 400);
    let pendingText = "";
    for (let index = 0; index < wordCount; index++) {
      const word = rng.pick(MOCK_WORDS);
      pendingText += index === 0 ? word : ` ${word}`;
      elapsed += word.length * rng.range(70, 165);
      if (rng.chance(0.3) || index === wordCount - 1) {
        sequence.push({
          action: "type",
          text: pendingText,
          timestamp: Math.round(elapsed),
        });
        pendingText = "";
        if (rng.chance(0.25) && index < wordCount - 1) {
          elapsed += rng.range(250, 900);
          sequence.push({
            action: "backspace",
            deletedCount: rng.int(1, 3),
            timestamp: Math.round(elapsed),
          });
        }
      }
    }
    if (pendingText.length > 0) {
      elapsed += rng.range(150, 400);
      sequence.push({
        action: "type",
        text: pendingText,
        timestamp: Math.round(elapsed),
      });
    }
    return { sequence, endMs: Math.round(elapsed) };
  };

  const generateTypingRecording = (atTs: number): void => {
    const person = typingRng.pick(people);
    const rng = typingRng;
    const selector = rng.pick(MOCK_INPUT_SELECTORS);
    const x = Number(rng.range(0.1, 0.85).toFixed(4));
    const y = Number(rng.range(0.15, 0.85).toFixed(4));
    const style: InputStyling = {
      w: rng.int(160, 680),
      h: rng.int(28, 140),
      br: rng.int(0, 20),
      bg: Number(rng.range(0, 1).toFixed(3)),
      bs: rng.int(0, 4),
    };
    const url = currentUrl(person);
    const meta = { ...personMeta(person), url };

    // A recording is one or two captured fragments for the same input, which
    // is what the collector's debounce produces for a longer sentence.
    const fragments = rng.chance(0.4) ? 2 : 1;
    let ts = atTs;
    for (let index = 0; index < fragments; index++) {
      const { sequence, endMs } = buildTypingSequence(rng, rng.int(3, 9));
      const data: KeyboardEventData = {
        x,
        y,
        t: selector,
        event: "type",
        sequence,
        style,
      };
      pending.push({
        id: nextEventId(person, "keyboard"),
        type: "keyboard",
        ts: Math.round(ts),
        data: asEventData(data),
        meta,
      });
      // Stay inside the 35s merge window so both fragments read as one input.
      ts += endMs + rng.range(1500, 9000);
    }
  };

  const generateScrollRecording = (atTs: number): void => {
    const person = scrollRng.pick(people);
    const rng = scrollRng;
    const url = currentUrl(person);
    const sampleCount = rng.int(6, 22);
    let scrollY = rng.range(0, 0.35);
    let scrollX = 0;
    let ts = atTs;
    const meta = { ...personMeta(person), url };

    for (let index = 0; index < sampleCount; index++) {
      const direction = rng.chance(0.82) ? 1 : -1;
      const delta = rng.range(0.012, 0.075) * direction;
      const nextY = Math.min(1, Math.max(0, scrollY + delta));
      const movedPx = Math.round(Math.abs(nextY - scrollY) * person.vh * 8);
      scrollY = nextY;
      if (rng.chance(0.05)) {
        scrollX = Math.min(1, Math.max(0, scrollX + rng.range(-0.05, 0.05)));
      }
      pending.push({
        id: nextEventId(person, "viewport"),
        type: "viewport",
        ts: Math.round(ts),
        data: asEventData({
          event: "scroll",
          scrollX: Number(scrollX.toFixed(4)),
          scrollY: Number(scrollY.toFixed(4)),
          scrollDistancePx: Math.max(1, movedPx),
        }),
        meta,
      });
      ts += rng.range(90, 260);
    }

    if (rng.chance(0.2)) {
      const originalWidth = person.vw;
      const originalHeight = person.vh;
      const shrunkWidth = Math.max(480, originalWidth - rng.int(160, 420));
      const shrunkHeight = Math.max(360, originalHeight - rng.int(80, 220));
      let resizeTs = atTs + rng.range(300, 1200);
      person.vw = shrunkWidth;
      person.vh = shrunkHeight;
      pending.push({
        id: nextEventId(person, "viewport"),
        type: "viewport",
        ts: Math.round(resizeTs),
        data: asEventData({
          event: "resize",
          width: shrunkWidth,
          height: shrunkHeight,
          quantity: rng.int(1, 4),
        }),
        meta: { ...personMeta(person), url },
      });
      resizeTs += rng.range(1200, 4000);
      person.vw = originalWidth;
      person.vh = originalHeight;
      pending.push({
        id: nextEventId(person, "viewport"),
        type: "viewport",
        ts: Math.round(resizeTs),
        data: asEventData({
          event: "resize",
          width: originalWidth,
          height: originalHeight,
          quantity: rng.int(1, 4),
        }),
        meta: { ...personMeta(person), url },
      });
    }

    if (rng.chance(0.12)) {
      const zoomed = Number(rng.range(1.15, 1.6).toFixed(2));
      let zoomTs = atTs + rng.range(400, 1600);
      pending.push({
        id: nextEventId(person, "viewport"),
        type: "viewport",
        ts: Math.round(zoomTs),
        data: asEventData({
          event: "zoom",
          zoom: zoomed,
          previous_zoom: 1,
          quantity: rng.int(1, 3),
        }),
        meta,
      });
      zoomTs += rng.range(1500, 5000);
      pending.push({
        id: nextEventId(person, "viewport"),
        type: "viewport",
        ts: Math.round(zoomTs),
        data: asEventData({
          event: "zoom",
          zoom: 1,
          previous_zoom: zoomed,
          quantity: rng.int(1, 3),
        }),
        meta,
      });
    }
  };

  return {
    advanceTo(limitTs: number): CollectionEvent[] {
      if (options.kinds.has("cursor")) {
        for (const person of people) advanceCursorPerson(person, limitTs);
      }
      if (options.kinds.has("keyboard")) {
        while (typingNextTs <= limitTs) {
          generateTypingRecording(typingNextTs);
          typingNextTs +=
            (TYPING_RECORDING_INTERVAL_MS / tempo) * typingRng.range(0.6, 1.5);
        }
      }
      if (options.kinds.has("viewport")) {
        while (scrollNextTs <= limitTs) {
          generateScrollRecording(scrollNextTs);
          scrollNextTs +=
            (SCROLL_RECORDING_INTERVAL_MS / tempo) * scrollRng.range(0.6, 1.5);
        }
      }

      const ready: CollectionEvent[] = [];
      const held: CollectionEvent[] = [];
      for (const event of pending) {
        if (event.ts <= limitTs) ready.push(event);
        else held.push(event);
      }
      pending = held;
      ready.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
      return ready.length > MAX_BATCH_EVENTS
        ? ready.slice(ready.length - MAX_BATCH_EVENTS)
        : ready;
    },
  };
}

/**
 * Start generating synthetic live events. Batches arrive roughly every second
 * (seeded jitter), carrying real `Date.now()`-based timestamps in ascending
 * order. When `backfillSeconds` is positive the first batch is emitted
 * immediately and holds that much simulated history ending at the start time,
 * mimicking the worker replaying its ring buffer on connect.
 *
 * Returns a stop function; call it on cleanup.
 */
export function startMockLiveStream(
  options: MockLiveStreamOptions,
  onBatch: (events: CollectionEvent[]) => void,
): () => void {
  const startTs = Date.now();
  const originTs = startTs - Math.round(options.backfillSeconds * 1000);
  const engine = createEngine(options, originTs);
  const jitterRng = new Rng(options.seed * 41 + 4093);

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emitUpTo = (limitTs: number) => {
    const events = engine.advanceTo(limitTs);
    if (events.length > 0) onBatch(events);
  };

  if (options.backfillSeconds > 0) emitUpTo(startTs);

  const scheduleNext = () => {
    if (stopped) return;
    const delay =
      BATCH_INTERVAL_MS + jitterRng.range(-BATCH_JITTER_MS, BATCH_JITTER_MS);
    timer = setTimeout(
      () => {
        timer = undefined;
        if (stopped) return;
        emitUpTo(Date.now());
        scheduleNext();
      },
      Math.max(1, Math.round(delay)),
    );
  };

  scheduleNext();

  return () => {
    stopped = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
}
