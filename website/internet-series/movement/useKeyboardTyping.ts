// ABOUTME: Hook for processing keyboard events into typing animations
// ABOUTME: Extracts keyboard-specific logic from movement.tsx for cleaner separation of concerns

import { useMemo } from "react";
import {
  CollectionEvent,
  KeyboardEventData,
  TypingAction,
  TypingAnimation,
  TypingState,
} from "./types";
import { getColorForParticipant, extractDomain } from "./eventUtils";

// Settings interface for keyboard typing
export interface KeyboardTypingSettings {
  domainFilter: string;
  keyboardOverlapFactor: number;
  keyboardMinFontSize: number;
  keyboardMaxFontSize: number;
  keyboardPositionRandomness: number;
  keyboardRandomizeOrder: boolean;
}

// Keyboard schedule item for animation timing
interface KeyboardScheduleItem {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
}

export interface UseKeyboardTypingResult {
  typingStates: TypingState[];
  timeBounds: { min: number; max: number };
}

// Merge threshold for combining fragmented typing sequences
const MERGE_THRESHOLD_MS = 35000;

/**
 * Calculate typing duration from a sequence of actions
 */
function calculateTypingDuration(sequence: TypingAction[]): number {
  if (sequence.length === 0) return 2000;

  const lastTimestamp = sequence[sequence.length - 1].timestamp;
  // Add 2s buffer to match the actionEndTime calculation in replaySequence
  // This ensures the animation has enough time to complete without flickering
  return lastTimestamp + 2000;
}

/**
 * Hook for processing keyboard events into animated typing states
 *
 * @param events - All collection events (will be filtered to keyboard type)
 * @param viewportSize - Current viewport dimensions for coordinate scaling
 * @param settings - Keyboard typing settings
 * @param timeRangeDuration - Duration of the unified time range for scheduling
 * @param timeRangeMin - Start of the unified time range for offset calculation
 * @returns Typing states ready for rendering, plus time bounds for coordination
 */
export function useKeyboardTyping(
  events: CollectionEvent[],
  viewportSize: { width: number; height: number },
  settings: KeyboardTypingSettings,
  timeRangeDuration: number,
  timeRangeMin: number
): UseKeyboardTypingResult {
  // Filter to keyboard events only
  const keyboardEvents = useMemo(() => {
    return events.filter((e) => e.type === "keyboard");
  }, [events]);

  // Process keyboard events into TypingAnimation[]
  const keyboardAnimations = useMemo(() => {
    if (viewportSize.width === 0) {
      return [];
    }

    if (keyboardEvents.length === 0) {
      return [];
    }

    // Apply domain filter if set
    let filteredKeyboardEvents = keyboardEvents;
    if (settings.domainFilter) {
      filteredKeyboardEvents = keyboardEvents.filter((e) => {
        const eventDomain = extractDomain(e.meta.url || "");
        return eventDomain === settings.domainFilter;
      });
    }

    // Filter out test data (e.g., "elizabeth" test entries)
    filteredKeyboardEvents = filteredKeyboardEvents.filter((e) => {
      const data = e.data as any;
      return (
        !data.sequence ||
        data.sequence.reduce((acc: string, s: any) => acc + (s.text || ""), "") !==
          "elizabeth"
      );
    });

    // Group by participant + session + URL + element selector to merge fragmented typing events
    const eventsByInputField = new Map<string, CollectionEvent[]>();

    filteredKeyboardEvents.forEach((event) => {
      const data = event.data as any as KeyboardEventData;

      // Skip events without sequence or ID
      if (!data.sequence || data.sequence.length === 0 || !event.id) {
        return;
      }

      const pid = event.meta.pid;
      const sid = event.meta.sid;
      const url = event.meta.url || "";
      const selector = data.t || "unknown";
      const key = `${pid}|${sid}|${url}|${selector}`;

      if (!eventsByInputField.has(key)) {
        eventsByInputField.set(key, []);
      }
      eventsByInputField.get(key)!.push(event);
    });

    const animations: TypingAnimation[] = [];

    // Merge fragmented sequences that belong to the same input field
    eventsByInputField.forEach((groupEvents) => {
      groupEvents.sort((a, b) => a.ts - b.ts);

      // Merge sequences that are close in time
      const mergedGroups: CollectionEvent[][] = [];
      let currentGroup: CollectionEvent[] = [];

      groupEvents.forEach((event) => {
        if (currentGroup.length === 0) {
          currentGroup.push(event);
        } else {
          const lastEvent = currentGroup[currentGroup.length - 1];
          const timeDiff = event.ts - lastEvent.ts;

          if (timeDiff <= MERGE_THRESHOLD_MS) {
            // Close enough to merge
            currentGroup.push(event);
          } else {
            // Start new group
            mergedGroups.push(currentGroup);
            currentGroup = [event];
          }
        }
      });

      if (currentGroup.length > 0) {
        mergedGroups.push(currentGroup);
      }

      // Create one animation per merged group
      mergedGroups.forEach((group) => {
        const firstEvent = group[0];
        const firstData = firstEvent.data as any as KeyboardEventData;

        // Merge all sequences from the group
        const mergedSequence: TypingAction[] = [];
        let timeOffset = 0;

        group.forEach((event, index) => {
          const data = event.data as any as KeyboardEventData;
          if (!data.sequence) return;

          // Adjust timestamps for continuity
          const sequenceTimeOffset = index === 0 ? 0 : timeOffset;

          data.sequence.forEach((action) => {
            mergedSequence.push({
              ...action,
              timestamp: action.timestamp + sequenceTimeOffset,
            });
          });

          // Update offset for next sequence
          if (data.sequence.length > 0) {
            const lastTimestamp =
              data.sequence[data.sequence.length - 1].timestamp;
            timeOffset += lastTimestamp + 500; // Add 500ms gap between merged sequences
          }
        });

        // Use first event's position and metadata
        const x = firstData.x * viewportSize.width;
        const y = firstData.y * viewportSize.height;

        animations.push({
          event: firstEvent,
          x,
          y,
          color: getColorForParticipant(firstEvent.meta.pid),
          startTime: firstEvent.ts,
          sequence: mergedSequence,
        });
      });
    });

    console.log("[Keyboard] Created", animations.length, "typing animations");

    // Optionally shuffle the order of animations
    if (settings.keyboardRandomizeOrder) {
      // Fisher-Yates shuffle for consistent randomization
      const shuffled = [...animations];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }

    return animations;
  }, [
    keyboardEvents,
    settings.domainFilter,
    viewportSize.width,
    viewportSize.height,
    settings.keyboardRandomizeOrder,
  ]);

  // Calculate time bounds from keyboard events
  const timeBounds = useMemo(() => {
    if (keyboardEvents.length === 0) {
      return { min: 0, max: 0 };
    }

    const timestamps = keyboardEvents.map((e) => e.ts);
    return {
      min: Math.min(...timestamps),
      max: Math.max(...timestamps),
    };
  }, [keyboardEvents]);

  // Create typing schedule with high overlap
  const keyboardSchedule = useMemo(() => {
    if (keyboardAnimations.length === 0 || timeRangeDuration === 0) {
      return [] as KeyboardScheduleItem[];
    }

    // Use much higher overlap for keyboard (settings.keyboardOverlapFactor, default 0.9)
    const avgDuration = 3000; // Average typing animation duration
    const overlapMultiplier = 1 - settings.keyboardOverlapFactor * 0.95;
    const actualSpacing = avgDuration * overlapMultiplier;

    // Stagger mode similar to trails
    const schedule = keyboardAnimations.map((anim, index) => {
      const typingDuration = calculateTypingDuration(anim.sequence);
      const startOffset = (index * actualSpacing) % timeRangeDuration;

      return {
        index,
        startTime: timeRangeMin + startOffset,
        endTime: timeRangeMin + startOffset + typingDuration,
        duration: typingDuration,
      };
    });

    return schedule;
  }, [
    keyboardAnimations,
    timeRangeDuration,
    timeRangeMin,
    settings.keyboardOverlapFactor,
  ]);

  // Generate TypingState[] with visual variations
  const typingStates = useMemo((): TypingState[] => {
    if (keyboardAnimations.length === 0) return [];

    return keyboardAnimations.map((anim, index) => {
      const schedule = keyboardSchedule[index];
      if (!schedule) {
        return {
          animation: anim,
          startOffsetMs: 0,
          durationMs: calculateTypingDuration(anim.sequence),
          textboxSize: { width: 200, height: 40 },
          fontSize: 14,
          positionOffset: { x: 0, y: 0 },
        };
      }

      // Use animation index in seed to ensure unique offsets even for same position
      // This prevents multiple typings on the same input from overlapping
      const seed = anim.x + anim.y + index * 100;

      // Seeded random for consistent variation
      const seededRandom = (offset: number = 0) => {
        const x = Math.sin(seed + offset * 12.9898) * 43758.5453;
        return x - Math.floor(x);
      };

      // Get captured styling from event data if available
      const eventData = anim.event.data as any as KeyboardEventData;
      const capturedStyle = eventData.style;

      // Count newlines and words for smarter sizing
      const fullText = anim.sequence.reduce((text, action) => {
        if (action.action === "type" && action.text) {
          return text + action.text;
        } else if (action.action === "backspace" && action.deletedCount) {
          return text.slice(0, -action.deletedCount);
        }
        return text;
      }, "");

      const lineCount = (fullText.match(/\n/g) || []).length + 1;
      const charCount = fullText.length;

      let width: number;
      let height: number;

      // Font size variation (determine this early as it affects height calculation)
      const fontSizeRange =
        settings.keyboardMaxFontSize - settings.keyboardMinFontSize;
      const fontSize =
        settings.keyboardMinFontSize + seededRandom(3) * fontSizeRange;

      if (capturedStyle) {
        // Use captured width with slight variation
        width = capturedStyle.w + (seededRandom(1) - 0.5) * 20;
        height = capturedStyle.h + (seededRandom(2) - 0.5) * 10;
      } else {
        // Fallback to computed dimensions
        const MAX_WIDTH = 400;
        const MIN_WIDTH = 100;
        const estimatedWidth = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, charCount * 8)
        );
        width = estimatedWidth + (seededRandom(1) - 0.5) * 40;

        // Smart height calculation based on text wrapping
        const PADDING_H = 20;
        const avgCharWidth = fontSize * 0.6;
        const charsPerLine = Math.floor((width - PADDING_H) / avgCharWidth);
        const estimatedLines = Math.max(
          lineCount,
          Math.ceil(charCount / Math.max(1, charsPerLine))
        );

        const LINE_HEIGHT = fontSize * 1.5;
        const PADDING_V = 16;
        const baseHeight = estimatedLines * LINE_HEIGHT + PADDING_V;
        const heightVariation = (seededRandom(2) - 0.5) * 20;
        height = Math.max(40, baseHeight + heightVariation);
      }

      // Positional variation - offset from base x/y to reduce overlap
      // Use exponential scaling so high values spread across entire viewport
      const scaledRandomness = Math.pow(settings.keyboardPositionRandomness, 2);
      const maxOffsetX = viewportSize.width / 2;
      const maxOffsetY = viewportSize.height / 2;
      const rawOffsetX =
        (seededRandom(4) - 0.5) * maxOffsetX * 2 * scaledRandomness;
      const rawOffsetY =
        (seededRandom(5) - 0.5) * maxOffsetY * 2 * scaledRandomness;

      // Clamp to keep within viewport bounds (with textbox size margin)
      const PADDING_H = 20 + 4; // Padding + border
      const PADDING_V = 16 + 4;
      const totalWidth = width + PADDING_H;
      const totalHeight = height + PADDING_V;

      const halfWidth = totalWidth / 2;
      const halfHeight = totalHeight / 2;

      // Ensure textbox stays fully within viewport
      const clampMinX = -anim.x + halfWidth;
      const clampMaxX = viewportSize.width - anim.x - halfWidth;
      const clampMinY = -anim.y + halfHeight;
      const clampMaxY = viewportSize.height - anim.y - halfHeight;

      const offsetX = Math.max(clampMinX, Math.min(clampMaxX, rawOffsetX));
      const offsetY = Math.max(clampMinY, Math.min(clampMaxY, rawOffsetY));

      return {
        animation: anim,
        startOffsetMs: schedule.startTime - timeRangeMin,
        durationMs: schedule.duration,
        textboxSize: { width, height },
        fontSize,
        positionOffset: { x: offsetX, y: offsetY },
        style: capturedStyle,
      };
    });
  }, [
    keyboardAnimations,
    keyboardSchedule,
    timeRangeMin,
    settings.keyboardMinFontSize,
    settings.keyboardMaxFontSize,
    settings.keyboardPositionRandomness,
    viewportSize.width,
    viewportSize.height,
  ]);

  return {
    typingStates,
    timeBounds,
  };
}
