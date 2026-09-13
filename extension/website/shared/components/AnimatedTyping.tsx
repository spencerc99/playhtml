// ABOUTME: Animated typing visualization component with character-by-character replay
// ABOUTME: Handles typing animation, sequence replay, and blinking caret
import React, { useState, useEffect, useRef, memo, useMemo } from "react";
import { TypingState, TypingAction, ActiveTyping } from "../types";
import { useDebugHover } from "./DebugHover";
import { redactWithLegibility } from "@extension/utils/keyboardRedaction";
import {
  InstallationPlaybackQueue,
  INSTALLATION_TYPING_ARRIVAL_MS,
  INSTALLATION_FADE_MS,
} from "../utils/installationPlaybackQueue";
import {
  approachDepth,
  assignSedimentDepths,
  DEFAULT_SEDIMENT_SETTINGS,
  sedimentOpacity,
  type SedimentAssignment,
  type SedimentCandidate,
} from "../utils/liveTrailSediment";
import { RISO_COLORS } from "../utils/eventUtils";
import {
  isMonochromeStyle,
  colorWash,
  colorShade,
  typingBackgroundColor,
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
  /** Installation playback: how many finished typing boxes stay on screen as
   * sediment. A finished box leaves only once this many newer boxes have
   * settled on top of it; 0 means it leaves as soon as it finishes. */
  liveTypingWindow?: number;
  /** Opacity of the deepest box still inside that window. */
  liveSedimentFloor?: number;
}

interface AnimatedTypingProps {
  typingStates: TypingState[];
  timeRange: { min: number; max: number; duration: number };
  settings: TypingSettings;
  repeatAnimations?: boolean;
}

export const COMPLETED_TYPING_VISIBLE_COUNT = 50;
const HIDDEN_TAB_TICK_MS = 100;

export function getTypingPlaybackElapsed(
  elapsedMs: number,
  durationMs: number,
  repeat: boolean,
): number {
  if (durationMs <= 0) return 0;
  return repeat ? elapsedMs % durationMs : Math.min(elapsedMs, durationMs);
}

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

    // textboxOpacity drives the box-fill alpha directly (0.5 = washed, 1 =
    // solid) rather than scaling the whole element, so turning it up makes the
    // box more OPAQUE instead of just less faint over its own baseline.
    const fillAlpha = settings.textboxOpacity;
    if (mono) {
      let colorValue = 254; // #fefefe
      if (style?.bg !== undefined) {
        // Apply minimum luminosity of 0.85 to ensure visibility (even dark inputs stay light enough to see)
        const luminosity = Math.max(0.85, style.bg);
        colorValue = Math.round(luminosity * 255);
      }
      backgroundColor = `rgba(${colorValue}, ${colorValue}, ${colorValue}, ${fillAlpha})`;
      textColor = "#222";
      borderColor = "#999";
    } else {
      // Wash of the hue, lightened so dark cursor colors still read as a light
      // input rather than a saturated panel. Letters + border take a readable
      // shade of the same hue.
      backgroundColor = typingBackgroundColor(vizColor, fillAlpha);
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
            // Box is sized to its computed height (which the hook fits to the
            // text AND caps to the max aspect ratio). maxHeight = that height so
            // content can't balloon the box into a tall narrow column — extra
            // text scrolls within it instead. Capped at 500px as a safety net.
            height: `${textboxSize.height}px`,
            maxHeight: `${Math.min(500, textboxSize.height)}px`,
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
  ({ typingStates, timeRange, settings, repeatAnimations = true }) => {
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
        const loopedElapsed = getTypingPlaybackElapsed(
          scaledElapsed,
          timeRange.duration,
          repeatAnimations,
        );

        if (repeatAnimations && loopedElapsed < prevElapsedRef.current) {
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
    }, [repeatAnimations, schedule, timeRange.duration, typingStates.length]);

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

export const DEFAULT_LIVE_TYPING_WINDOW = 40;
export const DEFAULT_LIVE_SEDIMENT_FLOOR = 0.3;
// Opacity of a box the moment it settles, before depth pushes it down toward
// the floor. Matches the cursor field's fresh sediment step-back.
const TYPING_FRESH_OPACITY = 0.85;
// Depth glides toward its target with this time constant so a box re-ranking
// as newer ones settle on top of it slides down instead of jumping.
const TYPING_DEPTH_TAU_MS = 1200;
// Saturation of the deepest box in the window: settled boxes desaturate toward
// the paper the way settled cursor ink washes out.
const TYPING_MIN_SATURATION = 0.55;

export type TypingPhase = "typing" | "settled" | "fade-out";

/** The bookkeeping the sediment scheduler needs from a visible recording.
 * `settledAt`, `departingAt` and `depth` are written by `stepTypingSediment`. */
export interface TypingSedimentState {
  id: string;
  startedAt: number;
  durationMs: number;
  /** Draw-clock time the box finished typing, or null while it types. */
  settledAt: number | null;
  /** Draw-clock time the sediment window pushed it out, or null while kept. */
  departingAt: number | null;
  /** Smoothed position in the window, 0 just settled .. 1 about to leave. */
  depth: number;
}

export interface TypingSedimentOptions {
  /** How many settled boxes stay on screen. 0 departs them immediately. */
  windowCount: number;
  /** Opacity of the deepest box still inside the window. */
  floorOpacity: number;
}

export interface TypingSedimentFrame {
  phase: TypingPhase;
  depth: number;
  opacity: number;
}

export interface TypingSedimentStep<T> {
  /** Records still on screen, in their original (start-order) order. */
  kept: T[];
  frames: Map<string, TypingSedimentFrame>;
  /** Records still typing — the only ones the admission cap applies to. */
  typingCount: number;
}

/** CSS saturation for a settled box at `depth`: full at the surface, washed
 * toward the paper at the bottom of the window. */
export function typingSedimentSaturation(depth: number): number {
  const d = Math.min(1, Math.max(0, depth));
  return 1 - (1 - TYPING_MIN_SATURATION) * d;
}

/** Advance the installation typing field by one frame.
 *
 * Finished boxes settle rather than expiring on a timer: they stay until
 * enough newer boxes have settled on top of them to push them out of a
 * count window (`assignSedimentDepths` in count mode), then fade out over
 * INSTALLATION_FADE_MS and are dropped. Mutates each record's `settledAt`,
 * `departingAt` and `depth` in place (the caller owns the array). */
export function stepTypingSediment<T extends TypingSedimentState>(
  records: readonly T[],
  now: number,
  dtMs: number,
  options: TypingSedimentOptions,
): TypingSedimentStep<T> {
  const windowCount = Math.max(0, Math.floor(options.windowCount));
  const floorOpacity = options.floorOpacity;

  const kept: T[] = [];
  for (const record of records) {
    if (
      record.settledAt === null &&
      now - record.startedAt >= record.durationMs
    ) {
      record.settledAt = now;
    }
    if (
      record.departingAt !== null &&
      now - record.departingAt >= INSTALLATION_FADE_MS
    ) {
      continue;
    }
    kept.push(record);
  }

  const candidates: SedimentCandidate[] = [];
  for (const record of kept) {
    if (record.settledAt === null || record.departingAt !== null) continue;
    // Typing boxes have no meaningful ink area, so the window is purely by
    // count and the screen area is irrelevant.
    candidates.push({ id: record.id, settledAt: record.settledAt, inkArea: 0 });
  }
  const assignments: Map<string, SedimentAssignment> =
    windowCount > 0
      ? assignSedimentDepths(
          candidates,
          {
            ...DEFAULT_SEDIMENT_SETTINGS,
            windowMode: "count",
            windowCount,
            freshOpacity: TYPING_FRESH_OPACITY,
            floorOpacity,
          },
          1,
        )
      : new Map();

  const frames = new Map<string, TypingSedimentFrame>();
  let typingCount = 0;

  for (const record of kept) {
    const isTyping = record.settledAt === null;
    if (isTyping) typingCount++;

    const assignment = assignments.get(record.id);
    if (!isTyping && record.departingAt === null) {
      // A window of 0 keeps nothing: a box leaves as soon as it settles.
      if (windowCount === 0 || assignment?.departs) {
        record.departingAt = now;
      }
    }

    const target = isTyping ? 0 : assignment?.depth ?? record.depth;
    record.depth = approachDepth(record.depth, target, dtMs, TYPING_DEPTH_TAU_MS);

    const settledOpacity = sedimentOpacity(record.depth, {
      freshOpacity: TYPING_FRESH_OPACITY,
      floorOpacity,
    });

    let phase: TypingPhase;
    let opacity: number;
    if (record.departingAt !== null) {
      phase = "fade-out";
      const progress = Math.min(
        1,
        Math.max(0, (now - record.departingAt) / INSTALLATION_FADE_MS),
      );
      opacity = settledOpacity * (1 - progress);
    } else if (isTyping) {
      phase = "typing";
      opacity = 1;
    } else {
      phase = "settled";
      opacity = settledOpacity;
    }

    frames.set(record.id, { phase, depth: record.depth, opacity });
  }

  return { kept, frames, typingCount };
}

interface VisibleTypingRecording extends TypingSedimentState {
  track: TypingTrack;
  speed: number;
}

export function ContinuousTyping({
  typingStates,
  settings,
  liveEventIds,
}: {
  typingStates: TypingState[];
  settings: TypingSettings;
  liveEventIds: ReadonlySet<string>;
}) {
  const queue = useRef(new InstallationPlaybackQueue<TypingTrack>()).current;
  const visible = useRef<VisibleTypingRecording[]>([]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [frame, setFrame] = useState({
    now: 0,
    recordings: [] as VisibleTypingRecording[],
    phases: new Map<string, TypingSedimentFrame>(),
  });

  useEffect(() => {
    const schedule = buildTypingPlaybackSchedule(typingStates);
    queue.update(
      schedule.tracks.map((track) => {
        const id = track.state.animation.event.id;
        return { id, live: liveEventIds.has(id), value: { ...track, id } };
      }),
    );
  }, [queue, typingStates, liveEventIds]);

  useEffect(() => {
    let frameId = 0;
    let lastArrival = -Infinity;
    let lastFrame = -Infinity;
    const animate = (now: number) => {
      if (now - lastFrame >= 1000 / 30) {
        const dtMs = Number.isFinite(lastFrame) ? now - lastFrame : 1000 / 30;
        lastFrame = now;
        const step = stepTypingSediment(visible.current, now, dtMs, {
          windowCount:
            settingsRef.current.liveTypingWindow ?? DEFAULT_LIVE_TYPING_WINDOW,
          floorOpacity:
            settingsRef.current.liveSedimentFloor ?? DEFAULT_LIVE_SEDIMENT_FLOOR,
        });
        visible.current = step.kept;
        // Only boxes that are still typing count against the cap — settled
        // sediment would otherwise stop the field from ever filling.
        if (
          step.typingCount <
            Math.min(30, settingsRef.current.maxConcurrentTyping) &&
          now - lastArrival >= INSTALLATION_TYPING_ARRIVAL_MS
        ) {
          const track = queue.take(
            new Set(visible.current.map((recording) => recording.track.id)),
          );
          if (track) {
            const speed =
              settingsRef.current.keyboardAnimationSpeed *
              settingsRef.current.animationSpeed;
            visible.current.push({
              id: track.id,
              track,
              startedAt: now,
              speed,
              durationMs: track.state.durationMs / speed,
              settledAt: null,
              departingAt: null,
              depth: 0,
            });
            lastArrival = now;
          }
        }
        setFrame({ now, recordings: [...visible.current], phases: step.frames });
      }
      frameId = requestAnimationFrame(animate);
    };
    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [queue]);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* Start order is preserved, so the most recently admitted boxes render
          last and stay on top of the sediment underneath them. */}
      {frame.recordings.map(({ track, startedAt, speed }) => {
        const elapsed = frame.now - startedAt;
        // A box admitted this frame has no entry yet: it is still typing.
        const sediment = frame.phases.get(track.id);
        const phase = sediment?.phase ?? "typing";
        const typing = phase === "typing";
        const depth = sediment?.depth ?? 0;
        const opacity = sediment?.opacity ?? 1;
        const state = track.state;
        const active: ActiveTyping = {
          id: track.id,
          x: state.animation.x,
          y: state.animation.y,
          color: state.animation.color,
          currentText: typing
            ? getTypingTextAtTime(track, elapsed, speed)
            : track.finalText,
          showCaret: typing && Math.floor(elapsed / 530) % 2 === 0,
          textboxSize: state.textboxSize,
          fontSize: state.fontSize,
          positionOffset: state.positionOffset,
          style: state.style,
        };
        return (
          <div
            key={track.id}
            data-typing-recording={track.id}
            data-typing-phase={phase}
            data-typing-depth={typing ? undefined : depth.toFixed(2)}
            style={{
              position: "absolute",
              inset: 0,
              opacity,
              // Desaturating on the wrapper keeps TypingBox (and its memo
              // comparison) untouched while old boxes wash toward the paper.
              filter: typing
                ? undefined
                : `saturate(${typingSedimentSaturation(depth).toFixed(2)})`,
            }}
          >
            <TypingBox typing={active} settings={settings} track={track} />
          </div>
        );
      })}
    </div>
  );
}
