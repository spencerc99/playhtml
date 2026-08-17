// ABOUTME: Replays a slice of real browsing events through the sound engine
// ABOUTME: Drives trails, clicks and navigations from live worker data or a bundled fixture

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SoundEngine } from "../shared/sound/SoundEngine";
import {
  ClickPercussionVariant,
  TrailSoundFrame,
} from "../shared/sound/types";
import { RECENT_EVENTS_URL } from "../shared/config";
import bundledSample from "./sampleEvents.json";

const PAD_HEIGHT = 300;
/** Points kept per participant for the on-canvas ribbon. */
const TRAIL_LENGTH = 50;
/** How long a participant stays drawn after their last event (ms of replay). */
const TRAIL_IDLE_TIMEOUT_MS = 4000;

/**
 * One replayable event, flattened to what the sound layer and the canvas need.
 * Coordinates are the normalized 0-1 the collectors record, so the same sample
 * replays at any pad size.
 */
export interface SampleEvent {
  /** Milliseconds from the start of the sample. */
  t: number;
  type: SampleEventType;
  /** Generic participant id — the bundled fixture carries no real identity. */
  pid: string;
  event: string;
  domain: string;
  x?: number;
  y?: number;
  cursor?: string;
  duration?: number;
  /**
   * A keyboard event's cadence, and nothing else: one entry per keystroke
   * group, holding when it happened relative to the start of the event and
   * how many characters it moved. What was typed never gets this far — see
   * `keystrokeCadence`.
   */
  keys?: KeystrokeBeat[];
  /**
   * How far a viewport scroll travelled, in pixels. Drives the brush's weight;
   * the normalized scroll position itself is not needed to hear it.
   */
  scrollDistancePx?: number;
}

/** Every event family the replay knows how to drive. */
export type SampleEventType = "cursor" | "navigation" | "keyboard" | "viewport";

/**
 * One keystroke group, reduced to timing and size. `count` is a character
 * count — how many keys the group represents — and carries no information
 * about which ones they were.
 */
export interface KeystrokeBeat {
  /** Milliseconds from the start of the keyboard event. */
  dt: number;
  count: number;
}

/**
 * The cadence of a recorded typing sequence, with every trace of its content
 * removed.
 *
 * Keyboard events carry the text a person typed (redacted to their legibility
 * setting, but still their words), the selector of the field they typed into,
 * and the field's dimensions. None of that means anything to a percussion
 * tick, which needs only when keys were pressed and how many. So this keeps
 * `timestamp` and a character count and drops the rest — no text, redacted or
 * otherwise, ever reaches a `SampleEvent`, which is what makes the fixture
 * safe to commit.
 */
export function keystrokeCadence(data: Record<string, unknown>): KeystrokeBeat[] {
  const sequence = data.sequence;
  if (!Array.isArray(sequence)) return [];
  const beats: KeystrokeBeat[] = [];
  for (const entry of sequence) {
    if (typeof entry !== "object" || entry === null) continue;
    const action = entry as Record<string, unknown>;
    const dt = typeof action.timestamp === "number" ? action.timestamp : 0;
    // A typed run is as many keystrokes as it has characters; a backspace is
    // as many as it deleted. Only the count survives either way.
    const typed = typeof action.text === "string" ? action.text.length : 0;
    const deleted =
      typeof action.deletedCount === "number" ? action.deletedCount : 0;
    const count = Math.max(typed, deleted);
    if (count <= 0) continue;
    beats.push({ dt: Math.max(0, Math.round(dt)), count });
  }
  return beats;
}

/**
 * CSS cursor keywords the instrument mapping understands. A page can set a
 * cursor to an arbitrary `url(...)`, including an inline data URI carrying its
 * own markup, so a raw cursor string is page content and must never be kept.
 * Only the keyword forms mean anything to the sound layer anyway.
 */
const CURSOR_KEYWORDS = new Set([
  "auto", "default", "pointer", "text", "grab", "grabbing", "crosshair",
  "move", "all-scroll", "not-allowed", "wait", "help", "progress",
  "ns-resize", "ew-resize", "nesw-resize", "nwse-resize", "col-resize",
  "row-resize", "zoom-in", "zoom-out", "copy", "alias", "cell",
  "context-menu", "none", "vertical-text", "no-drop",
]);

/** The effective keyword from a CSS cursor value, or undefined if it has none. */
function cursorKeyword(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // A CSS cursor may list fallbacks; the last keyword is the effective one.
  const parts = value.split(",").map((part) => part.trim());
  for (let i = parts.length - 1; i >= 0; i--) {
    if (CURSOR_KEYWORDS.has(parts[i])) return parts[i];
  }
  return undefined;
}

const SPEEDS = [0.5, 1, 2, 4] as const;
type Speed = (typeof SPEEDS)[number];

/** Colours cycled across participants so trails stay tellable apart. */
const SAMPLE_COLORS = [
  "#4a9a8a",
  "#c4724e",
  "#5b8db8",
  "#d4b85c",
  "#8a6fa8",
  "#6f8a4a",
];

/**
 * Selectable replay windows. The archive page fetches whole days and animates
 * a batch at a time; the playground needs a span long enough to hear a scene
 * build and thin out, which the old fixed three minutes was not.
 */
export const WINDOW_OPTIONS = [
  { label: "5 min", ms: 300_000 },
  { label: "15 min", ms: 900_000 },
  { label: "30 min", ms: 1_800_000 },
  { label: "60 min", ms: 3_600_000 },
] as const;

export const DEFAULT_WINDOW_MS = 900_000;

/**
 * Per-type fetch ceiling. The archive page asks the worker for 20000 rows per
 * event type (its hard ceiling) for a broad no-day fetch, and animates the
 * result; the playground matches that so a loaded sample is as dense as the
 * page it is meant to represent. Memory is the only real constraint here —
 * 20000 rows per type is roughly 20MB of JSON, which the archive page already
 * carries.
 */
export const FETCH_LIMIT = 20000;

/**
 * The `windowMs` slice containing the most events. A plain "most recent N"
 * cut can land on a quiet stretch and loop as near-silence; the busiest window
 * is the part with something to hear.
 */
export function densestWindow<T extends { ts: number }>(
  sorted: T[],
  windowMs: number,
): T[] {
  if (sorted.length === 0) return [];
  let bestStart = 0;
  let bestCount = 0;
  let end = 0;
  for (let start = 0; start < sorted.length; start++) {
    if (end < start) end = start;
    while (end < sorted.length && sorted[end].ts < sorted[start].ts + windowMs) {
      end++;
    }
    if (end - start > bestCount) {
      bestCount = end - start;
      bestStart = start;
    }
  }
  return sorted.slice(bestStart, bestStart + bestCount);
}

/** What a loaded sample contains, for the readout above the pad. */
export interface SampleSummary {
  events: number;
  participants: number;
  moves: number;
  clicks: number;
  navigations: number;
  /** Individual keystrokes across every keyboard event, not event count. */
  keypresses: number;
  scrolls: number;
  domains: number;
  /** Wall time the sample spans, in ms. */
  spanMs: number;
}

/** Count what a sample holds, so the readout describes what is being auditioned. */
export function summarizeSample(events: SampleEvent[]): SampleSummary {
  const participants = new Set<string>();
  const domains = new Set<string>();
  let moves = 0;
  let clicks = 0;
  let navigations = 0;
  let keypresses = 0;
  let scrolls = 0;
  for (const event of events) {
    participants.add(event.pid);
    domains.add(event.domain);
    if (event.type === "navigation") navigations++;
    else if (event.type === "keyboard") {
      for (const beat of event.keys ?? []) keypresses += beat.count;
    } else if (event.type === "viewport") {
      if (event.event === "scroll") scrolls++;
    } else if (event.event === "move") moves++;
    else if (event.event === "click" || event.event === "hold") clicks++;
  }
  return {
    events: events.length,
    participants: participants.size,
    moves,
    clicks,
    navigations,
    keypresses,
    scrolls,
    domains: domains.size,
    spanMs: events.length > 0 ? events[events.length - 1].t : 0,
  };
}

/** The event types the replay asks the worker for, one request each. */
const FETCHED_TYPES: SampleEventType[] = [
  "cursor",
  "navigation",
  "keyboard",
  "viewport",
];

/**
 * Pull a live slice from the worker, matching the archive page's fetch shape:
 * one broad request per event type at the worker's ceiling, then the densest
 * window of the requested length. Anything that fails here falls back to the
 * bundled fixture, so the playground still works offline.
 */
export async function fetchSampleEvents(
  domain: string,
  windowMs: number = DEFAULT_WINDOW_MS,
  limit = FETCH_LIMIT,
): Promise<SampleEvent[]> {
  const load = async (type: SampleEventType) => {
    const params = new URLSearchParams({ type, limit: String(limit) });
    if (domain) params.set("domain", domain);
    const response = await fetch(`${RECENT_EVENTS_URL}?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${type} events: ${response.status}`);
    }
    return response.json() as Promise<
      Array<{
        type: string;
        ts: number;
        data: Record<string, unknown>;
        meta: { pid: string; url?: string };
      }>
    >;
  };

  const byType = await Promise.all(FETCHED_TYPES.map(load));
  const all = byType.flat().sort((a, b) => a.ts - b.ts);
  if (all.length === 0) return [];

  // Keep the densest window rather than the whole fetch. A quiet half-hour
  // loops as mostly silence; the busy stretch is what there is to listen to.
  const raw = densestWindow(all, windowMs);

  // Identities never leave this function — participants are renumbered on the
  // way through, so nothing downstream can carry a real id.
  const pids = new Map<string, string>();
  const anonymize = (pid: string) => {
    let id = pids.get(pid);
    if (!id) {
      id = `p${String(pids.size + 1).padStart(2, "0")}`;
      pids.set(pid, id);
    }
    return id;
  };

  const startTs = raw[0].ts;
  return raw.map((event) => {
    const data = event.data;
    let domainName = "unknown";
    try {
      domainName = new URL(event.meta.url ?? "").hostname || "unknown";
    } catch {
      /* keep the fallback */
    }
    const type: SampleEventType = FETCHED_TYPES.includes(
      event.type as SampleEventType,
    )
      ? (event.type as SampleEventType)
      : "cursor";
    return {
      t: event.ts - startTs,
      type,
      pid: anonymize(event.meta.pid),
      event: String(data.event ?? ""),
      domain: domainName,
      x: typeof data.x === "number" ? data.x : undefined,
      y: typeof data.y === "number" ? data.y : undefined,
      cursor: cursorKeyword(data.cursor),
      duration: typeof data.duration === "number" ? data.duration : undefined,
      // Keyboard events carry the typed text and the field's selector. Only
      // the cadence crosses this boundary; see `keystrokeCadence`.
      ...(type === "keyboard" ? { keys: keystrokeCadence(data) } : {}),
      ...(type === "viewport" && typeof data.scrollDistancePx === "number"
        ? { scrollDistancePx: Math.round(data.scrollDistancePx) }
        : {}),
    } satisfies SampleEvent;
  });
}

/**
 * A participant's cursor moves in replay order, with the sample clock each was
 * recorded at. Playback walks this rather than the flat event list so a
 * position can be interpolated between two samples.
 */
export interface MoveTrack {
  pid: string;
  points: Array<{ t: number; x: number; y: number; cursor?: string }>;
}

/** Group cursor moves per participant, preserving order. */
export function buildMoveTracks(events: SampleEvent[]): Map<string, MoveTrack> {
  const tracks = new Map<string, MoveTrack>();
  for (const event of events) {
    if (event.type !== "cursor" || event.event !== "move") continue;
    if (event.x === undefined || event.y === undefined) continue;
    let track = tracks.get(event.pid);
    if (!track) {
      track = { pid: event.pid, points: [] };
      tracks.set(event.pid, track);
    }
    track.points.push({
      t: event.t,
      x: event.x,
      y: event.y,
      cursor: event.cursor,
    });
  }
  return tracks;
}

/**
 * Longest gap between consecutive samples that is still treated as one
 * continuous stroke. Archival cursor sampling is ~250ms, so a gap far beyond
 * that means the participant stopped and started again somewhere else —
 * interpolating across it would draw a line they never travelled.
 */
export const MAX_INTERPOLATION_GAP_MS = 1200;

/**
 * The interpolated position of a track at a sample-clock time, in normalized
 * 0-1 coordinates, or null when the track is not live at that moment.
 *
 * This is what makes replay match the archive page. Archival cursor events are
 * sparse (~250ms sampling behind a 15px movement threshold), so replaying them
 * as discrete jumps teleports the cursor between samples. The archive page
 * animates a trail by walking its points on a playback clock and lerping
 * between the two bracketing points; doing the same here matters doubly for
 * sound, because the engine derives velocity from per-frame position deltas —
 * a teleport reads as one enormous velocity spike followed by zero, which
 * distorts gain, soloist promotion, swell onset and note density. Lerping
 * gives the engine the continuous velocity a live page would produce.
 *
 * `searchFrom` is the caller's cached index into `points`; playback advances
 * monotonically, so passing the previous result keeps this O(1) per frame
 * rather than re-scanning the track.
 */
export function interpolateTrackPosition(
  track: MoveTrack,
  timeMs: number,
  searchFrom = 0,
): { x: number; y: number; cursor?: string; index: number } | null {
  const points = track.points;
  if (points.length === 0) return null;
  if (timeMs < points[0].t) return null;

  let index = Math.min(Math.max(searchFrom, 0), points.length - 1);
  // The clock may have rewound (a loop), so walk back before walking forward.
  while (index > 0 && points[index].t > timeMs) index--;
  while (index < points.length - 1 && points[index + 1].t <= timeMs) index++;

  const current = points[index];
  const next = index < points.length - 1 ? points[index + 1] : undefined;

  if (!next) {
    return { x: current.x, y: current.y, cursor: current.cursor, index };
  }

  const gap = next.t - current.t;
  if (gap <= 0 || gap > MAX_INTERPOLATION_GAP_MS) {
    // Too long a gap to be one stroke: hold the last known position rather
    // than sliding across a jump the participant never made.
    return { x: current.x, y: current.y, cursor: current.cursor, index };
  }

  const fraction = (timeMs - current.t) / gap;
  return {
    x: current.x + (next.x - current.x) * fraction,
    y: current.y + (next.y - current.y) * fraction,
    cursor: current.cursor,
    index,
  };
}

/** What one participant looks like on the pad while the sample plays. */
interface SampleTrail {
  trailIndex: number;
  pid: string;
  color: string;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  cursorType: string | undefined;
  lastEventMs: number;
  firstSeen: boolean;
  /** Cached cursor into the participant's move track. */
  searchIndex: number;
  points: Array<{ x: number; y: number }>;
}

const labelStyle: React.CSSProperties = {
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#8a8279",
};

const buttonStyle: React.CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #e0dbd4",
  background: "#f5f0e8",
  cursor: "pointer",
  fontFamily: "'Martian Mono', monospace",
  fontSize: "11px",
  color: "#3d3833",
};

const buttonActiveStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#3d3833",
  color: "#faf7f2",
  border: "1px solid #3d3833",
};

const selectStyle: React.CSSProperties = {
  ...buttonStyle,
  padding: "8px 10px",
};

/**
 * How the replay voices each family of event when percussion is on.
 *
 * Pad-only, and off by default: with `enabled` false the replay behaves
 * exactly as it always has (pitched bells for clicks, the gong for
 * navigations, nothing at all for keyboard and viewport events).
 */
export interface PercussionSettings {
  enabled: boolean;
  click: ClickPercussionVariant;
  typing: boolean;
  scroll: boolean;
  /** Hold roll under a held click, in place of the stretched bell. */
  hold: boolean;
}

const PERCUSSION_DEFAULTS: PercussionSettings = {
  enabled: false,
  click: "bells",
  typing: true,
  scroll: true,
  hold: true,
};

const CLICK_VARIANTS: Array<{
  variant: ClickPercussionVariant;
  label: string;
}> = [
  { variant: "bells", label: "bells (current)" },
  { variant: "tap", label: "tap" },
  { variant: "tapNoThump", label: "tap, no thump" },
  { variant: "hybrid", label: "tap + bell ghost" },
];

/**
 * Longest a recorded typing sequence may be stretched over before its ticks
 * are compressed. A sequence's own timestamps span the whole 5s debounce
 * window the collector batches on, and scheduling ticks that far out would let
 * them outlive a loop; past this the cadence is squeezed to fit.
 */
export const MAX_KEYSTROKE_SPREAD_MS = 3000;

/**
 * How late a queued keystroke may be and still sound. A backgrounded tab
 * stops the rAF loop while the sample clock keeps running, so returning to it
 * finds a backlog; firing that as one volley would be a burst of static rather
 * than typing.
 */
export const LATE_KEYSTROKE_MS = 250;

/**
 * When each keystroke of a recorded typing event should sound, in ms from the
 * event itself, and how hard.
 *
 * A recorded group is "these N characters, starting at this offset", so its
 * keys are spread evenly across the gap to the next group — which is what
 * turns a stored batch back into something with a typist's rhythm rather than
 * N ticks stacked on one instant. The final group has no following gap, so it
 * borrows the previous one's pace.
 */
export function keystrokeSchedule(
  beats: KeystrokeBeat[],
): Array<{ at: number; jitter: number }> {
  if (beats.length === 0) return [];

  const span = beats[beats.length - 1].dt;
  const squeeze = span > MAX_KEYSTROKE_SPREAD_MS ? MAX_KEYSTROKE_SPREAD_MS / span : 1;

  const schedule: Array<{ at: number; jitter: number }> = [];
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    const next = beats[i + 1];
    const previous = beats[i - 1];
    const groupSpan = next
      ? next.dt - beat.dt
      : previous
        ? beat.dt - previous.dt
        : // A lone group: give it a plain typist's pace to spread over.
          beat.count * 120;
    const perKey = beat.count > 0 ? groupSpan / beat.count : 0;
    for (let k = 0; k < beat.count; k++) {
      schedule.push({
        at: (beat.dt + perKey * k) * squeeze,
        // Deterministic weight variation across the run, so a burst does not
        // read as one sample retriggered. No randomness: the same recorded
        // event must sound the same on every loop.
        jitter: Math.sin((beat.dt + k) * 12.9898) * 0.8,
      });
    }
  }
  return schedule;
}

interface SamplePlaybackProps {
  /**
   * The engine the pad already owns, so the sample plays through whatever
   * toggles are currently set rather than through a second configuration.
   */
  getEngine: () => Promise<SoundEngine>;
}

/**
 * Replays a real browsing sample through the pad's engine, so sound settings
 * can be judged against genuine cursor motion rather than random walkers.
 */
export const SamplePlayback = ({ getEngine }: SamplePlaybackProps) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<SoundEngine | null>(null);
  const rafRef = useRef<number | null>(null);
  const eventsRef = useRef<SampleEvent[]>(bundledSample as SampleEvent[]);
  const tracksRef = useRef<Map<string, MoveTrack>>(
    buildMoveTracks(bundledSample as SampleEvent[]),
  );
  const trailsRef = useRef<Map<string, SampleTrail>>(new Map());
  const nextTrailIndexRef = useRef(0);
  const cursorRef = useRef(0);
  const startedAtRef = useRef(0);
  const speedRef = useRef<Speed>(1);
  const loopCountRef = useRef(0);
  const percussionRef = useRef<PercussionSettings>(PERCUSSION_DEFAULTS);
  /**
   * Keystrokes waiting for their moment on the sample clock. A recorded typing
   * event holds a whole sequence, so its ticks are queued here and drained as
   * playback reaches each one rather than fired together when the event lands.
   * Kept sorted by `at`, which is how it is built.
   */
  const keystrokeQueueRef = useRef<Array<{ at: number; x: number; jitter: number }>>(
    [],
  );

  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<Speed>(1);
  const [windowMs, setWindowMs] = useState<number>(DEFAULT_WINDOW_MS);
  const [source, setSource] = useState<"bundled" | "live">("bundled");
  const [loadState, setLoadState] = useState<"idle" | "loading" | "error">(
    "idle",
  );
  const [summary, setSummary] = useState<SampleSummary>(() =>
    summarizeSample(bundledSample as SampleEvent[]),
  );
  const [readout, setReadout] = useState({ position: 0, active: 0, loops: 0 });
  const [percussion, setPercussion] = useState<PercussionSettings>(
    PERCUSSION_DEFAULTS,
  );

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    percussionRef.current = percussion;
    // Queued ticks belong to the settings that queued them; turning typing off
    // mid-replay should stop it now rather than after the backlog drains.
    if (!percussion.enabled || !percussion.typing) {
      keystrokeQueueRef.current = [];
    }
  }, [percussion]);

  const sampleDurationMs = summary.spanMs;

  /** Drop every trail and rewind to the top of the sample. */
  const rewind = useCallback(() => {
    for (const trail of trailsRef.current.values()) {
      engineRef.current?.retireTrail(trail.trailIndex);
    }
    trailsRef.current.clear();
    cursorRef.current = 0;
    nextTrailIndexRef.current = 0;
    keystrokeQueueRef.current = [];
  }, []);

  /** Swap in a freshly loaded sample and restart playback from its top. */
  const adoptSample = useCallback(
    (events: SampleEvent[]) => {
      eventsRef.current = events;
      tracksRef.current = buildMoveTracks(events);
      setSummary(summarizeSample(events));
      rewind();
      startedAtRef.current = performance.now();
      loopCountRef.current = 0;
    },
    [rewind],
  );

  const frame = useCallback(() => {
    const canvas = canvasRef.current;
    const engine = engineRef.current;
    if (!canvas || !engine) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const events = eventsRef.current;
    const wallElapsed = performance.now() - startedAtRef.current;
    const sampleMs = wallElapsed * speedRef.current;

    // Fire every discrete event whose moment has arrived since the last frame.
    // Moves only mark a participant as present — their drawn position comes
    // from interpolating the move track below, so the cursor glides between
    // sparse samples instead of teleporting to each one.
    while (
      cursorRef.current < events.length &&
      events[cursorRef.current].t <= sampleMs
    ) {
      const event = events[cursorRef.current++];
      const x = (event.x ?? 0.5) * width;
      const y = (event.y ?? 0.5) * height;
      const percussion = percussionRef.current;

      if (event.type === "navigation") {
        // Only real page arrivals sound; blur and beforeunload are departures.
        if (event.event === "focus" || event.event === "popstate") {
          engine.triggerNavigation({ x });
        }
        continue;
      }

      if (event.type === "keyboard") {
        if (!percussion.enabled || !percussion.typing) continue;
        // Queue the sequence's ticks rather than firing them here: they are
        // spread over the seconds the person actually spent typing.
        for (const tick of keystrokeSchedule(event.keys ?? [])) {
          keystrokeQueueRef.current.push({
            at: event.t + tick.at,
            x,
            jitter: tick.jitter,
          });
        }
        keystrokeQueueRef.current.sort((a, b) => a.at - b.at);
        continue;
      }

      if (event.type === "viewport") {
        if (!percussion.enabled || !percussion.scroll) continue;
        // Resizes and zooms are not motion through a page, so only scrolls
        // get a brush stroke.
        if (event.event !== "scroll") continue;
        // A viewport event carries no coordinate of its own. Placing the brush
        // where the same person's cursor is keeps their scroll and their
        // motion in the same part of the stereo field.
        engine.triggerScroll(trailsRef.current.get(event.pid)?.x ?? x);
        continue;
      }

      let trail = trailsRef.current.get(event.pid);
      if (!trail) {
        const trailIndex = nextTrailIndexRef.current++;
        trail = {
          trailIndex,
          pid: event.pid,
          color: SAMPLE_COLORS[trailIndex % SAMPLE_COLORS.length],
          x,
          y,
          prevX: x,
          prevY: y,
          cursorType: event.cursor,
          lastEventMs: sampleMs,
          firstSeen: true,
          searchIndex: 0,
          points: [],
        };
        trailsRef.current.set(event.pid, trail);
      }

      trail.lastEventMs = sampleMs;
      if (event.cursor) trail.cursorType = event.cursor;

      if (event.event === "click" || event.event === "hold") {
        const isHold = event.event === "hold" || event.duration !== undefined;
        const rollThisHold =
          percussion.enabled && percussion.hold && isHold;
        if (rollThisHold) engine.triggerHold(x);

        if (percussion.enabled && percussion.click !== "bells") {
          engine.triggerClickPercussion(x, percussion.click);
        } else if (!rollThisHold) {
          // The shipped bell, unless the hold roll has already taken this
          // event — the roll replaces the stretched bell rather than layering
          // on top of it.
          engine.triggerClick({ x, y, holdDuration: event.duration });
        }
      }
    }

    // Drain every keystroke whose moment has arrived. Ticks are tiny, but a
    // long stall (a background tab) could leave a large backlog, so anything
    // more than a beat late is dropped rather than fired as a volley.
    if (keystrokeQueueRef.current.length > 0) {
      const queue = keystrokeQueueRef.current;
      let drained = 0;
      while (drained < queue.length && queue[drained].at <= sampleMs) {
        const tick = queue[drained++];
        if (sampleMs - tick.at <= LATE_KEYSTROKE_MS) {
          engine.triggerKeystroke(tick.x, tick.jitter);
        }
      }
      if (drained > 0) queue.splice(0, drained);
    }

    // Advance every live trail to its interpolated position for this instant.
    for (const trail of trailsRef.current.values()) {
      const track = tracksRef.current.get(trail.pid);
      if (!track) continue;
      const position = interpolateTrackPosition(
        track,
        sampleMs,
        trail.searchIndex,
      );
      if (!position) continue;
      trail.searchIndex = position.index;
      trail.prevX = trail.x;
      trail.prevY = trail.y;
      trail.x = position.x * width;
      trail.y = position.y * height;
      if (position.cursor) trail.cursorType = position.cursor;
      trail.points.push({ x: trail.x, y: trail.y });
      if (trail.points.length > TRAIL_LENGTH) trail.points.shift();
    }

    // Retire trails that have gone quiet, so the scene thins out the way the
    // real visualization does rather than accumulating every participant.
    for (const [pid, trail] of trailsRef.current) {
      if (sampleMs - trail.lastEventMs > TRAIL_IDLE_TIMEOUT_MS) {
        engine.retireTrail(trail.trailIndex);
        trailsRef.current.delete(pid);
      }
    }

    const frames: TrailSoundFrame[] = [];
    for (const trail of trailsRef.current.values()) {
      frames.push({
        trailIndex: trail.trailIndex,
        x: trail.x,
        y: trail.y,
        // The real previous frame position, so the engine derives a continuous
        // velocity rather than reading every frame as stationary.
        prevX: trail.prevX,
        prevY: trail.prevY,
        cursorType: trail.cursorType,
        progress: 0,
        color: trail.color,
        isNewlyActive: trail.firstSeen,
        // The sample's own participant id, so a person keeps one voice across
        // the whole replay and across loops.
        identityKey: `sample-${trail.pid}`,
      });
      trail.firstSeen = false;
    }

    engine.tick(sampleMs, frames);

    const ctx = canvas.getContext("2d");
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      if (
        canvas.width !== Math.round(width * dpr) ||
        canvas.height !== Math.round(height * dpr)
      ) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        engine.setCanvasWidth(width);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#f5f0e8";
      ctx.fillRect(0, 0, width, height);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (const trail of trailsRef.current.values()) {
        const points = trail.points;
        for (let i = 1; i < points.length; i++) {
          const t = i / points.length;
          ctx.beginPath();
          ctx.moveTo(points[i - 1].x, points[i - 1].y);
          ctx.lineTo(points[i].x, points[i].y);
          ctx.globalAlpha = t * 0.6;
          ctx.lineWidth = 1 + t * 2;
          ctx.strokeStyle = trail.color;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(trail.x, trail.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = trail.color;
        ctx.fill();
      }
    }

    // Loop from the top, with a full rewind so the next pass starts from the
    // same empty scene rather than inheriting the last one's trails.
    if (cursorRef.current >= events.length) {
      rewind();
      startedAtRef.current = performance.now();
      loopCountRef.current++;
    }

    setReadout({
      position: Math.min(sampleMs, sampleDurationMs),
      active: trailsRef.current.size,
      loops: loopCountRef.current,
    });

    rafRef.current = requestAnimationFrame(frame);
  }, [rewind, sampleDurationMs]);

  const handleStart = useCallback(async () => {
    const engine = await getEngine();
    engineRef.current = engine;
    const canvas = canvasRef.current;
    engine.setCanvasWidth(canvas?.clientWidth ?? window.innerWidth);
    if (rafRef.current !== null) return;
    rewind();
    loopCountRef.current = 0;
    startedAtRef.current = performance.now();
    setRunning(true);
    rafRef.current = requestAnimationFrame(frame);
  }, [frame, getEngine, rewind]);

  const handleStop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setRunning(false);
    rewind();
    engineRef.current?.reset();
  }, [rewind]);

  const handleLoadLive = useCallback(async () => {
    setLoadState("loading");
    try {
      const fetched = await fetchSampleEvents("", windowMs);
      if (fetched.length === 0) throw new Error("no events returned");
      adoptSample(fetched);
      setSource("live");
      setLoadState("idle");
    } catch (err) {
      console.warn("Falling back to the bundled sample:", err);
      adoptSample(bundledSample as SampleEvent[]);
      setSource("bundled");
      setLoadState("error");
    }
  }, [adoptSample, windowMs]);

  const handleUseBundled = useCallback(() => {
    adoptSample(bundledSample as SampleEvent[]);
    setSource("bundled");
    setLoadState("idle");
  }, [adoptSample]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const spanLabel = useMemo(() => {
    const seconds = summary.spanMs / 1000;
    return seconds >= 120
      ? `${(seconds / 60).toFixed(1)}min`
      : `${seconds.toFixed(0)}s`;
  }, [summary.spanMs]);

  return (
    <div style={{ marginBottom: "32px" }}>
      <div
        style={{
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "1px",
          marginBottom: "12px",
          fontFamily: "'Martian Mono', monospace",
          fontSize: "11px",
        }}
      >
        Real Event Sample
      </div>
      <div style={{ ...labelStyle, marginBottom: "12px" }}>
        Replays real browsing through the same engine the pad drives, so
        settings can be judged against genuine cursor motion at the density the
        archive page actually shows. Every toggle above applies. Ships with a
        bundled anonymized sample; loading live events pulls a fresh window and
        falls back to the bundle offline. Cursor, navigation, keyboard and
        viewport events all replay — turn percussion on to hear the last two.
      </div>

      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: "12px",
        }}
      >
        <button
          onClick={running ? handleStop : handleStart}
          style={running ? buttonActiveStyle : buttonStyle}
        >
          {running ? "stop" : "play sample"}
        </button>
        {SPEEDS.map((option) => (
          <button
            key={option}
            onClick={() => setSpeed(option)}
            style={speed === option ? buttonActiveStyle : buttonStyle}
          >
            {option}x
          </button>
        ))}
        <label style={labelStyle}>
          window{" "}
          <select
            value={windowMs}
            onChange={(event) => setWindowMs(Number(event.target.value))}
            style={selectStyle}
          >
            {WINDOW_OPTIONS.map((option) => (
              <option key={option.ms} value={option.ms}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={handleUseBundled}
          style={source === "bundled" ? buttonActiveStyle : buttonStyle}
        >
          bundled
        </button>
        <button
          onClick={handleLoadLive}
          style={source === "live" ? buttonActiveStyle : buttonStyle}
        >
          {loadState === "loading" ? "loading…" : "load live"}
        </button>
      </div>

      <div
        style={{
          border: "1px solid #e0dbd4",
          background: "#faf7f2",
          padding: "10px",
          marginBottom: "12px",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: "8px",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button
            onClick={() =>
              setPercussion((current) => ({
                ...current,
                enabled: !current.enabled,
              }))
            }
            style={percussion.enabled ? buttonActiveStyle : buttonStyle}
          >
            percussion
          </button>
          <span style={labelStyle}>
            drives the unpitched candidates from this sample's real events.
            Pad-only — no live page plays them.
          </span>
        </div>

        {percussion.enabled ? (
          <div style={{ marginTop: "10px" }}>
            <div
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: "8px",
              }}
            >
              <span style={labelStyle}>click</span>
              {CLICK_VARIANTS.map(({ variant, label }) => (
                <button
                  key={variant}
                  onClick={() =>
                    setPercussion((current) => ({ ...current, click: variant }))
                  }
                  style={
                    percussion.click === variant
                      ? buttonActiveStyle
                      : buttonStyle
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            <div
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <button
                onClick={() =>
                  setPercussion((current) => ({
                    ...current,
                    typing: !current.typing,
                  }))
                }
                style={percussion.typing ? buttonActiveStyle : buttonStyle}
              >
                typing ticks
              </button>
              <button
                onClick={() =>
                  setPercussion((current) => ({
                    ...current,
                    scroll: !current.scroll,
                  }))
                }
                style={percussion.scroll ? buttonActiveStyle : buttonStyle}
              >
                scroll brush
              </button>
              <button
                onClick={() =>
                  setPercussion((current) => ({
                    ...current,
                    hold: !current.hold,
                  }))
                }
                style={percussion.hold ? buttonActiveStyle : buttonStyle}
              >
                hold roll
              </button>
              <span style={labelStyle}>
                ticks follow each recorded typing sequence's own cadence; the
                roll replaces the stretched bell on a held click
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: `${PAD_HEIGHT}px`,
          border: "1px solid #e0dbd4",
          background: "#f5f0e8",
          display: "block",
        }}
      />

      <div style={{ ...labelStyle, marginTop: "8px" }}>
        {source === "bundled" ? "bundled sample" : "live sample"} |{" "}
        {summary.events} events | {summary.participants} participants |{" "}
        {summary.moves} moves | {summary.clicks} clicks |{" "}
        {summary.navigations} navigations | {summary.keypresses} keypresses |{" "}
        {summary.scrolls} scrolls | {summary.domains} domains | {spanLabel} span
        {loadState === "error"
          ? " | live fetch failed, using the bundled sample"
          : ""}
      </div>
      <div style={{ ...labelStyle, marginTop: "4px" }}>
        position {(readout.position / 1000).toFixed(1)}s | {readout.active}{" "}
        trails live | {readout.loops} loops
      </div>
    </div>
  );
};
