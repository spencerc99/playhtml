// ABOUTME: Grid visualization of internet keyboard events
// ABOUTME: Replays typed characters into grid cells using stagger animation from AnimatedTyping

import React, { useState, useEffect, useRef, useMemo, memo } from "react";
import { CollectionEvent, KeyboardEventData } from "../types";
import { getColorForParticipant } from "../utils/eventUtils";

const CELL_SIZE = 32;
const TOTAL_DURATION_MS = 40000; // 40-second loop
const ANIMATION_SPEED = 1.0;

// Filter out test sequences (same pattern as useKeyboardTyping)
const FILTER_TEST_SEQUENCES = ["elizabeth"];

interface CellData {
  char: string;
  color: string;
  revealTimeMs: number;
}

interface Session {
  color: string;
  chars: string;
  seed: number;
}

// Seeded random for consistent variations (mirrors AnimatedTyping)
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

// Calculate per-character reveal times with natural variation (mirrors AnimatedTyping)
function calculateCharacterTimings(
  textLength: number,
  baseDuration: number,
  seed: number,
): number[] {
  if (textLength <= 0) return [];
  if (baseDuration <= 0) return new Array(textLength).fill(0);

  const timings: number[] = [];
  let cumulativeTime = 0;

  for (let i = 0; i < textLength; i++) {
    // 0.5x – 1.5x speed variation per character
    const variation = 0.5 + seededRandom(seed + i) * 1.0;
    cumulativeTime += (baseDuration / textLength) * variation;
    timings.push(cumulativeTime);
  }

  // Normalize so final character lands exactly at baseDuration
  const totalTime = timings[timings.length - 1] || 1;
  return timings.map((t) => (t / totalTime) * baseDuration);
}

/**
 * Process raw keyboard events into per-cell data with staggered reveal times.
 *
 * Mirrors the session-grouping + overlap-stagger logic from useKeyboardTyping /
 * AnimatedTyping so the characters appear with the same organic rhythm.
 */
function buildCellData(
  events: CollectionEvent[],
  maxChars: number,
): CellData[] {
  const MERGE_THRESHOLD_MS = 35000;
  // High overlap: sessions start very close together (same default as AnimatedTyping)
  const OVERLAP_FACTOR = 0.9;
  const AVG_SESSION_DURATION_MS = 4000;
  const actualSpacing = AVG_SESSION_DURATION_MS * (1 - OVERLAP_FACTOR * 0.95);

  // ── 1. Filter to keyboard events that have a sequence ───────────────────────
  const keyboardEvents = events.filter((e) => {
    if (e.type !== "keyboard") return false;
    const data = e.data as unknown as KeyboardEventData;
    if (!data.sequence || data.sequence.length === 0) return false;

    // Drop known test sequences
    const fullText = data.sequence.reduce(
      (acc, s) => acc + (s.text || ""),
      "",
    );
    return !FILTER_TEST_SEQUENCES.includes(fullText);
  });

  // ── 2. Group by participant + session + URL + input selector ─────────────────
  const eventsByInputField = new Map<string, CollectionEvent[]>();
  keyboardEvents.forEach((event) => {
    const data = event.data as unknown as KeyboardEventData;
    const key = `${event.meta.pid}|${event.meta.sid}|${event.meta.url ?? ""}|${data.t ?? "unknown"}`;
    if (!eventsByInputField.has(key)) eventsByInputField.set(key, []);
    eventsByInputField.get(key)!.push(event);
  });

  // ── 3. Merge temporally-close events per input field ─────────────────────────
  const sessions: Session[] = [];

  eventsByInputField.forEach((groupEvents) => {
    groupEvents.sort((a, b) => a.ts - b.ts);

    const mergedGroups: CollectionEvent[][] = [];
    let currentGroup: CollectionEvent[] = [];

    groupEvents.forEach((event) => {
      if (currentGroup.length === 0) {
        currentGroup.push(event);
        return;
      }
      const gap = event.ts - currentGroup[currentGroup.length - 1].ts;
      if (gap <= MERGE_THRESHOLD_MS) {
        currentGroup.push(event);
      } else {
        mergedGroups.push(currentGroup);
        currentGroup = [event];
      }
    });
    if (currentGroup.length > 0) mergedGroups.push(currentGroup);

    mergedGroups.forEach((group) => {
      const firstEvent = group[0];
      const color = getColorForParticipant(firstEvent.meta.pid);

      // Replay actions to obtain the final typed text
      let text = "";
      group.forEach((event) => {
        const data = event.data as unknown as KeyboardEventData;
        data.sequence?.forEach((action) => {
          if (action.action === "type" && action.text) {
            text += action.text;
          } else if (action.action === "backspace" && action.deletedCount) {
            text = text.slice(0, -action.deletedCount);
          }
        });
      });

      // Keep only printable ASCII, collapse whitespace runs to a single space
      const printable = text
        .replace(/[^\x20-\x7E]/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (printable.length > 0) {
        sessions.push({
          color,
          chars: printable,
          seed: firstEvent.meta.pid.charCodeAt(0) + (firstEvent.ts % 10000),
        });
      }
    });
  });

  if (sessions.length === 0) return [];

  // ── 4. Assign staggered reveal times (mirrors AnimatedTyping schedule) ───────
  const allChars: CellData[] = [];

  sessions.forEach((session, sessionIndex) => {
    const startOffset = (sessionIndex * actualSpacing) % TOTAL_DURATION_MS;
    // Distribute the session's chars over a window proportional to char count
    const sessionDuration = Math.max(2000, session.chars.length * 100);

    const charTimings = calculateCharacterTimings(
      session.chars.length,
      sessionDuration,
      session.seed,
    );

    for (let i = 0; i < session.chars.length; i++) {
      allChars.push({
        char: session.chars[i],
        color: session.color,
        revealTimeMs: startOffset + charTimings[i],
      });
    }
  });

  // ── 5. Sort by reveal time, cap to grid capacity ─────────────────────────────
  allChars.sort((a, b) => a.revealTimeMs - b.revealTimeMs);
  const capped = allChars.slice(0, maxChars);
  if (capped.length === 0) return [];

  // Scale reveal times to fit within TOTAL_DURATION_MS if they exceed it
  const maxReveal = capped[capped.length - 1].revealTimeMs;
  if (maxReveal > TOTAL_DURATION_MS) {
    const scale = TOTAL_DURATION_MS / maxReveal;
    return capped.map((c) => ({
      ...c,
      revealTimeMs: c.revealTimeMs * scale,
    }));
  }

  return capped;
}

// ── Grid cell (memoized) ──────────────────────────────────────────────────────
const GridCell = memo(
  ({
    char,
    color,
    isCursor,
  }: {
    char: string;
    color: string | undefined;
    isCursor: boolean;
  }) => (
    <div
      className={`grid-cell${color ? " filled" : " empty"}${isCursor ? " cursor-cell" : ""}`}
      style={{ color: color ?? "transparent", borderColor: isCursor ? color : undefined }}
    >
      {char}
    </div>
  ),
  (prev, next) =>
    prev.char === next.char &&
    prev.color === next.color &&
    prev.isCursor === next.isCursor,
);

// ── Main component ────────────────────────────────────────────────────────────
interface KeypressesGridProps {
  events: CollectionEvent[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export const KeypressesGrid: React.FC<KeypressesGridProps> = ({
  events,
  loading,
  error,
  onRefresh,
}) => {
  const [gridDimensions, setGridDimensions] = useState({
    cols: 60,
    rows: 40,
  });
  const [elapsedTimeMs, setElapsedTimeMs] = useState(0);
  const animationRef = useRef<number>();

  // Recalculate grid dimensions when window resizes
  useEffect(() => {
    const recalculate = () => {
      setGridDimensions({
        cols: Math.floor(window.innerWidth / CELL_SIZE),
        rows: Math.floor(window.innerHeight / CELL_SIZE),
      });
    };
    recalculate();
    window.addEventListener("resize", recalculate);
    return () => window.removeEventListener("resize", recalculate);
  }, []);

  const maxChars = gridDimensions.cols * gridDimensions.rows;

  const cellData = useMemo(
    () => buildCellData(events, maxChars),
    [events, maxChars],
  );

  // Animation loop – mirrors AnimatedTyping's loop
  useEffect(() => {
    if (cellData.length === 0) return;

    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      const scaledElapsed = (timestamp - startTime) * ANIMATION_SPEED;
      setElapsedTimeMs(scaledElapsed % TOTAL_DURATION_MS);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [cellData]);

  // How many cells are visible at this moment in the loop
  const visibleCount = useMemo(() => {
    let count = 0;
    for (let i = 0; i < cellData.length; i++) {
      if (cellData[i].revealTimeMs <= elapsedTimeMs) count = i + 1;
      else break;
    }
    return count;
  }, [cellData, elapsedTimeMs]);

  const totalCells = gridDimensions.cols * gridDimensions.rows;
  // The "cursor" sits just after the last revealed character
  const cursorIndex = visibleCount;

  return (
    <div id="keypresses-grid">
      <div
        className="grid-container"
        style={{
          gridTemplateColumns: `repeat(${gridDimensions.cols}, ${CELL_SIZE}px)`,
        }}
      >
        {Array.from({ length: totalCells }, (_, index) => {
          const cell = index < visibleCount ? cellData[index] : null;
          return (
            <GridCell
              key={index}
              char={cell?.char ?? "\u00A0"}
              color={cell?.color}
              isCursor={index === cursorIndex}
            />
          );
        })}
      </div>

      <div className="info-bar">
        <span className="info-label">internet keypresses</span>
        {!loading && cellData.length > 0 && (
          <span className="info-count">{cellData.length.toLocaleString()} characters</span>
        )}
        {loading && <span className="info-loading">fetching…</span>}
        {error && (
          <span className="info-error" title={error}>
            error
          </span>
        )}
        <button className="refresh-btn" onClick={onRefresh} disabled={loading}>
          ↺
        </button>
      </div>
    </div>
  );
};
