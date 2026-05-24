// ABOUTME: Hook for processing keyboard events into typing animations
// ABOUTME: Extracts keyboard-specific logic from movement.tsx for cleaner separation of concerns

import { useMemo } from "react";
import {
  CollectionEvent,
  KeyboardEventData,
  TypingAction,
  TypingAnimation,
  TypingState,
} from "../types";
import {
  getColorForParticipant,
  eventMatchesAnyFilter,
  type FilterChip,
} from "../utils/eventUtils";

// Settings interface for keyboard typing
export interface KeyboardTypingSettings {
  filters: readonly FilterChip[];
  pidFilter: string;
  keyboardOverlapFactor: number;
  keyboardMinFontSize: number;
  keyboardMaxFontSize: number;
  keyboardPositionRandomness: number;
  keyboardRandomizeOrder: boolean;
  /** Used by the scheduler to derive base spacing — `(avgDuration / cap) ×
   * overlapMultiplier`. Mirrors how cursor trails compute spacing from
   * maxConcurrentTrails. The runtime concurrency cap also gates admission
   * in AnimatedTyping, but baking it into the schedule prevents the
   * underlying clumping that produced visible bombardment waves. */
  maxConcurrentTyping: number;
  /** Max box size as a fraction of viewport size. Captured inputs from
   * page-sized containers (e.g. a full Google Docs body) get clamped so
   * they don't swallow the canvas. 1.0 = no clamping (raw captured size). */
  keyboardSizeCap: number;
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
  /** Duration this viz needs to fit every session at its current spacing.
   * The canvas takes the max of this and other vizs' cycles to size its
   * shared animation loop. */
  cycleDuration: number;
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
 * @returns Typing states ready for rendering, plus time bounds and the
 *   cycle duration this viz needs to fit all sessions at its current
 *   spacing. The canvas reconciles this with other vizs' cycles.
 */
export function useKeyboardTyping(
  events: CollectionEvent[],
  viewportSize: { width: number; height: number },
  settings: KeyboardTypingSettings,
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

    // Apply URL-scope chips and pid filter.
    let filteredKeyboardEvents = keyboardEvents;
    const hasFilters = (settings.filters?.length ?? 0) > 0;
    if (hasFilters || settings.pidFilter) {
      filteredKeyboardEvents = keyboardEvents.filter((e) => {
        if (settings.pidFilter && e.meta?.pid !== settings.pidFilter) return false;
        return eventMatchesAnyFilter(e.meta.url || "", settings.filters);
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
    settings.filters,
    settings.pidFilter,
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

  // Build the typing schedule. Mirrors the cursor-trail approach in
  // useCursorTrails: spacing is derived from the real average session
  // duration divided by the concurrency cap, then scaled by an overlap
  // multiplier. The cycle duration expands to fit every session at that
  // spacing, so sessions never wrap on top of each other.
  //
  // Earlier versions hardcoded avgDuration=3000 and did `index * spacing %
  // timeRangeDuration`, which made multiple sessions land at the same
  // offset whenever the data spanned less than `count * spacing`. That
  // clumping was the root cause of the "bombardment" waves: the runtime
  // concurrency cap deferred the clump, the cap freed when one wave
  // finished, then the next clump dumped in.
  const { keyboardSchedule, cycleDuration: keyboardCycleDuration } = useMemo(() => {
    if (keyboardAnimations.length === 0) {
      return {
        keyboardSchedule: [] as KeyboardScheduleItem[],
        cycleDuration: 0,
      };
    }

    // Pacing is decoupled from session duration. The original schedule used
    // `(realAvgDuration / cap) * overlapMultiplier` (mirroring cursor
    // trails), but typing sessions can be many minutes long when a user
    // wrote a continuous doc — that pushed spacing into the 30+ second
    // range and made the canvas feel empty.
    //
    // Instead: fixed 2s baseline at overlap=0, scaled down by the overlap
    // factor (overlap=1 → ~100ms between admissions). The runtime cap in
    // AnimatedTyping keeps concurrent sessions bounded regardless of how
    // long any individual session runs.
    const baseSpacing = 2000;
    const overlapMultiplier = Math.max(
      0.05,
      1 - settings.keyboardOverlapFactor * 0.95,
    );
    const actualSpacing = Math.max(100, baseSpacing * overlapMultiplier);

    // Play phase: all sessions start within this window, spaced by
    // actualSpacing. Hold phase: after the play phase ends, the cycle
    // continues for HOLD_MS more before wrapping, leaving the finished
    // composition (managed by the completed-tail buffer) on screen as a
    // deliberate "intermission" before the next cycle.
    const playDuration = Math.max(
      keyboardAnimations.length * actualSpacing,
      60000,
    );
    const HOLD_MS = 45000;
    const cycleDuration = playDuration + HOLD_MS;

    const schedule = keyboardAnimations.map((anim, index) => {
      const typingDuration = calculateTypingDuration(anim.sequence);
      // Modulo by playDuration (NOT cycleDuration) so sessions stay in
      // the play phase — the hold is meant to be a pause, not a thinner
      // schedule.
      const startOffset = (index * actualSpacing) % playDuration;

      return {
        index,
        // startTime/endTime are kept relative to the cycle origin (offset
        // from 0). The canvas's animation loop works in elapsed-time
        // space, not wall-clock space, so we don't need to anchor to any
        // absolute timestamp.
        startTime: startOffset,
        endTime: startOffset + typingDuration,
        duration: typingDuration,
      };
    });

    return { keyboardSchedule: schedule, cycleDuration };
  }, [keyboardAnimations, settings.keyboardOverlapFactor]);

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
        // Use captured width/height with slight variation. The cap is
        // user-controlled via `keyboardSizeCap` (fraction of viewport):
        // 1.0 leaves captured sizes untouched (page-sized inputs like
        // Google Docs body or ChatGPT contenteditable containers will
        // span the canvas), 0.5 is a balanced default, smaller values
        // shrink even modest inputs.
        // Floor (60px wide, 24px tall) prevents the ±10px jitter from
        // pushing very narrow captured inputs (search fields, etc.) into
        // negative or near-zero territory.
        const rawW = Math.max(60, capturedStyle.w + (seededRandom(1) - 0.5) * 20);
        const rawH = Math.max(24, capturedStyle.h + (seededRandom(2) - 0.5) * 10);
        if (settings.keyboardSizeCap >= 1) {
          width = rawW;
          height = rawH;
        } else {
          // Height cap is slightly tighter than width: typical canvases
          // are wider than tall, and a box that's 50% tall feels more
          // dominating than one that's 50% wide.
          const maxW = Math.max(200, viewportSize.width * settings.keyboardSizeCap);
          const maxH = Math.max(80, viewportSize.height * settings.keyboardSizeCap * 0.8);
          width = Math.min(maxW, rawW);
          height = Math.min(maxH, rawH);
        }
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
        // schedule.startTime is already cycle-relative (offset from 0), so
        // it IS the startOffsetMs directly. No subtraction needed.
        startOffsetMs: schedule.startTime,
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
    settings.keyboardMinFontSize,
    settings.keyboardMaxFontSize,
    settings.keyboardPositionRandomness,
    settings.keyboardSizeCap,
    viewportSize.width,
    viewportSize.height,
  ]);

  return {
    typingStates,
    timeBounds,
    cycleDuration: keyboardCycleDuration,
  };
}
