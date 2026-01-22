// ABOUTME: Main coordinator component for the Internet Movement visualization
// ABOUTME: Handles data fetching, trail computation, and delegates rendering to child components
import "./movement.scss";
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { CollectionEvent, Trail, TrailState } from "./types";
import { Controls } from "./Controls";
import { AnimatedTrails } from "./AnimatedTrails";

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
    domainFilter: '',
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
      const response = await fetch(`${API_URL}?type=cursor&limit=5000`);
      if (!response.ok) {
        throw new Error(`Failed to fetch events: ${response.status}`);
      }
      const data: CollectionEvent[] = await response.json();
      setEvents(data);
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
      let currentClicks: Array<{ x: number; y: number; ts: number; button?: number }> = [];
      let lastTimestamp = 0;

      groupEvents.forEach((event) => {
        const eventType = event.data.event || 'move';

        if (eventType === 'move' && !settings.eventFilter.move) return;
        if (eventType === 'click' && !settings.eventFilter.click) return;
        if (eventType === 'hold' && !settings.eventFilter.hold) return;
        if (eventType === 'cursor_change' && !settings.eventFilter.cursor_change) return;

        const x = event.data.x * sizeToUse.width;
        const y = event.data.y * sizeToUse.height;
        const isClick = eventType === 'click';
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
          }
        } else {
          currentTrail.push({ x, y, ts: event.ts, cursor: cursorType });

          if (isClick) {
            currentClicks.push({ x, y, ts: event.ts, button: event.data.button });
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
  }, [events, settings.trailOpacity, settings.randomizeColors, settings.domainFilter, settings.eventFilter, viewportSize]);

  const { timeRange, trailSchedule } = useMemo(() => {
    if (trails.length === 0) return {
      timeRange: { min: 0, max: 0, duration: 0 },
      trailSchedule: []
    };

    const times = trails.flatMap(t => [t.startTime, t.endTime]);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const dataDuration = max - min;

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
  }, [trails, settings.trailAnimationMode, settings.maxConcurrentTrails, settings.overlapFactor, settings.minGapBetweenTrails]);

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

      <AnimatedTrails
        key={settings.domainFilter}
        trailStates={trailStates}
        containerRef={containerRef}
        timeRange={timeRange}
        settings={{
          strokeWidth: settings.strokeWidth,
          pointSize: settings.pointSize,
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
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(<InternetMovement />);
3
