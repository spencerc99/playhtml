// ABOUTME: Animated typing visualization component with character-by-character replay
// ABOUTME: Handles typing animation, sequence replay, and blinking caret
import React, { useState, useEffect, useRef, memo, useMemo } from "react";
import { TypingState, TypingAction, ActiveTyping } from "../types";

interface TypingSettings {
  animationSpeed: number;
  textboxOpacity: number;
  keyboardShowCaret: boolean;
  keyboardAnimationSpeed: number;
  keyboardDisplayMode: "full" | "abstract";
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
  }: {
    typing: ActiveTyping;
    settings: TypingSettings;
  }) => {
    const {
      x,
      y,
      currentText,
      showCaret,
      textboxSize,
      fontSize,
      positionOffset,
      style,
    } = typing;

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

    // Handle background color with minimum brightness for visibility
    let backgroundColor: string;
    let textColor: string;

    if (style?.bg !== undefined) {
      // Apply minimum luminosity of 0.85 to ensure visibility (even dark inputs stay light enough to see)
      const luminosity = Math.max(0.85, style.bg);
      const colorValue = Math.round(luminosity * 255);
      backgroundColor = `rgb(${colorValue}, ${colorValue}, ${colorValue})`;

      // Invert text color based on background luminosity
      // If background is dark (< 0.5), use very light text for readability; otherwise dark text
      textColor = "#222";
    } else {
      // Default light background with dark text
      backgroundColor = "#fefefe";
      textColor = "#222";
    }

    return (
      <div
        style={{
          position: "absolute",
          left: `${x + positionOffset.x}px`,
          top: `${y + positionOffset.y}px`,
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      >
        {/* Classic web input box with captured or default styling */}
        <div
          style={{
            position: "relative",
            width: `${textboxSize.width}px`,
            minHeight: `${textboxSize.height}px`,
            maxHeight: "500px", // Cap to prevent extremely tall boxes
            border: `2px ${borderStyle} #999`,
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
            {settings.keyboardDisplayMode === "abstract" ? (
              // Abstract mode: redacted bars that preserve length/structure without revealing text
              currentText.split("\n").map((line, i) => (
                <span key={i} style={{ display: "block", lineHeight: "1.5" }}>
                  {line.length > 0 ? (
                    <span
                      style={{
                        display: "inline-block",
                        width: `${Math.max(8, line.length * fontSize * 0.55)}px`,
                        height: `${fontSize * 0.75}px`,
                        backgroundColor: textColor,
                        opacity: 0.25,
                        borderRadius: "2px",
                        verticalAlign: "middle",
                      }}
                    />
                  ) : (
                    <br />
                  )}
                </span>
              ))
            ) : (
              currentText
            )}
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
      prev.settings.textboxOpacity === next.settings.textboxOpacity &&
      prev.settings.keyboardShowCaret === next.settings.keyboardShowCaret &&
      prev.settings.keyboardDisplayMode === next.settings.keyboardDisplayMode
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
      prevElapsedRef.current = 0;
    }, [schedule]);

    useEffect(() => {
      if (typingStates.length === 0 || timeRange.duration === 0) {
        setActiveTypings([]); // Clear active typings when no states
        return;
      }

      let startTime: number | null = null;

      const resetPlaybackTrackers = () => {
        nextStartOrderIndexRef.current = 0;
        activeTrackIndicesRef.current = [];
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

        while (
          nextStartOrderIndexRef.current < schedule.startOrder.length &&
          schedule.startOrder[nextStartOrderIndexRef.current].startOffsetMs <=
            loopedElapsed
        ) {
          const track = schedule.startOrder[nextStartOrderIndexRef.current];
          if (track.finishedAtMs > loopedElapsed) {
            activeTrackIndicesRef.current.push(track.index);
          }
          nextStartOrderIndexRef.current++;
        }

        const visibleTrackIndexes = new Set<number>();
        const activeTrackIndices = activeTrackIndicesRef.current;
        let activeWriteIndex = 0;

        for (let i = 0; i < activeTrackIndices.length; i++) {
          const trackIndex = activeTrackIndices[i];
          const track = schedule.tracks[trackIndex];
          if (track.finishedAtMs > loopedElapsed) {
            activeTrackIndices[activeWriteIndex] = trackIndex;
            activeWriteIndex++;
            visibleTrackIndexes.add(trackIndex);
          }
        }
        activeTrackIndices.length = activeWriteIndex;

        for (const track of getRecentCompletedTypingTracks(
          schedule,
          loopedElapsed,
        )) {
          visibleTrackIndexes.add(track.index);
        }

        const visibleTracks = Array.from(visibleTrackIndexes)
          .sort((a, b) => a - b)
          .map((index) => schedule.tracks[index]);

        const newActiveTypings = visibleTracks.map((track) => {
          const state = track.state;
          const typingElapsed = loopedElapsed - track.startOffsetMs;
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

    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {activeTypings.map((typing) => (
          <TypingBox
            key={typing.id}
            typing={typing}
            settings={settingsRef.current}
          />
        ))}
      </div>
    );
  },
);
