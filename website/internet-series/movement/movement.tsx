// ABOUTME: Main coordinator component for the Internet Movement visualization
// ABOUTME: Handles data fetching, trail computation, and delegates rendering to child components
import "./movement.scss";
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent, Trail, TrailState, KeyboardEventData, TypingAction, TypingAnimation, TypingState } from "./types";
import { Controls } from "./Controls";
import { AnimatedTrails } from "./AnimatedTrails";
import { AnimatedTyping } from "./AnimatedTyping";

// RISO-inspired color palette
const RISO_COLORS = [
  "rgb(0, 120, 191)", // Blue
  "rgb(255, 102, 94)", // Bright Red
  "rgb(0, 169, 92)", // Green
  "rgb(255, 123, 75)", // Orange
  "rgb(146, 55, 141)", // Purple
  "rgb(255, 232, 0)", // Yellow
  "rgb(255, 72, 176)", // Fluorescent Pink
  "rgb(0, 131, 138)", // Teal
];

const API_URL = "https://playhtml-game-api.spencerc99.workers.dev/events/recent";
const TRAIL_TIME_THRESHOLD = 300000; // 5 minutes

const SETTINGS_STORAGE_KEY = 'internet-movement-settings';

function hashParticipantId(pid: string): number {
  let hash = 0;
  for (let i = 0; i < pid.length; i++) {
    const char = pid.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getColorForParticipant(pid: string): string {
  const hash = hashParticipantId(pid);
  return RISO_COLORS[hash % RISO_COLORS.length];
}

const loadSettings = () => {
  const defaults = {
    trailOpacity: 0.7,
    strokeWidth: 5,
    pointSize: 4,
    animationSpeed: 1,
    trailStyle: 'chaotic' as 'straight' | 'smooth' | 'organic' | 'chaotic',
    maxConcurrentTrails: 5,
    trailAnimationMode: 'stagger' as 'natural' | 'stagger',
    trailLifetime: 1.0,
    overlapFactor: 0.5,
    randomizeColors: false,
    minGapBetweenTrails: 0.5,
    chaosIntensity: 1.0,
    clickMinRadius: 10,
    clickMaxRadius: 80,
    clickMinDuration: 500,
    clickMaxDuration: 2500,
    clickStrokeWidth: 4,
    clickOpacity: 0.3,
    clickNumRings: 6,
    clickRingDelayMs: 360,
    clickExpansionDuration: 12300,
    clickAnimationStopPoint: 0.45,
    eventFilter: {
      move: true,
      click: true,
      hold: true,
      cursor_change: true,
    },
    eventTypeFilter: {
      cursor: true,
      keyboard: true,
    },
    domainFilter: '',
    keyboardOverlapFactor: 0.9,
    textboxOpacity: 0.2,
    keyboardMinFontSize: 12,
    keyboardMaxFontSize: 18,
    keyboardShowCaret: true,
    keyboardAnimationSpeed: 0.5, // Slower typing speed (0.5 = half speed)
  };

  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...defaults,
        ...parsed,
        eventFilter: {
          ...defaults.eventFilter,
          ...(parsed.eventFilter || {}),
        },
        eventTypeFilter: {
          ...defaults.eventTypeFilter,
          ...(parsed.eventTypeFilter || {}),
        },
      };
    }
  } catch (err) {
    console.error('Failed to load settings from localStorage:', err);
  }

  return defaults;
};

const InternetMovement = () => {
  const [settings, setSettings] = useState(loadSettings());
  const [controlsVisible, setControlsVisible] = useState(false);
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const initialViewportSize = useRef({ width: 0, height: 0 });

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error('Failed to save settings to localStorage:', err);
    }
  }, [settings]);

  const fetchEvents = async () => {
    setLoading(true);
    setError(null);

    if (containerRef.current) {
      initialViewportSize.current = {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      };
    }

    try {
      // Build query params - always fetch max to get all available events
      // Domain filtering happens client-side to avoid missing domains in dropdown
      const params = new URLSearchParams({
        limit: '5000',
      });

      // Fetch cursor and keyboard events in parallel
      const promises: Promise<CollectionEvent[]>[] = [];

      if (settings.eventTypeFilter.cursor) {
        promises.push(
          fetch(`${API_URL}?${params.toString()}&type=cursor`)
            .then(res => {
              if (!res.ok) throw new Error(`Failed to fetch cursor events: ${res.status}`);
              return res.json();
            })
            .then(events => {
              console.log(`[Fetch] Received ${events.length} cursor events`);
              return events;
            })
        );
      }

      if (settings.eventTypeFilter.keyboard) {
        promises.push(
          fetch(`${API_URL}?${params.toString()}&type=keyboard`)
            .then(res => {
              if (!res.ok) throw new Error(`Failed to fetch keyboard events: ${res.status}`);
              return res.json();
            })
            .then(events => {
              console.log(`[Fetch] Received ${events.length} keyboard events`);
              return events;
            })
        );
      }

      if (promises.length === 0) {
        setEvents([]);
        return;
      }

      const results = await Promise.all(promises);
      const allEvents = results.flat();
      setEvents(allEvents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch events");
      console.error("Error fetching events:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  useEffect(() => {
    let lastDKeyTime = 0;
    let lastRKeyTime = 0;
    const DOUBLE_TAP_THRESHOLD = 300;

    const handleKeyPress = (e: KeyboardEvent) => {
      const now = Date.now();

      if (e.key === 'd' || e.key === 'D') {
        if (now - lastDKeyTime < DOUBLE_TAP_THRESHOLD) {
          setControlsVisible(prev => !prev);
          lastDKeyTime = 0;
        } else {
          lastDKeyTime = now;
        }
      } else if (e.key === 'r' || e.key === 'R') {
        if (now - lastRKeyTime < DOUBLE_TAP_THRESHOLD) {
          fetchEvents();
          lastRKeyTime = 0;
        } else {
          lastRKeyTime = now;
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const newSize = {
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        };

        if (initialViewportSize.current.width === 0) {
          initialViewportSize.current = newSize;
        }

        setViewportSize(newSize);
      }
    };

    updateSize();

    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(containerRef.current);
    } else {
      window.addEventListener("resize", updateSize);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      } else {
        window.removeEventListener("resize", updateSize);
      }
    };
  }, []);

  const extractDomain = (url: string): string => {
    if (!url) return '';
    try {
      const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return '';
    }
  };

  const availableDomains = useMemo(() => {
    const domains = new Set<string>();
    events.forEach((event) => {
      const domain = extractDomain(event.meta.url || '');
      if (domain) {
        domains.add(domain);
      }
    });
    return Array.from(domains).sort();
  }, [events]);

  // Clear domain filter if it's not in available domains (only when events change)
  useEffect(() => {
    if (events.length > 0 && settings.domainFilter && availableDomains.length > 0 && !availableDomains.includes(settings.domainFilter)) {
      console.log(`[Domain Filter] Clearing filter for "${settings.domainFilter}" - not found in available domains`);
      setSettings((s) => ({ ...s, domainFilter: '' }));
    }
  }, [events.length]); // Only depend on events.length to prevent loops

  const trails = useMemo(() => {
    const sizeToUse = initialViewportSize.current.width > 0
      ? initialViewportSize.current
      : viewportSize;

    if (events.length === 0 || sizeToUse.width === 0) {
      return [];
    }

    const filteredEvents = settings.domainFilter
      ? events.filter((event) => {
          const eventDomain = extractDomain(event.meta.url || '');
          return eventDomain === settings.domainFilter;
        })
      : events;

    const participantColors = new Map<string, string>();
    const trails: Trail[] = [];
    const eventsByParticipantAndUrl = new Map<string, CollectionEvent[]>();

    filteredEvents.forEach((event) => {
      if (!event.data || typeof event.data.x !== "number" || typeof event.data.y !== "number") {
        return;
      }

      const pid = event.meta.pid;
      const url = event.meta.url || "";
      const key = `${pid}|${url}`;

      if (!eventsByParticipantAndUrl.has(key)) {
        eventsByParticipantAndUrl.set(key, []);
      }
      eventsByParticipantAndUrl.get(key)!.push(event);
    });

    let trailColorIndex = 0;
    eventsByParticipantAndUrl.forEach((groupEvents, key) => {
      groupEvents.sort((a, b) => a.ts - b.ts);

      const pid = groupEvents[0].meta.pid;

      let color: string;
      if (settings.randomizeColors) {
        color = RISO_COLORS[trailColorIndex % RISO_COLORS.length];
        trailColorIndex++;
      } else {
        if (!participantColors.has(pid)) {
          participantColors.set(pid, getColorForParticipant(pid));
        }
        color = participantColors.get(pid)!;
      }

      let currentTrail: Array<{ x: number; y: number; ts: number; cursor?: string }> = [];
      let currentClicks: Array<{ x: number; y: number; ts: number; button?: number; duration?: number }> = [];
      let lastTimestamp = 0;

      groupEvents.forEach((event) => {
        const eventType = event.data.event || 'move';

        if (eventType === 'move' && !settings.eventFilter.move) return;
        if (eventType === 'click' && !settings.eventFilter.click) return;
        if (eventType === 'hold' && !settings.eventFilter.hold) return;
        if (eventType === 'cursor_change' && !settings.eventFilter.cursor_change) return;

        // Convert normalized coordinates (0-1) to pixel coordinates
        // Normalized coordinates are relative to the viewport when the event was captured
        // We scale them to the current canvas size to preserve relative positions
        // 
        // IMPORTANT: event.data.x and event.data.y are normalized (0-1), so we multiply
        // by the current canvas width/height to get pixel positions
        // 
        // If the original viewport (vw/vh) differs from current canvas, this preserves
        // relative positioning (e.g., 0.5 = 50% across regardless of viewport size)
        const x = event.data.x * sizeToUse.width;
        const y = event.data.y * sizeToUse.height;
        const isClick = eventType === 'click';
        const isHold = eventType === 'hold';
        const cursorType = event.data.cursor;

        if (
          currentTrail.length === 0 ||
          event.ts - lastTimestamp > TRAIL_TIME_THRESHOLD
        ) {
          if (currentTrail.length >= 2) {
            const startTime = currentTrail[0].ts;
            const endTime = currentTrail[currentTrail.length - 1].ts;

            trails.push({
              points: [...currentTrail],
              color,
              opacity: settings.trailOpacity,
              startTime,
              endTime,
              clicks: [...currentClicks],
            });
          }
          currentTrail = [{ x, y, ts: event.ts, cursor: cursorType }];
          currentClicks = [];

          if (isClick) {
            currentClicks.push({ x, y, ts: event.ts, button: event.data.button });
          } else if (isHold) {
            currentClicks.push({ x, y, ts: event.ts, button: event.data.button, duration: event.data.duration });
          }
        } else {
          currentTrail.push({ x, y, ts: event.ts, cursor: cursorType });

          if (isClick) {
            currentClicks.push({ x, y, ts: event.ts, button: event.data.button });
          } else if (isHold) {
            currentClicks.push({ x, y, ts: event.ts, button: event.data.button, duration: event.data.duration });
          }
        }

        lastTimestamp = event.ts;
      });

      if (currentTrail.length >= 2) {
        const startTime = currentTrail[0].ts;
        const endTime = currentTrail[currentTrail.length - 1].ts;

        trails.push({
          points: currentTrail,
          color,
          opacity: settings.trailOpacity,
          startTime,
          endTime,
          clicks: [...currentClicks],
        });
      }
    });

    return trails;
  }, [events, settings.randomizeColors, settings.domainFilter, settings.eventFilter, viewportSize]);

  // Extract keyboard events before calculating timeRange
  const keyboardEvents = useMemo(() => {
    return events.filter(e => e.type === 'keyboard');
  }, [events]);

  const { timeRange, trailSchedule } = useMemo(() => {
    // Collect times from both trails and keyboard events to calculate global timeRange
    const allTimes: number[] = [];

    if (trails.length > 0) {
      allTimes.push(...trails.flatMap(t => [t.startTime, t.endTime]));
    }

    if (keyboardEvents.length > 0) {
      allTimes.push(...keyboardEvents.map(e => e.ts));
    }

    if (allTimes.length === 0) {
      return {
        timeRange: { min: 0, max: 0, duration: 0 },
        trailSchedule: []
      };
    }

    const min = Math.min(...allTimes);
    const max = Math.max(...allTimes);
    const dataDuration = max - min;

    if (trails.length === 0) {
      // Only keyboard events - use simple duration
      const duration = Math.max(dataDuration, 60000);
      console.log('[TimeRange] Keyboard-only mode:', { min, max, duration, keyboardEventsCount: keyboardEvents.length });
      return {
        timeRange: { min, max, duration },
        trailSchedule: []
      };
    }

    const avgDuration = trails.reduce((sum, t) => sum + (t.endTime - t.startTime), 0) / trails.length;
    const minGapMs = settings.minGapBetweenTrails * 1000;
    const overlapMultiplier = 1 - settings.overlapFactor * 0.8;
    const baseSpacing = (avgDuration / settings.maxConcurrentTrails) * overlapMultiplier;
    const actualSpacing = Math.max(minGapMs, baseSpacing);

    const totalTimeNeeded = trails.length * actualSpacing;
    const cycleDuration = Math.max(totalTimeNeeded, dataDuration > 0 ? dataDuration : 60000);

    const trailsByColor = new Map<string, number[]>();
    trails.forEach((trail, index) => {
      if (!trailsByColor.has(trail.color)) {
        trailsByColor.set(trail.color, []);
      }
      trailsByColor.get(trail.color)!.push(index);
    });

    const colorGroups = Array.from(trailsByColor.values());
    const orderedIndices: number[] = [];
    let maxGroupSize = Math.max(...colorGroups.map(g => g.length));

    for (let i = 0; i < maxGroupSize; i++) {
      for (const group of colorGroups) {
        if (i < group.length) {
          orderedIndices.push(group[i]);
        }
      }
    }

    const schedule = trails.map((trail, originalIndex) => {
      if (settings.trailAnimationMode === 'natural') {
        return {
          index: originalIndex,
          startTime: trail.startTime,
          endTime: trail.endTime,
          duration: trail.endTime - trail.startTime,
          adjustedClicks: trail.clicks,
        };
      } else {
        const trailDuration = trail.endTime - trail.startTime;
        const scheduledPosition = orderedIndices.indexOf(originalIndex);
        const startOffset = (scheduledPosition * actualSpacing) % cycleDuration;
        const timeOffset = (min + startOffset) - trail.startTime;

        const adjustedClicks = trail.clicks.map(click => ({
          ...click,
          ts: click.ts + timeOffset,
        }));

        return {
          index: originalIndex,
          startTime: min + startOffset,
          endTime: min + startOffset + trailDuration,
          duration: trailDuration,
          adjustedClicks,
        };
      }
    });

    return {
      timeRange: { min, max, duration: cycleDuration },
      trailSchedule: schedule
    };
  }, [trails, keyboardEvents, settings.trailAnimationMode, settings.maxConcurrentTrails, settings.overlapFactor, settings.minGapBetweenTrails]);

  const applyStyleVariations = useCallback((
    points: Array<{ x: number; y: number }>,
    style: string,
    seed: number,
    chaosIntensity: number = 1.0
  ): Array<{ x: number; y: number }> => {
    if (points.length < 2 || style === 'straight' || style === 'smooth') {
      return points;
    }

    const seededRandom = (i: number, offset: number = 0) => {
      const x = Math.sin(seed + i * 12.9898 + offset * 7.233) * 43758.5453;
      return x - Math.floor(x);
    };

    const variedPoints: Array<{ x: number; y: number }> = [points[0]];

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      if (style === 'organic') {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length > 0) {
          const perpX = -dy / length;
          const perpY = dx / length;
          const perpOffset = (seededRandom(i) - 0.5) * 6;

          variedPoints.push({
            x: (p1.x + p2.x) / 2 + perpX * perpOffset,
            y: (p1.y + p2.y) / 2 + perpY * perpOffset,
          });
        }
        variedPoints.push(p2);
      } else if (style === 'chaotic') {
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const numSubPoints = Math.min(3, Math.ceil(length / 50));

        for (let j = 1; j <= numSubPoints; j++) {
          const t = j / (numSubPoints + 1);
          const baseX = p1.x + dx * t;
          const baseY = p1.y + dy * t;

          const offsetRange = 15 * chaosIntensity;
          const wobble = 8 * chaosIntensity;

          const offsetX = (seededRandom(i * 10 + j, 0) - 0.5) * offsetRange;
          const offsetY = (seededRandom(i * 10 + j, 1) - 0.5) * offsetRange;
          const angle = seededRandom(i * 10 + j, 2) * Math.PI * 2;

          variedPoints.push({
            x: baseX + offsetX + Math.cos(angle) * wobble,
            y: baseY + offsetY + Math.sin(angle) * wobble,
          });
        }
        variedPoints.push(p2);
      }
    }

    return variedPoints;
  }, []);

  const trailStates = useMemo((): TrailState[] => {
    if (trails.length === 0) return [];

    return trails.map((trail, index) => {
      const schedule = trailSchedule[index];
      if (!schedule) {
        return {
          trail,
          startOffsetMs: 0,
          durationMs: trail.endTime - trail.startTime,
          variedPoints: trail.points,
          clicksWithProgress: [],
        };
      }

      const startOffsetMs = schedule.startTime - timeRange.min;
      const durationMs = schedule.duration;

      const seed = trail.points[0]?.x + trail.points[0]?.y || 0;
      const variedPoints = applyStyleVariations(
        trail.points,
        settings.trailStyle,
        seed,
        settings.chaosIntensity || 1.0
      );

      const clicksWithProgress = trail.clicks.map((click) => {
        let clickPointIndex = 0;
        let minTimeDiff = Math.abs(trail.points[0]?.ts - click.ts);

        for (let i = 1; i < trail.points.length; i++) {
          const timeDiff = Math.abs(trail.points[i].ts - click.ts);
          if (timeDiff < minTimeDiff) {
            minTimeDiff = timeDiff;
            clickPointIndex = i;
          }
        }

        const progress = trail.points.length > 1
          ? clickPointIndex / (trail.points.length - 1)
          : 0;

        return {
          x: click.x,
          y: click.y,
          ts: click.ts,
          progress,
          duration: click.duration,
        };
      });

      return {
        trail,
        startOffsetMs,
        durationMs,
        variedPoints,
        clicksWithProgress,
      };
    });
  }, [trails, trailSchedule, timeRange, settings.trailStyle, settings.chaosIntensity, applyStyleVariations]);

  // Process keyboard events into TypingAnimation[]
  const keyboardAnimations = useMemo(() => {
    // Wait for viewport to be measured before processing
    if (viewportSize.width === 0 && initialViewportSize.current.width === 0) {
      return [];
    }

    const sizeToUse = initialViewportSize.current.width > 0
      ? initialViewportSize.current
      : viewportSize;

    if (keyboardEvents.length === 0) {
      return [];
    }

    // Apply domain filter if set
    let filteredKeyboardEvents = keyboardEvents;
    if (settings.domainFilter) {
      filteredKeyboardEvents = keyboardEvents.filter(e => {
        const eventDomain = extractDomain(e.meta.url || '');
        return eventDomain === settings.domainFilter;
      });
    }

    // Group by participant + URL
    const eventsByParticipantAndUrl = new Map<string, CollectionEvent[]>();

    filteredKeyboardEvents.forEach(event => {
      const pid = event.meta.pid;
      const url = event.meta.url || "";
      const key = `${pid}|${url}`;

      if (!eventsByParticipantAndUrl.has(key)) {
        eventsByParticipantAndUrl.set(key, []);
      }
      eventsByParticipantAndUrl.get(key)!.push(event);
    });

    const animations: TypingAnimation[] = [];

    eventsByParticipantAndUrl.forEach((groupEvents, key) => {
      groupEvents.sort((a, b) => a.ts - b.ts);

      let skippedNoSequence = 0;
      let skippedNoId = 0;
      groupEvents.forEach(event => {
        const data = event.data as any as KeyboardEventData;

        // Skip events without sequence (abstract privacy level)
        if (!data.sequence || data.sequence.length === 0) {
          skippedNoSequence++;
          return;
        }

        // Skip events without valid IDs
        if (!event.id) {
          skippedNoId++;
          return;
        }

        const x = data.x * sizeToUse.width;
        const y = data.y * sizeToUse.height;

        animations.push({
          event,
          x,
          y,
          color: getColorForParticipant(event.meta.pid),
          startTime: event.ts,
          sequence: data.sequence,
        });
      });
    });

    console.log('[Keyboard] Created', animations.length, 'typing animations');
    return animations;
  }, [keyboardEvents, settings.domainFilter, viewportSize.width]);

  // Helper function to calculate typing duration from sequence
  const calculateTypingDuration = (sequence: TypingAction[]): number => {
    if (sequence.length === 0) return 2000;

    const lastTimestamp = sequence[sequence.length - 1].timestamp;
    return lastTimestamp + 1000; // Add 1s buffer to show final result
  };

  // Create typing schedule with high overlap
  const keyboardSchedule = useMemo(() => {
    if (keyboardAnimations.length === 0 || timeRange.duration === 0) {
      return {
        timeRange: timeRange,
        schedule: []
      };
    }

    // Use much higher overlap for keyboard (settings.keyboardOverlapFactor, default 0.9)
    const avgDuration = 3000; // Average typing animation duration
    const overlapMultiplier = 1 - settings.keyboardOverlapFactor * 0.95;
    const actualSpacing = avgDuration * overlapMultiplier;

    // Stagger mode similar to trails
    const schedule = keyboardAnimations.map((anim, index) => {
      const typingDuration = calculateTypingDuration(anim.sequence);
      const startOffset = (index * actualSpacing) % timeRange.duration;

      return {
        index,
        startTime: timeRange.min + startOffset,
        endTime: timeRange.min + startOffset + typingDuration,
        duration: typingDuration,
      };
    });

    return { timeRange, schedule };
  }, [keyboardAnimations, timeRange, settings.keyboardOverlapFactor]);

  // Generate TypingState[] with visual variations
  const typingStates = useMemo((): TypingState[] => {
    if (keyboardAnimations.length === 0) return [];

    return keyboardAnimations.map((anim, index) => {
      const schedule = keyboardSchedule.schedule[index];
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

      const seed = anim.x + anim.y;

      // Seeded random for consistent variation
      const seededRandom = (offset: number = 0) => {
        const x = Math.sin(seed + offset * 12.9898) * 43758.5453;
        return x - Math.floor(x);
      };

      // Count newlines and words for smarter sizing
      const fullText = anim.sequence.reduce((text, action) => {
        if (action.action === 'type' && action.text) {
          return text + action.text;
        } else if (action.action === 'backspace' && action.deletedCount) {
          return text.slice(0, -action.deletedCount);
        }
        return text;
      }, '');

      const lineCount = (fullText.match(/\n/g) || []).length + 1;
      const charCount = fullText.length;

      // Smart width calculation - cap at max width
      const MAX_WIDTH = 400;
      const MIN_WIDTH = 150;
      const charsPerLine = 35; // Approximate chars that fit in one line
      const estimatedWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, charCount * 8));
      const width = estimatedWidth + (seededRandom(1) - 0.5) * 40;

      // Smart height calculation
      const LINE_HEIGHT = 24;
      const PADDING = 16;
      const estimatedLines = Math.max(lineCount, Math.ceil(charCount / charsPerLine));
      const baseHeight = estimatedLines * LINE_HEIGHT + PADDING;
      const heightVariation = (seededRandom(2) - 0.5) * 20;
      const height = Math.max(40, baseHeight + heightVariation);

      // Font size variation (use settings min/max)
      const fontSizeRange = settings.keyboardMaxFontSize - settings.keyboardMinFontSize;
      const fontSize = settings.keyboardMinFontSize + seededRandom(3) * fontSizeRange;

      // Positional variation - offset from base x/y to reduce overlap
      const offsetRadius = 60; // Max offset in pixels
      const offsetX = (seededRandom(4) - 0.5) * offsetRadius;
      const offsetY = (seededRandom(5) - 0.5) * offsetRadius;

      return {
        animation: anim,
        startOffsetMs: schedule.startTime - timeRange.min,
        durationMs: schedule.duration,
        textboxSize: { width, height },
        fontSize,
        positionOffset: { x: offsetX, y: offsetY },
      };
    });

    console.log('[Typing States]', typingStates.length, 'states created');
    return typingStates;
  }, [keyboardAnimations, keyboardSchedule, timeRange, settings.keyboardMinFontSize, settings.keyboardMaxFontSize]);

  // Memoize typing settings to prevent infinite re-renders
  const typingSettings = useMemo(() => ({
    animationSpeed: settings.animationSpeed,
    textboxOpacity: settings.textboxOpacity,
    keyboardShowCaret: settings.keyboardShowCaret,
    keyboardAnimationSpeed: settings.keyboardAnimationSpeed,
  }), [settings.animationSpeed, settings.textboxOpacity, settings.keyboardShowCaret, settings.keyboardAnimationSpeed]);

  return (
    <div className="internet-movement">
      <Controls
        visible={controlsVisible}
        settings={settings}
        setSettings={setSettings}
        loading={loading}
        error={error}
        events={events}
        trails={trails}
        availableDomains={availableDomains}
        fetchEvents={fetchEvents}
        timeRange={timeRange}
      />

      {settings.domainFilter && (
        <div style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          zIndex: 100,
        }}>
          <div style={{
            position: 'relative',
            padding: '10px 16px',
            background: '#faf9f6',
            border: '1px solid rgba(0, 0, 0, 0.12)',
            boxShadow: 'inset 1px 1px 2px rgba(255, 255, 255, 0.8), inset -1px -1px 2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.08)',
            fontFamily: '"Martian Mono", "Space Mono", "Courier New", monospace',
            fontSize: '11px',
            fontWeight: '600',
            color: '#333',
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            overflow: 'hidden',
          }}>
            <svg style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              opacity: 0.15,
              pointerEvents: 'none',
            }}>
              <filter id="domainNoise">
                <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" />
                <feColorMatrix type="saturate" values="0" />
                <feComponentTransfer>
                  <feFuncA type="discrete" tableValues="0 0.3 0.5 0.7" />
                </feComponentTransfer>
              </filter>
              <rect width="100%" height="100%" filter="url(#domainNoise)" />
            </svg>

            <span style={{ position: 'relative', zIndex: 1 }}>
              {settings.domainFilter}
            </span>
          </div>
        </div>
      )}

      <div className="canvas-container" ref={containerRef}>
        {/* RISO paper texture overlay */}
        <svg
          width="100%"
          height="100%"
          className="riso-pattern"
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.7,
            pointerEvents: "none",
            mixBlendMode: "multiply",
          }}
        >
          <defs>
            <filter id="noise">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.9"
                numOctaves="3"
                stitchTiles="stitch"
              />
              <feColorMatrix
                type="matrix"
                values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 2 -1"
              />
            </filter>
            <filter id="grain">
              <feTurbulence
                type="turbulence"
                baseFrequency="0.5"
                numOctaves="2"
                stitchTiles="stitch"
              />
              <feColorMatrix type="saturate" values="0" />
              <feComponentTransfer>
                <feFuncA type="discrete" tableValues="0 0.2 0.3 0.4" />
              </feComponentTransfer>
            </filter>
            <filter id="smoothing">
              <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" />
            </filter>
          </defs>
          <rect width="100%" height="100%" filter="url(#noise)" />
          <rect
            width="100%"
            height="100%"
            filter="url(#grain)"
            style={{ opacity: 0.3 }}
          />
        </svg>

        {settings.eventTypeFilter.cursor && (
          <AnimatedTrails
            key={settings.domainFilter}
            trailStates={trailStates}
            timeRange={timeRange}
            settings={{
              strokeWidth: settings.strokeWidth,
              pointSize: settings.pointSize,
              trailOpacity: settings.trailOpacity,
              animationSpeed: settings.animationSpeed,
              clickMinRadius: settings.clickMinRadius,
              clickMaxRadius: settings.clickMaxRadius,
              clickMinDuration: settings.clickMinDuration,
              clickMaxDuration: settings.clickMaxDuration,
              clickExpansionDuration: settings.clickExpansionDuration,
              clickStrokeWidth: settings.clickStrokeWidth,
              clickOpacity: settings.clickOpacity,
              clickNumRings: settings.clickNumRings,
              clickRingDelayMs: settings.clickRingDelayMs,
              clickAnimationStopPoint: settings.clickAnimationStopPoint,
            }}
          />
        )}

        {settings.eventTypeFilter.keyboard && (
          <AnimatedTyping
            typingStates={typingStates}
            timeRange={timeRange}
            settings={typingSettings}
          />
        )}
      </div>
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(<InternetMovement />);
3
