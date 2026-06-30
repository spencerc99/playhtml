// ABOUTME: Animated typing visualization component with character-by-character replay
// ABOUTME: Handles typing animation, sequence replay, and blinking caret
import React, { useState, useEffect, useRef, memo, useMemo } from "react";
import { TypingState, TypingAction, ActiveTyping } from "../types";
import { useDebugHover } from "./DebugHover";
import { redactWithLegibility } from "@extension/utils/keyboardRedaction";
import { RISO_COLORS } from "../utils/eventUtils";
import {
  isMonochromeStyle,
  colorWash,
  colorShade,
  readableTextLightness,
} from "../utils/colorStyle";

interface TypingSettings {
  animationSpeed: number;
  textboxOpacity: number;
  keyboardShowCaret: boolean;
  keyboardAnimationSpeed: number;
  keyboardLegibilityPct: number;
  /** Hard cap on actively-typing sessions on screen at the same time. When a
   * new session would push the active set past this number, it's deferred
   * until an existing one finishes. Completed sessions still linger via the
   * COMPLETED_TYPING_VISIBLE_COUNT tail. */
  maxConcurrentTyping: number;
  /** Cursor renderer style — "monochrome" → ink text on paper; otherwise the
   * letters take the participant's vibrant color (matching their cursor). */
  trailVisualStyle?: string;
  randomizeColors?: boolean;
}

interface AnimatedTypingProps {
  typingStates: TypingState[];
  timeRange: { min: number; max: number; duration: number };
  settings: TypingSettings;
}

export const COMPLETED_TYPING_VISIBLE_COUNT = 50;
const HIDDEN_TAB_TICK_MS = 100;

interface TypingTrackAction extends TypingAction {
  endTimestamp: number;
  timings: number[];
}

export interface TypingTrack {
  id: string;
  index: number;
  state: TypingState;
  startOffsetMs: number;
  finishedAtMs: number;
  actions: TypingTrackAction[];
  finalText: string;
}

export interface TypingPlaybackSchedule {
  tracks: TypingTrack[];
  startOrder: TypingTrack[];
  finishOrder: TypingTrack[];
}

// Seeded random for consistent variations
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 43758.5453;
  return x - Math.floor(x);
}

// Stable hash of a typing id, for picking a consistent RISO color per box.
function hashTypingId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return h;
}

// Calculate character reveal time with natural variations
// Returns cumulative time offsets for each character
function calculateCharacterTimings(
  textLength: number,
  baseDuration: number,
  seed: number,
): number[] {
  // Handle edge cases
  if (textLength <= 0) return [];
  if (baseDuration <= 0) return new Array(textLength).fill(0);

  const timings: number[] = [];
  let cumulativeTime = 0;

  for (let i = 0; i < textLength; i++) {
    // Random speed variation: some chars fast (0.5x), some slow (1.5x)
    const variation = 0.5 + seededRandom(seed + i) * 1.0; // 0.5 to 1.5
    const charTime = (baseDuration / textLength) * variation;
    cumulativeTime += charTime;
    timings.push(cumulativeTime);
  }

  // Normalize so the last character appears at baseDuration
  const totalTime = timings[timings.length - 1] || 1;
  return timings.map((t) => (t / totalTime) * baseDuration);
}

function findVisibleCharacterCount(timings: number[], elapsedMs: number) {
  if (timings.length === 0) return 0;

  let low = 0;
  let high = timings.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (elapsedMs >= timings[mid]) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return Math.max(1, low);
}

function replayPreparedActions(
  actions: TypingTrackAction[],
  elapsedMs: number,
): string {
  if (actions.length === 0) {
    return "";
  }

  let text = "";

  for (const action of actions) {
    const actionStartTime = action.timestamp;
    const actionEndTime = action.endTimestamp;

    if (elapsedMs < actionStartTime) {
      break; // Haven't reached this action yet
    }

    if (action.action === "type" && action.text) {
      const textLength = action.text.length;
      const timeInAction = elapsedMs - actionStartTime;

      if (elapsedMs >= actionEndTime || textLength === 0) {
        // Action complete, show all text
        text += action.text;
      } else if (timeInAction >= 0) {
        // Always show at least 1 character if we're past the action start time
        const charsToShow = findVisibleCharacterCount(
          action.timings,
          timeInAction,
        );
        text += action.text.slice(0, charsToShow);
      }
    } else if (action.action === "backspace" && action.deletedCount) {
      const timeInAction = elapsedMs - actionStartTime;
      const deleteCount = action.deletedCount || 0;

      if (elapsedMs >= actionEndTime) {
        // Backspace complete, remove all characters
        const charsToDelete = Math.min(deleteCount, text.length);
        text = text.slice(0, -charsToDelete);
      } else if (timeInAction >= 0) {
        // Start with at least 1 character deletion if we're past the action start
        const charsDeleted = findVisibleCharacterCount(
          action.timings,
          timeInAction,
        );
        const charsToDelete = Math.min(charsDeleted, text.length);
        text = text.slice(0, -charsToDelete);
      }
    }
  }

  return text;
}

export function getTypingTextAtTime(
  track: TypingTrack,
  elapsedMs: number,
  keyboardAnimationSpeed: number,
): string {
  return replayPreparedActions(track.actions, elapsedMs * keyboardAnimationSpeed);
}

function upperBoundFinishedTracks(
  finishOrder: TypingTrack[],
  elapsedTimeMs: number,
) {
  let low = 0;
  let high = finishOrder.length;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (finishOrder[mid].finishedAtMs <= elapsedTimeMs) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

export function getRecentCompletedTypingTracks(
  schedule: TypingPlaybackSchedule,
  elapsedTimeMs: number,
  count = COMPLETED_TYPING_VISIBLE_COUNT,
): TypingTrack[] {
  const finishedEnd = upperBoundFinishedTracks(
    schedule.finishOrder,
    elapsedTimeMs,
  );
  const finishedStart = Math.max(0, finishedEnd - count);
  return schedule.finishOrder.slice(finishedStart, finishedEnd);
}

export function buildTypingPlaybackSchedule(
  typingStates: TypingState[],
  keyboardAnimationSpeed = 1,
): TypingPlaybackSchedule {
  const safeKeyboardAnimationSpeed = Math.max(0.001, keyboardAnimationSpeed);

  const tracks = typingStates.map((state, index) => {
    const seed = state.animation.x + state.animation.y;
    let actionSeed = seed;

    const actions = state.animation.sequence.map((action, actionIndex) => {
      const nextAction = state.animation.sequence[actionIndex + 1];
      const endTimestamp = nextAction
        ? nextAction.timestamp
        : action.timestamp + 2000;
      const characterCount =
        action.action === "type"
          ? action.text?.length ?? 0
          : action.deletedCount ?? 0;
      const timings = calculateCharacterTimings(
        characterCount,
        endTimestamp - action.timestamp,
        actionSeed,
      );

      actionSeed += characterCount;

      return {
        ...action,
        endTimestamp,
        timings,
      };
    });

    const track: TypingTrack = {
      id: `typing-state-${index}`,
      index,
      state,
      startOffsetMs: state.startOffsetMs,
      finishedAtMs:
        state.startOffsetMs + state.durationMs / safeKeyboardAnimationSpeed,
      actions,
      finalText: replayPreparedActions(actions, state.durationMs),
    };

    return track;
  });

  return {
    tracks,
    startOrder: [...tracks].sort((a, b) => a.startOffsetMs - b.startOffsetMs),
    finishOrder: [...tracks].sort((a, b) => a.finishedAtMs - b.finishedAtMs),
  };
}

function activeTypingsAreEqual(a: ActiveTyping[], b: ActiveTyping[]) {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (
      a[i].id !== b[i].id ||
      a[i].currentText !== b[i].currentText ||
      a[i].showCaret !== b[i].showCaret
    ) {
      return false;
    }
  }

  return true;
}

// TypingBox Component - renders individual typing instance with classic input styling
const TypingBox = memo(
  ({
    typing,
    settings,
    track,
  }: {
    typing: ActiveTyping;
    settings: TypingSettings;
    track?: TypingTrack;
  }) => {
    const debug = useDebugHover();
    const showDebug = () => {
      if (!debug.enabled || !track) return;
      const ev = track.state.animation.event;
      const url = ev?.meta?.url ?? "";
      const pid = ev?.meta?.pid ?? "";
      const ts = ev?.ts;
      debug.show({
        kind: "Typing event",
        id: typing.id,
        color: typing.color,
        title: url || track.state.animation.event?.domain || "Typing input",
        fields: [
          { label: "chars", value: String(track.finalText.length) },
          { label: "actions", value: String(track.actions.length) },
          {
            label: "duration",
            value: `${Math.round(track.state.durationMs)} ms`,
          },
          {
            label: "start",
            value: ts ? new Date(ts).toLocaleString() : "—",
          },
          { label: "pid", value: pid ? `${pid.slice(0, 7)}…${pid.slice(-4)}` : "—" },
          {
            label: "pos",
            value: `${Math.round(track.state.animation.x)}, ${Math.round(track.state.animation.y)}`,
          },
        ],
      });
    };
    const hideDebug = () => {
      if (!debug.enabled) return;
      debug.hide(typing.id);
    };

    const {
      x,
      y,
      currentText,
      showCaret,
      textboxSize,
      fontSize,
      positionOffset,
      style,
      color,
    } = typing;

    const mono = isMonochromeStyle(settings.trailVisualStyle);
    // In color mode, the letters take the participant's vibrant hue (the same
    // color as their cursor) and the box gets a faint wash of it. randomizeColors
    // swaps in a RISO color, keyed stably off the typing id so it doesn't flicker.
    const vizColor = settings.randomizeColors
      ? RISO_COLORS[
          Math.abs(hashTypingId(typing.id)) % RISO_COLORS.length
        ]
      : color;

    // Map border style code to CSS border style
    const getBorderStyle = (code: number | undefined): string => {
      if (code === undefined) return "solid";
      switch (code) {
        case 1:
          return "solid";
        case 2:
          return "dashed";
        case 3:
          return "dotted";
        case 4:
          return "double";
        default:
          return "solid"; // 0 or other
      }
    };

    // Use captured styling if available, otherwise defaults
    const borderRadius = style?.br !== undefined ? `${style.br}px` : "3px";
    const borderStyle = getBorderStyle(style?.bs);

    // Background + text color. Monochrome keeps the classic light-input look;
    // color mode washes the box faintly in the participant hue and colors the
    // letters that same hue (darkened to stay legible on the wash).
    let backgroundColor: string;
    let textColor: string;
    let borderColor: string;

    if (mono) {
      if (style?.bg !== undefined) {
        // Apply minimum luminosity of 0.85 to ensure visibility (even dark inputs stay light enough to see)
        const luminosity = Math.max(0.85, style.bg);
        const colorValue = Math.round(luminosity * 255);
        backgroundColor = `rgb(${colorValue}, ${colorValue}, ${colorValue})`;
      } else {
        backgroundColor = "#fefefe";
      }
      textColor = "#222";
      borderColor = "#999";
    } else {
      // Faint wash of the hue, lightened so dark cursor colors still read as a
      // light input rather than a saturated panel. Letters + border take a
      // readable shade of the same hue.
      backgroundColor = colorWash(vizColor, 0.16, 30);
      textColor = colorShade(vizColor, readableTextLightness(vizColor));
      borderColor = colorWash(vizColor, 0.55, 0);
    }

    return (
      <div
        onMouseEnter={debug.enabled ? showDebug : undefined}
        onMouseMove={debug.enabled ? showDebug : undefined}
        onMouseLeave={debug.enabled ? hideDebug : undefined}
        style={{
          position: "absolute",
          left: `${x + positionOffset.x}px`,
          top: `${y + positionOffset.y}px`,
          transform: "translate(-50%, -50%)",
          pointerEvents: debug.enabled ? "auto" : "none",
          cursor: debug.enabled ? "help" : "default",
        }}
      >
        {/* Classic web input box with captured or default styling */}
        <div
          style={{
            position: "relative",
            width: `${textboxSize.width}px`,
            minHeight: `${textboxSize.height}px`,
            maxHeight: "500px", // Cap to prevent extremely tall boxes
            border: `2px ${borderStyle} ${borderColor}`,
            borderRadius,
            backgroundColor,
            padding: "8px 10px",
            fontFamily: "monospace",
            fontSize: `${fontSize}px`,
            color: textColor,
            lineHeight: "1.5",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            overflow: "auto", // Allow scrolling if content exceeds maxHeight
            // Classic inset shadow for input fields
            boxShadow:
              "inset 1px 1px 3px rgba(0, 0, 0, 0.15), 0 1px 0 rgba(255, 255, 255, 0.8)",
            opacity: settings.textboxOpacity + 0.5, // Make more visible
          }}
        >
          {/* Text content */}
          <span style={{ position: "relative", zIndex: 1 }}>
            {redactWithLegibility(currentText, settings.keyboardLegibilityPct, 0)}
            {settings.keyboardShowCaret && showCaret && (
              <span
                style={{
                  display: "inline-block",
                  width: "2px",
                  height: `${fontSize * 1.2}px`,
                  backgroundColor: textColor,
                  marginLeft: "2px",
                  verticalAlign: "text-bottom",
                  animation: "blink 1.06s step-end infinite",
                }}
              />
            )}
          </span>
        </div>
      </div>
    );
  },
  (prev, next) => {
    return (
      prev.typing.currentText === next.typing.currentText &&
      prev.typing.showCaret === next.typing.showCaret &&
      prev.typing.color === next.typing.color &&
      prev.settings.textboxOpacity === next.settings.textboxOpacity &&
      prev.settings.keyboardShowCaret === next.settings.keyboardShowCaret &&
      prev.settings.keyboardLegibilityPct ===
        next.settings.keyboardLegibilityPct &&
      prev.settings.trailVisualStyle === next.settings.trailVisualStyle &&
      prev.settings.randomizeColors === next.settings.randomizeColors
    );
  },
);

export const AnimatedTyping: React.FC<AnimatedTypingProps> = memo(
  ({ typingStates, timeRange, settings }) => {
    const [activeTypings, setActiveTypings] = useState<ActiveTyping[]>([]);
    const animationRef = useRef<number | undefined>(undefined);
    const timeoutRef = useRef<number | undefined>(undefined);
    const prevElapsedRef = useRef(0);
    const nextStartOrderIndexRef = useRef(0);
    const activeTrackIndicesRef = useRef<number[]>([]);
    // When a track is admitted after sitting in the deferred queue (waiting
    // for the concurrency cap to free up), we shift its replay clock so
    // playback starts from "now" rather than racing to catch up to the
    // originally-scheduled start. Without this, a track held for 8s would
    // render 8s of typing in one frame, looking like a sudden race-through.
    //
    // Stores the time shift (delta) to add to a track's scheduled start
    // and finish times. On-time admissions store 0 (or are absent).
    const trackTimeShiftRef = useRef<Map<number, number>>(new Map());
    // FIFO of tracks that were admitted and then naturally evicted (i.e.
    // they actually typed on screen and finished). Replaces the static
    // `getRecentCompletedTypingTracks(schedule, loopedElapsed)` query
    // because that query is keyed on `finishedAtMs ≤ loopedElapsed`, which
    // includes tracks that were SKIPPED at admission time (cap was full
    // when their turn came AND their finishedAtMs passed before a slot
    // freed). Those skipped tracks would appear in the tail with their
    // finalText rendered — looking like "filled boxes appearing from
    // nowhere as others fade." Only tracks that actually played get to
    // join the tail.
    const recentlyCompletedRef = useRef<number[]>([]);

    // Settings as refs (same pattern as AnimatedTrails)
    const settingsRef = useRef(settings);

    useEffect(() => {
      settingsRef.current = settings;
    }, [settings]);

    const schedule = useMemo(
      () =>
        buildTypingPlaybackSchedule(
          typingStates,
          settings.keyboardAnimationSpeed,
        ),
      [typingStates, settings.keyboardAnimationSpeed],
    );

    useEffect(() => {
      nextStartOrderIndexRef.current = 0;
      activeTrackIndicesRef.current = [];
      trackTimeShiftRef.current.clear();
      recentlyCompletedRef.current = [];
      prevElapsedRef.current = 0;
    }, [schedule]);

    useEffect(() => {
      if (typingStates.length === 0 || timeRange.duration === 0) {
        setActiveTypings([]); // Clear active typings when no states
        return;
      }

      let startTime: number | null = null;

      // On cycle wrap, clear everything so the next cycle starts from a
      // clean slate. The hold phase (see HOLD_MS below) precedes the wrap,
      // so viewers see the full final composition for a beat before the
      // reset rather than a mid-flow disruption.
      const resetPlaybackTrackers = () => {
        nextStartOrderIndexRef.current = 0;
        activeTrackIndicesRef.current = [];
        trackTimeShiftRef.current.clear();
        recentlyCompletedRef.current = [];
      };

      const clearScheduledFrame = () => {
        if (animationRef.current !== undefined) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = undefined;
        }
        if (timeoutRef.current !== undefined) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = undefined;
        }
      };

      const scheduleNextFrame = () => {
        clearScheduledFrame();
        if (document.visibilityState === "hidden") {
          timeoutRef.current = window.setTimeout(
            () => animate(performance.now()),
            HIDDEN_TAB_TICK_MS,
          );
          return;
        }
        animationRef.current = requestAnimationFrame(animate);
      };

      const animate = (timestamp: number) => {
        if (startTime === null) startTime = timestamp;

        const realElapsed = timestamp - startTime;
        const scaledElapsed = realElapsed * settingsRef.current.animationSpeed;
        const loopedElapsed = scaledElapsed % timeRange.duration;

        if (loopedElapsed < prevElapsedRef.current) {
          resetPlaybackTrackers();
        }
        prevElapsedRef.current = loopedElapsed;

        // Evict tracks whose (shifted) finish time has passed. Compact in
        // place rather than allocating a new array per frame. Evicted
        // tracks join the recently-completed FIFO (capped at
        // COMPLETED_TYPING_VISIBLE_COUNT) so they linger as static text
        // on screen.
        const visibleTrackIndexes = new Set<number>();
        const activeTrackIndices = activeTrackIndicesRef.current;
        const timeShifts = trackTimeShiftRef.current;
        const recentlyCompleted = recentlyCompletedRef.current;
        let activeWriteIndex = 0;

        for (let i = 0; i < activeTrackIndices.length; i++) {
          const trackIndex = activeTrackIndices[i];
          const track = schedule.tracks[trackIndex];
          const shift = timeShifts.get(trackIndex) ?? 0;
          const effectiveFinish = track.finishedAtMs + shift;
          if (effectiveFinish > loopedElapsed) {
            activeTrackIndices[activeWriteIndex] = trackIndex;
            activeWriteIndex++;
            visibleTrackIndexes.add(trackIndex);
          } else {
            // Track finished — drop the shift entry so the map doesn't
            // grow unbounded across cycle wraps. Push it to the FIFO so
            // the tail shows it. De-dup defensively (a long session
            // shouldn't double-enter).
            timeShifts.delete(trackIndex);
            const existing = recentlyCompleted.indexOf(trackIndex);
            if (existing !== -1) recentlyCompleted.splice(existing, 1);
            recentlyCompleted.push(trackIndex);
            if (recentlyCompleted.length > COMPLETED_TYPING_VISIBLE_COUNT) {
              recentlyCompleted.shift();
            }
          }
        }
        activeTrackIndices.length = activeWriteIndex;

        // Second: admit new tracks whose start time has arrived, up to the
        // concurrency cap. Two distinct exit paths:
        //   - Track's lifetime already ended (cap was full when its turn
        //     came): skip it and advance the cursor. It'll still show up in
        //     the completed-tail buffer if it finished recently.
        //   - Cap is full AND the candidate would still be active: stop
        //     advancing so we re-evaluate next frame after eviction.
        //
        // When a track admits late (deferred because the cap was full), we
        // record the time shift so its replay clock starts from "now"
        // rather than racing through pent-up elapsed time. The shift also
        // extends its effective finish time so the full session still
        // gets to play out.
        const cap = Math.max(1, settingsRef.current.maxConcurrentTyping);
        // Hard cap on how late a track can admit. Without this, when the
        // concurrency cap stays saturated for a long time (typical with
        // many sessions and tight spacing), the deferred backlog drains
        // out one-by-one with ever-larger shifts — effectively pushing
        // admissions deep into the hold phase and making the hold not
        // feel like a hold. 8 seconds is generous enough that brief
        // cap-saturation bursts still re-admit, but tracks deferred by
        // tens of seconds get skipped so the cycle can actually end.
        const MAX_ADMISSION_LATENESS_MS = 8000;
        while (
          nextStartOrderIndexRef.current < schedule.startOrder.length &&
          schedule.startOrder[nextStartOrderIndexRef.current].startOffsetMs <=
            loopedElapsed
        ) {
          const track = schedule.startOrder[nextStartOrderIndexRef.current];
          if (track.finishedAtMs <= loopedElapsed) {
            // Missed its window entirely. Skip and move on.
            nextStartOrderIndexRef.current++;
            continue;
          }
          const candidateShift = loopedElapsed - track.startOffsetMs;
          if (candidateShift > MAX_ADMISSION_LATENESS_MS) {
            // Track deferred too long — let it fall off the schedule
            // entirely rather than admitting it well past its scheduled
            // window. This is what keeps the hold phase actually quiet.
            nextStartOrderIndexRef.current++;
            continue;
          }
          if (activeTrackIndices.length >= cap) {
            // Cap full and this track is still live — hold for next frame.
            break;
          }
          // Only store a shift when the admission is meaningfully late —
          // sub-frame deltas don't need bookkeeping.
          if (candidateShift > 1) {
            timeShifts.set(track.index, candidateShift);
          }
          activeTrackIndices.push(track.index);
          visibleTrackIndexes.add(track.index);
          nextStartOrderIndexRef.current++;
        }

        // Pull recently-completed tracks (from the FIFO populated during
        // eviction above) into the visible set. Critical: this is NOT a
        // static finishedAtMs ≤ loopedElapsed query — that would include
        // sessions that got SKIPPED by the admission loop (cap was full
        // when their turn came AND their finishedAtMs passed before a
        // slot freed), making them appear as fully-typed boxes that never
        // actually rendered any typing. Only tracks that genuinely played
        // and finished enter the FIFO.
        for (const trackIndex of recentlyCompleted) {
          visibleTrackIndexes.add(trackIndex);
        }

        const visibleTracks = Array.from(visibleTrackIndexes)
          .sort((a, b) => a - b)
          .map((index) => schedule.tracks[index]);

        const newActiveTypings = visibleTracks.map((track) => {
          const state = track.state;
          // Use the shifted start time so a deferred-then-admitted track
          // plays out smoothly from admission rather than racing through
          // pent-up elapsed time.
          const shift = timeShifts.get(track.index) ?? 0;
          const typingElapsed = loopedElapsed - track.startOffsetMs - shift;
          const isTyping = typingElapsed <=
            state.durationMs / settingsRef.current.keyboardAnimationSpeed;
          const timeToReplay = isTyping
            ? typingElapsed
            : state.durationMs / settingsRef.current.keyboardAnimationSpeed;
          const currentText = isTyping
            ? getTypingTextAtTime(
                track,
                timeToReplay,
                settingsRef.current.keyboardAnimationSpeed,
              )
            : track.finalText;

          return {
            id: track.id,
            x: state.animation.x,
            y: state.animation.y,
            color: state.animation.color,
            currentText,
            showCaret: isTyping && Math.floor(typingElapsed / 530) % 2 === 0,
            textboxSize: state.textboxSize,
            fontSize: state.fontSize,
            positionOffset: state.positionOffset,
            style: state.style,
          };
        });

        setActiveTypings((prev) =>
          activeTypingsAreEqual(prev, newActiveTypings)
            ? prev
            : newActiveTypings,
        );

        scheduleNextFrame();
      };

      scheduleNextFrame();

      return clearScheduledFrame;
    }, [schedule, timeRange.duration, typingStates.length]);

    const tracksById = useMemo(() => {
      const m = new Map<string, TypingTrack>();
      for (const t of schedule.tracks) m.set(t.id, t);
      return m;
    }, [schedule]);

    return (
      // pointer-events stays "none" on the wrapper; individual TypingBox
      // wrappers opt in to pointer events when debug mode is on. Keeps
      // the canvas non-interactive in normal use.
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {activeTypings.map((typing) => (
          <TypingBox
            key={typing.id}
            typing={typing}
            settings={settingsRef.current}
            track={tracksById.get(typing.id)}
          />
        ))}
      </div>
    );
  },
);
