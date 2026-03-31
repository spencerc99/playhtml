// ABOUTME: Grid visualization of internet keyboard events
// ABOUTME: Scroll-driven reveal: the page slowly auto-scrolls and sessions activate
// ABOUTME: as they enter the viewport, typing at natural speed with backspace replay.
// ABOUTME: Visual variety comes from typography (font, weight, shade) not color.

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { CollectionEvent, KeyboardEventData, TypingAction } from "../types";
import { extractDomain } from "../utils/eventUtils";

// ── Constants ─────────────────────────────────────────────────────────────────
const CELL_SIZE = 32;
/** Base scroll rate in px per real second at speed=1. */
const SCROLL_SPEED_PX_S = 22;
const SPEED_STORAGE_KEY = "keypresses-animation-speed";
const RANDOMIZE_STORAGE_KEY = "keypresses-randomize-order";
const DEFAULT_SPEED = 1.0;
const MERGE_THRESHOLD_MS = 35000;
const MAX_SESSIONS = 150;
/** Empty cells inserted between sessions for visual breathing room. */
const SESSION_GAP = 3;
/**
 * Virtual-time delay (ms) added to a session's entry time based on how far
 * down the viewport it is when it activates.  A session entering at the very
 * bottom gets the full delay; one at the top gets 0.  This ensures you see
 * sequences start typing as they scroll into view rather than arriving already
 * complete.  Scales proportionally with animation speed.
 */
const TYPING_INIT_DELAY_MS = 5000;
/**
 * Hard cap on cells allocated per session.
 * Prevents very long sequences from leaving huge empty stretches in the grid.
 * At 60 cols this is ~2 rows per session — enough for a sentence.
 */
const MAX_SESSION_CELLS = 130;
/**
 * Extra cells beyond finalText.length reserved for in-progress backspace
 * animations (text grows before deletion brings it back down).
 */
const BACKSPACE_BUFFER = 12;

const checkDevMode = () =>
  new URLSearchParams(window.location.search).has("dev");

// ── Typography variants ───────────────────────────────────────────────────────
// Subtle differentiation via font family / weight / near-black shade only.
interface SessionStyle {
  fontFamily: string;
  fontWeight: number;
  fontSize: string;
  color: string;
}

const SESSION_STYLES: SessionStyle[] = [
  // Monospace — full range from near-black to very light
  { fontFamily: '"Courier Prime","Courier New",monospace', fontWeight: 700, fontSize: "22px", color: "#111" },
  { fontFamily: '"Courier Prime","Courier New",monospace', fontWeight: 400, fontSize: "22px", color: "#333" },
  { fontFamily: '"Courier Prime","Courier New",monospace', fontWeight: 400, fontSize: "22px", color: "#666" },
  { fontFamily: '"Courier Prime","Courier New",monospace', fontWeight: 700, fontSize: "22px", color: "#888" },
  { fontFamily: '"Courier Prime","Courier New",monospace', fontWeight: 400, fontSize: "22px", color: "#aaa" },
  { fontFamily: '"Courier Prime","Courier New",monospace', fontWeight: 700, fontSize: "22px", color: "#c8c8c8" },
  // Serif — mid and light
  { fontFamily: 'Georgia,"Times New Roman",serif', fontWeight: 700, fontSize: "19px", color: "#1a1a1a" },
  { fontFamily: 'Georgia,"Times New Roman",serif', fontWeight: 400, fontSize: "19px", color: "#4a4a4a" },
  { fontFamily: 'Georgia,"Times New Roman",serif', fontWeight: 700, fontSize: "19px", color: "#777" },
  { fontFamily: 'Georgia,"Times New Roman",serif', fontWeight: 400, fontSize: "19px", color: "#999" },
  { fontFamily: 'Georgia,"Times New Roman",serif', fontWeight: 700, fontSize: "19px", color: "#bbb" },
  { fontFamily: 'Georgia,"Times New Roman",serif', fontWeight: 400, fontSize: "19px", color: "#d0d0d0" },
  // Sans-serif — dark, mid, light
  { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontWeight: 700, fontSize: "20px", color: "#222" },
  { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontWeight: 300, fontSize: "20px", color: "#555" },
  { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontWeight: 600, fontSize: "20px", color: "#888" },
  { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontWeight: 300, fontSize: "20px", color: "#aaa" },
  { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontWeight: 600, fontSize: "20px", color: "#c0c0c0" },
  { fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', fontWeight: 300, fontSize: "20px", color: "#ddd" },
];

// ── Seeded random ─────────────────────────────────────────────────────────────
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

// ── Per-character timing with natural variation (mirrors AnimatedTyping) ──────
function calculateCharacterTimings(
  textLength: number,
  baseDuration: number,
  seed: number,
): number[] {
  if (textLength <= 0) return [];
  if (baseDuration <= 0) return new Array(textLength).fill(0);
  const timings: number[] = [];
  let cumulative = 0;
  for (let i = 0; i < textLength; i++) {
    cumulative += (baseDuration / textLength) * (0.5 + seededRandom(seed + i));
    timings.push(cumulative);
  }
  const scale = baseDuration / (timings[timings.length - 1] || 1);
  return timings.map((t) => t * scale);
}

/**
 * Exact port of AnimatedTyping's replaySequence.
 * Replays a TypingAction[] as of `elapsedMs` into the session, returning the
 * currently visible text including in-progress backspaces with natural rhythm.
 */
function replaySequence(
  sequence: TypingAction[],
  elapsedMs: number,
  seed: number = 0,
): string {
  if (!sequence || sequence.length === 0) return "";
  let text = "";
  let actionSeed = seed;
  for (let i = 0; i < sequence.length; i++) {
    const action = sequence[i];
    const next = sequence[i + 1];
    const actionStart = action.timestamp;
    const actionEnd = next ? next.timestamp : actionStart + 2000;
    if (elapsedMs < actionStart) break;

    if (action.action === "type" && action.text) {
      const len = action.text.length;
      const timeIn = elapsedMs - actionStart;
      if (elapsedMs >= actionEnd || len === 0) {
        text += action.text;
      } else {
        const timings = calculateCharacterTimings(len, actionEnd - actionStart, actionSeed);
        let show = 1;
        for (let j = 0; j < timings.length; j++) {
          if (timeIn >= timings[j]) show = j + 1;
          else break;
        }
        text += action.text.slice(0, show);
      }
      actionSeed += len;
    } else if (action.action === "backspace" && action.deletedCount) {
      const count = action.deletedCount;
      const timeIn = elapsedMs - actionStart;
      if (elapsedMs >= actionEnd) {
        text = text.slice(0, -Math.min(count, text.length));
      } else {
        const timings = calculateCharacterTimings(count, actionEnd - actionStart, actionSeed);
        let deleted = 1;
        for (let j = 0; j < timings.length; j++) {
          if (timeIn >= timings[j]) deleted = j + 1;
          else break;
        }
        text = text.slice(0, -Math.min(deleted, text.length));
      }
      actionSeed += count;
    }
  }
  return text;
}

/** Maximum text length reached at any point — needed to pre-allocate grid cells. */
function computeMaxLength(sequence: TypingAction[]): number {
  let text = "";
  let maxLen = 0;
  for (const a of sequence) {
    if (a.action === "type" && a.text) {
      text += a.text;
      maxLen = Math.max(maxLen, text.length);
    } else if (a.action === "backspace" && a.deletedCount) {
      text = text.slice(0, -Math.min(a.deletedCount, text.length));
    }
  }
  return Math.max(maxLen, text.length);
}

function calculateTypingDuration(sequence: TypingAction[]): number {
  if (!sequence.length) return 2000;
  return sequence[sequence.length - 1].timestamp + 2000;
}

// ── Session model ─────────────────────────────────────────────────────────────
const DATE_FILTER_KEY = "keypresses-date-filter";
const DOMAIN_FILTER_KEY = "keypresses-domain-filter";

// Date range presets — value is the key, label is displayed
const DATE_RANGES: { value: string; label: string; daysBack: number }[] = [
  { value: "1d", label: "today", daysBack: 0 },
  { value: "3d", label: "last 3 days", daysBack: 3 },
  { value: "7d", label: "last week", daysBack: 7 },
  { value: "14d", label: "last 2 weeks", daysBack: 14 },
  { value: "30d", label: "last month", daysBack: 30 },
  { value: "90d", label: "last 3 months", daysBack: 90 },
];

function dateRangeToTs(rangeKey: string): number {
  if (!rangeKey) return 0;
  const range = DATE_RANGES.find((r) => r.value === rangeKey);
  if (!range) return 0;
  const now = new Date();
  if (range.daysBack === 0) {
    // "today" — start of today
    now.setHours(0, 0, 0, 0);
    return now.getTime();
  }
  now.setDate(now.getDate() - range.daysBack);
  now.setHours(0, 0, 0, 0);
  return now.getTime();
}

interface SessionState {
  style: SessionStyle;
  durationMs: number;
  sequence: TypingAction[];
  /** Cached result at completion — skips replaySequence when session is done typing. */
  finalText: string;
  seed: number;
  gridStartIndex: number;
  /** Max cells ever needed (text can grow then shrink via backspace). */
  maxLength: number;
  domain: string;
  dateKey: string; // YYYY-MM-DD
}

/** Fisher-Yates shuffle using Math.random — different every call. */
function fisherYates<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Build sessions from raw events ────────────────────────────────────────────
function buildSessions(
  events: CollectionEvent[],
  randomize: boolean,
  dateRangeKey: string,
  domainFilter: string,
): SessionState[] {
  const keyboardEvents = events.filter((e) => {
    if (e.type !== "keyboard") return false;
    const d = e.data as unknown as KeyboardEventData;
    if (!d.sequence || d.sequence.length === 0) return false;
    const flat = d.sequence.reduce((acc, s) => acc + (s.text || ""), "");
    return flat !== "elizabeth"; // filter test data
  });

  // Group by unique input field (pid + sid + url + CSS selector)
  const byField = new Map<string, CollectionEvent[]>();
  keyboardEvents.forEach((ev) => {
    const d = ev.data as unknown as KeyboardEventData;
    const key = `${ev.meta.pid}|${ev.meta.sid}|${ev.meta.url ?? ""}|${d.t ?? ""}`;
    if (!byField.has(key)) byField.set(key, []);
    byField.get(key)!.push(ev);
  });

  interface RawSession {
    sequence: TypingAction[];
    seed: number;
    domain: string;
    dateKey: string;
  }
  const raw: RawSession[] = [];

  byField.forEach((grp) => {
    grp.sort((a, b) => a.ts - b.ts);
    // Merge temporally close events into contiguous sequences
    const merged: CollectionEvent[][] = [];
    let cur: CollectionEvent[] = [];
    grp.forEach((ev) => {
      if (!cur.length || ev.ts - cur[cur.length - 1].ts > MERGE_THRESHOLD_MS) {
        if (cur.length) merged.push(cur);
        cur = [ev];
      } else {
        cur.push(ev);
      }
    });
    if (cur.length) merged.push(cur);

    merged.forEach((group) => {
      const first = group[0];
      const seq: TypingAction[] = [];
      let offset = 0;
      group.forEach((ev, gi) => {
        const d = ev.data as unknown as KeyboardEventData;
        if (!d.sequence) return;
        const base = gi === 0 ? 0 : offset;
        d.sequence.forEach((a) => seq.push({ ...a, timestamp: a.timestamp + base }));
        if (d.sequence.length) offset += d.sequence[d.sequence.length - 1].timestamp + 500;
      });
      if (seq.length > 0) {
        // Filter out key-repeat spam (e.g. "sssssss" from contenteditable bugs)
        const flatText = seq.reduce((acc, a) => acc + (a.action === "type" ? (a.text || "") : ""), "");
        let isSpam = false;
        if (flatText.length >= 5) {
          const charCounts = new Map<string, number>();
          for (const c of flatText) charCounts.set(c, (charCounts.get(c) ?? 0) + 1);
          const maxRatio = Math.max(...charCounts.values()) / flatText.length;
          isSpam = maxRatio > 0.7;
        }

        if (!isSpam) {
          raw.push({
            sequence: seq,
            seed: first.meta.pid.charCodeAt(0) + (first.ts % 10000),
            domain: extractDomain(first.meta?.url ?? "") || "unknown",
            dateKey: new Date(first.ts).toISOString().slice(0, 10),
          });
        }
      }
    });
  });

  if (!raw.length) return [];

  // Apply date range and domain filters
  let filtered = raw;
  const dateCutoff = dateRangeToTs(dateRangeKey);
  if (dateCutoff > 0) {
    filtered = filtered.filter((r) => new Date(r.dateKey + "T00:00:00").getTime() >= dateCutoff);
  }
  if (domainFilter) {
    filtered = filtered.filter((r) => r.domain === domainFilter);
  }
  if (!filtered.length) return [];

  // Optionally shuffle before capping — seeded so the order is stable per load
  const ordered = randomize ? fisherYates(filtered) : filtered;

  // Assign sequential grid positions and typography styles
  let nextGrid = 0;
  return ordered.slice(0, MAX_SESSIONS).map((r, i) => {
    const duration = calculateTypingDuration(r.sequence);
    const style = SESSION_STYLES[Math.floor(seededRandom(i * 7.3 + 1) * SESSION_STYLES.length)];
    const seed = r.seed;
    const finalText = replaySequence(r.sequence, duration, seed);

    // Allocate only as many cells as the final text needs, plus a small buffer
    // for in-progress backspace animations (where text temporarily grows beyond
    // its final length). Hard-cap so long sequences don't leave empty deserts.
    const peakLen = computeMaxLength(r.sequence);
    const maxLen = Math.min(peakLen, finalText.length + BACKSPACE_BUFFER, MAX_SESSION_CELLS);

    const gridStart = nextGrid;
    nextGrid += maxLen + SESSION_GAP;
    return { style, durationMs: duration, sequence: r.sequence, finalText, seed, gridStartIndex: gridStart, maxLength: maxLen, domain: r.domain, dateKey: r.dateKey };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────
/** Extract available dates and domains from raw events (before session building). */
function extractFilterOptions(events: CollectionEvent[]): { dates: string[]; domains: string[] } {
  const dateSet = new Set<string>();
  const domainSet = new Set<string>();
  for (const e of events) {
    if (e.type !== "keyboard") continue;
    dateSet.add(new Date(e.ts).toISOString().slice(0, 10));
    const domain = extractDomain(e.meta?.url ?? "");
    if (domain) domainSet.add(domain);
  }
  return {
    dates: Array.from(dateSet).sort(),
    domains: Array.from(domainSet).sort(),
  };
}

interface Props {
  events: CollectionEvent[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onFetchOlder?: () => void;
  hasMore?: boolean;
}

export const KeypressesGrid: React.FC<Props> = ({ events, loading, error, onRefresh, onFetchOlder, hasMore }) => {
  const [cols, setCols] = useState(() => Math.floor(window.innerWidth / CELL_SIZE));
  const [animationSpeed, setAnimationSpeed] = useState<number>(() => {
    const v = localStorage.getItem(SPEED_STORAGE_KEY);
    return v ? parseFloat(v) : DEFAULT_SPEED;
  });
  const [randomize, setRandomize] = useState<boolean>(() => {
    return localStorage.getItem(RANDOMIZE_STORAGE_KEY) === "true";
  });
  const [dateFilter, setDateFilter] = useState<string>(() => {
    return localStorage.getItem(DATE_FILTER_KEY) ?? "";
  });
  const [domainFilter, setDomainFilter] = useState<string>(() => {
    return localStorage.getItem(DOMAIN_FILTER_KEY) ?? "";
  });
  const [devMode] = useState(checkDevMode);

  // Refs readable in animation loop without causing restarts
  const speedRef = useRef(animationSpeed);
  const colsRef = useRef(cols);

  // Imperative grid DOM
  const gridRef = useRef<HTMLDivElement>(null);
  const cellsRef = useRef<HTMLDivElement[]>([]);
  const prevCharRef = useRef<string[]>([]);
  const prevFilledRef = useRef<boolean[]>([]);

  // Scroll-driven animation state
  const virtualTimeRef = useRef(0);     // ms, grows at speed × realTime
  const prevTsRef = useRef<number | null>(null);
  // virtualTime at which each session first entered the viewport
  const sessionEntryRef = useRef<Map<number, number>>(new Map());
  const prevScrollRef = useRef(0);      // detects loop reset

  const animRef = useRef<number>();

  const filterOptions = useMemo(() => extractFilterOptions(events), [events]);
  const sessions = useMemo(
    () => buildSessions(events, randomize, dateFilter, domainFilter),
    [events, randomize, dateFilter, domainFilter],
  );
  const totalCells = sessions.length
    ? sessions[sessions.length - 1].gridStartIndex + sessions[sessions.length - 1].maxLength
    : 0;

  // Keep refs current without restarting the animation loop
  const totalCellsRef = useRef(totalCells);
  totalCellsRef.current = totalCells;

  useEffect(() => {
    speedRef.current = animationSpeed;
    localStorage.setItem(SPEED_STORAGE_KEY, String(animationSpeed));
  }, [animationSpeed]);

  useEffect(() => {
    localStorage.setItem(RANDOMIZE_STORAGE_KEY, String(randomize));
  }, [randomize]);

  useEffect(() => {
    colsRef.current = cols;
  }, [cols]);

  // Recalculate cols on resize
  useEffect(() => {
    const handle = () => {
      const c = Math.floor(window.innerWidth / CELL_SIZE);
      setCols(c);
      colsRef.current = c;
    };
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);

  // Build the DOM grid imperatively — avoids React reconciling thousands of cells
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    grid.innerHTML = "";
    grid.style.gridTemplateColumns = `repeat(${cols}, ${CELL_SIZE}px)`;

    const newCells: HTMLDivElement[] = new Array(totalCells);
    for (let i = 0; i < totalCells; i++) {
      const div = document.createElement("div");
      div.className = "grid-cell empty";
      div.textContent = "\u00A0";
      grid.appendChild(div);
      newCells[i] = div;
    }
    cellsRef.current = newCells;
    prevCharRef.current = new Array(totalCells).fill("");
    prevFilledRef.current = new Array(totalCells).fill(false);

    // Reset all scroll-driven state so sessions re-activate cleanly
    sessionEntryRef.current.clear();
    virtualTimeRef.current = 0;
    prevTsRef.current = null;
    prevScrollRef.current = 0;
  }, [sessions, totalCells, cols]);

  // ── Main animation loop ───────────────────────────────────────────────────
  useEffect(() => {
    if (!sessions.length) return;

    const animate = (ts: number) => {
      // Advance virtual time (affected by speed multiplier)
      if (prevTsRef.current !== null) {
        virtualTimeRef.current += (ts - prevTsRef.current) * speedRef.current;
      }
      prevTsRef.current = ts;

      const viewportH = window.innerHeight;
      const totalH = Math.ceil(totalCellsRef.current / colsRef.current) * CELL_SIZE;
      // Leave 60px at the bottom so the info bar doesn't hide the last row
      const maxScroll = Math.max(0, totalH - viewportH + 60);
      const rawScrollPx = (virtualTimeRef.current * SCROLL_SPEED_PX_S) / 1000;
      const loopedScroll = maxScroll > 0 ? rawScrollPx % maxScroll : 0;

      // When the scroll position wraps back to the top, reset all session timers
      if (loopedScroll < prevScrollRef.current - CELL_SIZE * 2) {
        sessionEntryRef.current.clear();
      }
      prevScrollRef.current = loopedScroll;
      window.scrollTo(0, loopedScroll);

      const cells = cellsRef.current;
      const prevChar = prevCharRef.current;
      const prevFilled = prevFilledRef.current;
      const currentCols = colsRef.current;

      for (let si = 0; si < sessions.length; si++) {
        const session = sessions[si];
        const sessionTopRow = Math.floor(session.gridStartIndex / currentCols);
        const sessionTopPx = sessionTopRow * CELL_SIZE;

        // Activate the session when its first row enters the viewport.
        // Each session gets a seeded random delay multiplier so some arrive
        // already partially typed (low multiplier) while others only begin
        // when near the bottom of the screen (high multiplier).  The seed
        // keeps each session's multiplier stable across frames and loop resets.
        if (!sessionEntryRef.current.has(si) && sessionTopPx < loopedScroll + viewportH) {
          const distFromViewportTop = Math.max(0, sessionTopPx - loopedScroll);
          // Multiplier range: 0.1 (starts typing very early → arrives more done)
          //                   to 1.6 (only kicks off near the bottom edge)
          const delayMultiplier = 0.1 + seededRandom(session.seed * 3.7 + 13) * 1.5;
          const delay = (distFromViewportTop / viewportH) * TYPING_INIT_DELAY_MS * delayMultiplier;
          sessionEntryRef.current.set(si, virtualTimeRef.current + delay);
        }

        const entryVirtualTime = sessionEntryRef.current.get(si);

        for (let j = 0; j < session.maxLength; j++) {
          const idx = session.gridStartIndex + j;
          if (!cells[idx]) continue;

          let char = "";
          if (entryVirtualTime !== undefined) {
            // Clamp to 0: entryVirtualTime may be in the future during the delay window
            const sessionElapsedMs = Math.max(0, virtualTimeRef.current - entryVirtualTime);
            // Use cached finalText once the session has fully typed out
            const currentText =
              sessionElapsedMs >= session.durationMs
                ? session.finalText
                : replaySequence(session.sequence, sessionElapsedMs, session.seed);
            char = j < currentText.length ? currentText[j] : "";
          }

          const wasFilled = prevFilled[idx];

          if (prevChar[idx] !== char) {
            if (char) {
              cells[idx].textContent = char;
              if (!wasFilled) {
                // Apply typography style on first fill (not on every char change)
                const s = session.style;
                cells[idx].style.fontFamily = s.fontFamily;
                cells[idx].style.fontWeight = String(s.fontWeight);
                cells[idx].style.fontSize = s.fontSize;
                cells[idx].style.color = s.color;
                cells[idx].className = "grid-cell filled";
                prevFilled[idx] = true;
              }
            } else if (wasFilled) {
              cells[idx].textContent = "\u00A0";
              cells[idx].style.cssText = "";
              cells[idx].className = "grid-cell empty";
              prevFilled[idx] = false;
            }
            prevChar[idx] = char;
          }
        }
      }

      animRef.current = requestAnimationFrame(animate);
    };

    animRef.current = requestAnimationFrame(animate);
    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      prevTsRef.current = null;
    };
  }, [sessions]);

  const totalRows = Math.ceil(totalCells / cols);

  return (
    <div id="keypresses-grid">
      <div
        ref={gridRef}
        className="grid-container"
        style={{
          gridTemplateColumns: `repeat(${cols}, ${CELL_SIZE}px)`,
          height: `${totalRows * CELL_SIZE}px`,
        }}
      />

      <div className="info-bar">
        <span className="info-label">internet keypresses</span>
        {!loading && sessions.length > 0 && (
          <span className="info-count">{sessions.length.toLocaleString()} sequences</span>
        )}
        {loading && <span className="info-loading">fetching...</span>}
        {error && (
          <span className="info-error" title={error}>error</span>
        )}

        <select
          className="filter-select"
          value={dateFilter}
          onChange={(e) => {
            setDateFilter(e.target.value);
            localStorage.setItem(DATE_FILTER_KEY, e.target.value);
          }}
        >
          <option value="">all time</option>
          {DATE_RANGES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        <select
          className="filter-select"
          value={domainFilter}
          onChange={(e) => {
            setDomainFilter(e.target.value);
            localStorage.setItem(DOMAIN_FILTER_KEY, e.target.value);
          }}
        >
          <option value="">all domains</option>
          {filterOptions.domains.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        <button
          className={`toggle-btn${randomize ? " active" : ""}`}
          onClick={() => setRandomize((r) => !r)}
          title="randomize order"
        >
          shuffle
        </button>

        {devMode && (
          <label className="speed-control">
            speed
            <input
              type="range"
              min="0"
              max="10"
              step="0.1"
              value={animationSpeed}
              onChange={(e) => setAnimationSpeed(parseFloat(e.target.value))}
            />
            {animationSpeed.toFixed(1)}x
          </label>
        )}

        {hasMore && onFetchOlder && (
          <button className="toggle-btn" onClick={onFetchOlder} disabled={loading}>
            load older
          </button>
        )}

        <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
          refresh
        </button>
      </div>
    </div>
  );
};
