import "./movement.scss";
import React, { useState, useEffect, useRef, useMemo, memo } from "react";
import ReactDOM from "react-dom/client";
import { getCursorComponent } from "./cursors";

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

// API endpoint
const API_URL = "https://playhtml-game-api.spencerc99.workers.dev/events/recent";

interface CollectionEvent {
  id: string;
  type: string;
  ts: number;
  data: {
    x: number;
    y: number;
    event?: 'move' | 'click' | 'hold' | 'cursor_change';
    cursor?: string;
    button?: number;
    duration?: number;
  };
  meta: {
    pid: string; // participant ID
    sid: string;
    url: string;
    vw: number;
    vh: number;
    tz: string;
  };
}

interface Trail {
  points: Array<{ x: number; y: number; ts: number; cursor?: string }>;
  color: string;
  opacity: number;
  // Calculate angle for cursor direction
  angle?: number;
  // Timestamps for animation
  startTime: number;
  endTime: number;
  // Track click events within this trail
  clicks: Array<{ x: number; y: number; ts: number; button?: number }>;
}

interface ClickEffect {
  id: string;
  x: number;
  y: number;
  color: string;
  radiusFactor: number;
  durationFactor: number;
  startTime: number;
  trailIndex: number;
}

// Time threshold for grouping points into the same trail (in milliseconds)
// Points within this time window will be connected (captures a single browsing session)
const TRAIL_TIME_THRESHOLD = 300000; // 5 minutes (300 seconds) - captures a full session

// Hash function to consistently assign colors to participants
function hashParticipantId(pid: string): number {
  let hash = 0;
  for (let i = 0; i < pid.length; i++) {
    const char = pid.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

function getColorForParticipant(pid: string): string {
  const hash = hashParticipantId(pid);
  return RISO_COLORS[hash % RISO_COLORS.length];
}

// RISO pattern overlay component
const RisoPattern = React.memo(() => (
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
      {/* Smoothing filter to make straight lines look more organic */}
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
));

const SETTINGS_STORAGE_KEY = 'internet-movement-settings';

// Load settings from localStorage with defaults
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
    chaosIntensity: 1.0, // Multiplier for chaotic style variations (0.5 = subtle, 2.0 = extreme)
    // Click ripple settings
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
    // Event filter settings
    eventFilter: {
      move: true,
      click: true,
      hold: true,
      cursor_change: true,
    },
  };

  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to ensure new settings are always present
      return {
        ...defaults,
        ...parsed,
        // Ensure eventFilter exists and has all properties
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

// Define RippleSettings type for the RippleEffect component
interface RippleSettings {
  clickMinRadius: number;
  clickMaxRadius: number;
  clickMinDuration: number;
  clickMaxDuration: number;
  clickExpansionDuration: number;
  clickStrokeWidth: number;
  clickOpacity: number;
  clickNumRings: number;
  clickRingDelayMs: number;
  clickAnimationStopPoint: number;
}

// Ripple Effect Component for clicks - MUST be defined outside InternetMovement
// to prevent recreation on every parent render
const RippleEffect = memo(
  ({
    effect,
    settings: rippleSettings,
  }: {
    effect: ClickEffect;
    settings: RippleSettings;
  }) => {
    const [now, setNow] = useState(Date.now());
    const [isAnimating, setIsAnimating] = useState(true);

    // Calculate actual radius and duration from factors
    const effectMaxRadius = rippleSettings.clickMinRadius + effect.radiusFactor * (rippleSettings.clickMaxRadius - rippleSettings.clickMinRadius);
    const effectTotalDuration = rippleSettings.clickMinDuration + effect.durationFactor * (rippleSettings.clickMaxDuration - rippleSettings.clickMinDuration);

    useEffect(() => {
      let animationFrameId: number;

      const animate = () => {
        setNow(Date.now());
        animationFrameId = requestAnimationFrame(animate);
      };

      if (isAnimating) {
        animationFrameId = requestAnimationFrame(animate);
      }

      return () => {
        if (animationFrameId) {
          cancelAnimationFrame(animationFrameId);
        }
      };
    }, [isAnimating]);

    // Easing function
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

    // Check if all rings complete or total duration elapsed
    const totalElapsed = now - effect.startTime;
    const allRingsComplete = totalElapsed >= effectTotalDuration || Array.from({ length: rippleSettings.clickNumRings }).every((_, i) => {
      const ringStartTime = effect.startTime + (i * rippleSettings.clickRingDelayMs);
      const elapsed = now - ringStartTime;
      const ringProgress = Math.min(1, elapsed / rippleSettings.clickExpansionDuration);
      return ringProgress >= rippleSettings.clickAnimationStopPoint;
    });

    if (isAnimating && allRingsComplete) {
      setIsAnimating(false);
    }

    const rings = Array.from({ length: rippleSettings.clickNumRings }, (_, i) => {
      const ringStartTime = effect.startTime + (i * rippleSettings.clickRingDelayMs);
      const elapsed = now - ringStartTime;
      
      if (elapsed < 0) return null;
      
      // Calculate raw progress (0 to 1 over expansionDuration)
      const rawProgress = Math.min(1, elapsed / rippleSettings.clickExpansionDuration);
      
      // Clamp to stop point BEFORE easing
      const clampedProgress = Math.min(rawProgress, rippleSettings.clickAnimationStopPoint);
      
      // Apply easing to get radius (normalized to 0-1 range based on stop point)
      // This ensures the ring expands smoothly to stopPoint% of maxRadius and stops there
      const normalizedProgress = clampedProgress / rippleSettings.clickAnimationStopPoint;
      const ringRadius = effectMaxRadius * rippleSettings.clickAnimationStopPoint * easeOutCubic(normalizedProgress);
      
      // No fade-in - appear instantly at full opacity for perfect sync with cursor
      const ringOpacity = rippleSettings.clickOpacity;

      return (
        <circle
          key={i}
          cx={effect.x}
          cy={effect.y}
          r={ringRadius}
          fill="none"
          stroke={effect.color}
          strokeWidth={rippleSettings.clickStrokeWidth}
          opacity={Math.max(0, ringOpacity)}
          style={{ mixBlendMode: "multiply" }}
        />
      );
    });

    return <g>{rings}</g>;
  }
);

const InternetMovement = () => {
  const [settings, setSettings] = useState(loadSettings());
  
  const [controlsVisible, setControlsVisible] = useState(false);
  
  // Save settings to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error('Failed to save settings to localStorage:', err);
    }
  }, [settings]);

  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const initialViewportSize = useRef({ width: 0, height: 0 }); // Store initial size for trail calculations
  const [animationProgress, setAnimationProgress] = useState(0);
  const animationRef = useRef<number>();
  const [activeClickEffects, setActiveClickEffects] = useState<ClickEffect[]>([]);
  
  // Cache for generated paths - keyed by trailIndex-progress-style
  const pathCache = useRef<Map<string, string>>(new Map());
  const variedPointsCache = useRef<Map<string, Array<{ x: number; y: number }>>>(new Map());

  // Fetch cursor events from API
  const fetchEvents = async () => {
    setLoading(true);
    setError(null);
    
    // Reset animation progress to restart from beginning
    setAnimationProgress(0);
    
    // Cancel any ongoing animation
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = undefined;
    }
    
    // Reset initial viewport size to current size when refreshing data
    // This ensures trails are recalculated based on the current window size
    if (containerRef.current) {
      initialViewportSize.current = {
        width: containerRef.current.clientWidth,
        height: containerRef.current.clientHeight,
      };
    }
    
    try {
      const response = await fetch(
        `${API_URL}?type=cursor&limit=5000`
      );
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

  // Initial fetch on mount
  useEffect(() => {
    fetchEvents();
  }, []);

  // Keyboard shortcuts (double-tap 'D' for controls, double-tap 'R' for refresh)
  useEffect(() => {
    let lastDKeyTime = 0;
    let lastRKeyTime = 0;
    const DOUBLE_TAP_THRESHOLD = 300; // ms

    const handleKeyPress = (e: KeyboardEvent) => {
      const now = Date.now();
      
      if (e.key === 'd' || e.key === 'D') {
        if (now - lastDKeyTime < DOUBLE_TAP_THRESHOLD) {
          // Double tap detected - toggle controls
          setControlsVisible(prev => !prev);
          lastDKeyTime = 0; // Reset to prevent triple-tap
        } else {
          lastDKeyTime = now;
        }
      } else if (e.key === 'r' || e.key === 'R') {
        if (now - lastRKeyTime < DOUBLE_TAP_THRESHOLD) {
          // Double tap detected - refresh data
          console.log('Refreshing data...');
          fetchEvents();
          lastRKeyTime = 0; // Reset to prevent triple-tap
        } else {
          lastRKeyTime = now;
        }
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  // Update viewport size on resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const newSize = {
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        };
        
        // Store initial viewport size (only once)
        if (initialViewportSize.current.width === 0) {
          initialViewportSize.current = newSize;
        }
        
        setViewportSize(newSize);
      }
    };

    // Initial size calculation
    updateSize();
    
    // Use ResizeObserver for better performance
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(containerRef.current);
    } else {
      // Fallback to window resize
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

  // Group events into trails based on participant, URL, and time proximity
  // Use initial viewport size to prevent recalculation on resize
  const trails = useMemo(() => {
    const sizeToUse = initialViewportSize.current.width > 0 
      ? initialViewportSize.current 
      : viewportSize;
    
    if (events.length === 0 || sizeToUse.width === 0) {
      return [];
    }

    const participantColors = new Map<string, string>();
    const trails: Trail[] = [];

    // Group events by participant and URL
    const eventsByParticipantAndUrl = new Map<string, CollectionEvent[]>();

    events.forEach((event) => {
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

    // Process each group to create trails
    let trailColorIndex = 0;
    eventsByParticipantAndUrl.forEach((groupEvents, key) => {
      // Sort events by timestamp
      groupEvents.sort((a, b) => a.ts - b.ts);

      const pid = groupEvents[0].meta.pid;
      
      // Assign color based on mode
      let color: string;
      if (settings.randomizeColors) {
        // Cycle through RISO colors for different trails
        color = RISO_COLORS[trailColorIndex % RISO_COLORS.length];
        trailColorIndex++;
      } else {
        if (!participantColors.has(pid)) {
          participantColors.set(pid, getColorForParticipant(pid));
        }
        color = participantColors.get(pid)!;
      }

      // Group consecutive events into trails based on time proximity
      let currentTrail: Array<{ x: number; y: number; ts: number; cursor?: string }> = [];
      let currentClicks: Array<{ x: number; y: number; ts: number; button?: number }> = [];
      let lastTimestamp = 0;

      groupEvents.forEach((event) => {
        const eventType = event.data.event || 'move'; // Default to 'move' if not specified
        
        // Skip this event if its type is filtered out
        if (eventType === 'move' && !settings.eventFilter.move) return;
        if (eventType === 'click' && !settings.eventFilter.click) return;
        if (eventType === 'hold' && !settings.eventFilter.hold) return;
        if (eventType === 'cursor_change' && !settings.eventFilter.cursor_change) return;
        
        const x = event.data.x * sizeToUse.width;
        const y = event.data.y * sizeToUse.height;
        const isClick = eventType === 'click';
        const cursorType = event.data.cursor;

        // Start a new trail if:
        // 1. This is the first point, or
        // 2. Too much time has passed since the last point
        if (
          currentTrail.length === 0 ||
          event.ts - lastTimestamp > TRAIL_TIME_THRESHOLD
        ) {
          // Save previous trail if it has at least 2 points
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
          // Start new trail
          currentTrail = [{ x, y, ts: event.ts, cursor: cursorType }];
          currentClicks = [];
          
          if (isClick) {
            currentClicks.push({ x, y, ts: event.ts, button: event.data.button });
          }
        } else {
          // Continue current trail
          currentTrail.push({ x, y, ts: event.ts, cursor: cursorType });
          
          if (isClick) {
            currentClicks.push({ x, y, ts: event.ts, button: event.data.button });
          }
        }

        lastTimestamp = event.ts;
      });

      // Don't forget the last trail
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

    // Show all trails (remove filter to see everything)
    // return trails;
    
    // DEBUG: Show only trails with clicks for testing
    const trailWithClicks = trails.filter(t => t.clicks.length > 2);
    if (trailWithClicks.length > 0) {
      return trailWithClicks;
    }
    return trails;
  }, [events, settings.trailOpacity, settings.randomizeColors]);

  // Calculate time range and trail scheduling for animation
  const { timeRange, trailSchedule } = useMemo(() => {
    if (trails.length === 0) return { 
      timeRange: { min: 0, max: 0, duration: 0 },
      trailSchedule: []
    };
    
    const times = trails.flatMap(t => [t.startTime, t.endTime]);
    const min = Math.min(...times);
    const max = Math.max(...times);
    const dataDuration = max - min;
    
    // Calculate animation cycle duration based on stagger choreography
    // This ensures trails don't animate too fast relative to the cycle
    const avgDuration = trails.reduce((sum, t) => sum + (t.endTime - t.startTime), 0) / trails.length;
    const minGapMs = settings.minGapBetweenTrails * 1000;
    const overlapMultiplier = 1 - settings.overlapFactor * 0.8;
    const baseSpacing = (avgDuration / settings.maxConcurrentTrails) * overlapMultiplier;
    const actualSpacing = Math.max(minGapMs, baseSpacing);
    
    // Total cycle time = time needed for all trails with spacing
    const totalTimeNeeded = trails.length * actualSpacing;
    
    // Use choreographed time for animation cycle (not raw data duration)
    // This prevents trails from animating too fast
    const cycleDuration = Math.max(totalTimeNeeded, dataDuration > 0 ? dataDuration : 60000);
    
    // Group trails by color to prioritize showing different colors
    const trailsByColor = new Map<string, number[]>();
    trails.forEach((trail, index) => {
      if (!trailsByColor.has(trail.color)) {
        trailsByColor.set(trail.color, []);
      }
      trailsByColor.get(trail.color)!.push(index);
    });
    
    // Create an ordered list of trail indices that prioritizes color diversity
    const colorGroups = Array.from(trailsByColor.values());
    const orderedIndices: number[] = [];
    let maxGroupSize = Math.max(...colorGroups.map(g => g.length));
    
    // Interleave trails from different color groups
    for (let i = 0; i < maxGroupSize; i++) {
      for (const group of colorGroups) {
        if (i < group.length) {
          orderedIndices.push(group[i]);
        }
      }
    }
    
    // Create schedule for each trail based on mode
    const schedule = trails.map((trail, originalIndex) => {
      if (settings.trailAnimationMode === 'natural') {
        // Use actual timestamps - no adjustment needed
        return {
          index: originalIndex,
          startTime: trail.startTime,
          endTime: trail.endTime,
          duration: trail.endTime - trail.startTime,
          adjustedClicks: trail.clicks, // Clicks keep original timestamps
        };
      } else {
        // Stagger mode: create a continuous choreography of trails
        const trailDuration = trail.endTime - trail.startTime;
        
        // Find position of this trail in the color-interleaved order
        const scheduledPosition = orderedIndices.indexOf(originalIndex);
        
        // Use the scheduled position (color-interleaved) instead of original index
        // actualSpacing was calculated above in the cycle duration logic
        const startOffset = (scheduledPosition * actualSpacing) % cycleDuration;
        
        // Calculate the time offset applied to this trail
        const timeOffset = (min + startOffset) - trail.startTime;
        
        // Adjust all click timestamps by the same offset
        const adjustedClicks = trail.clicks.map(click => ({
          ...click,
          ts: click.ts + timeOffset,
        }));
        
        // DEBUG: Log schedule details
        if (originalIndex === 0) {
          console.log('📅 Schedule created for trail 0:', {
            originalStartTime: trail.startTime,
            originalEndTime: trail.endTime,
            scheduledStartTime: min + startOffset,
            scheduledEndTime: min + startOffset + trailDuration,
            timeOffset,
            originalClicks: trail.clicks.map(c => c.ts),
            adjustedClicks: adjustedClicks.map(c => c.ts),
          });
        }
        
        return {
          index: originalIndex,
          startTime: min + startOffset,
          endTime: min + startOffset + trailDuration,
          duration: trailDuration,
          adjustedClicks, // Store adjusted click timestamps
        };
      }
    });
    
    return { 
      timeRange: { min, max, duration: cycleDuration },
      trailSchedule: schedule
    };
  }, [trails, settings.trailAnimationMode, settings.maxConcurrentTrails, settings.overlapFactor, settings.minGapBetweenTrails]);

  // Animation loop - matches actual time intervals in the data
  useEffect(() => {
    if (trails.length === 0 || timeRange.duration === 0) return;

    // Use the duration from the schedule, scaled by animation speed
    const ANIMATION_DURATION = timeRange.duration / settings.animationSpeed;
    let startTime: number | null = null;

    const animate = (timestamp: number) => {
      if (startTime === null) startTime = timestamp;
      
      const elapsed = timestamp - startTime;
      // Loop the animation - progress goes from 0 to 1 over the duration
      const progress = (elapsed % ANIMATION_DURATION) / ANIMATION_DURATION;
      
      setAnimationProgress(progress);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [trails, timeRange, settings.animationSpeed]);

  // Track which clicks have been spawned per trail - use Map to store last spawned progress
  const lastSpawnedProgress = useRef<Map<string, number>>(new Map());
  
  // Store stable references to avoid effect re-running
  const trailsRef = useRef(trails);
  const timeRangeRef = useRef(timeRange);
  const trailScheduleRef = useRef(trailSchedule);
  
  // Update refs when values change
  useEffect(() => {
    trailsRef.current = trails;
    timeRangeRef.current = timeRange;
    trailScheduleRef.current = trailSchedule;
  }, [trails, timeRange, trailSchedule]);

  // Spawn click effects based on animation progress
  useEffect(() => {
    const currentTrails = trailsRef.current;
    const currentTimeRange = timeRangeRef.current;
    const currentSchedule = trailScheduleRef.current;
    
    if (currentTrails.length === 0 || !currentTimeRange || !currentSchedule) return;

    currentTrails.forEach((trail, trailIndex) => {
      const schedule = currentSchedule[trailIndex];
      if (!schedule || trail.points.length < 2) return;

      // Check if this trail is currently visible/animating
      const normalizedStart = (schedule.startTime - currentTimeRange.min) / currentTimeRange.duration;
      const normalizedEnd = (schedule.endTime - currentTimeRange.min) / currentTimeRange.duration;
      const wrappedStart = normalizedStart % 1;
      const wrappedEnd = normalizedEnd % 1;

      // Determine if trail is currently active
      let trailIsActive = false;
      if (wrappedEnd > wrappedStart) {
        trailIsActive = animationProgress >= wrappedStart && animationProgress <= wrappedEnd;
      } else {
        trailIsActive = animationProgress >= wrappedStart || animationProgress <= wrappedEnd;
      }

      if (!trailIsActive) return;

      // Calculate trail progress
      let trailProgress: number;
      if (wrappedEnd > wrappedStart) {
        if (animationProgress >= wrappedEnd) {
          trailProgress = 1;
        } else {
          trailProgress = Math.max(0, Math.min(1, (animationProgress - wrappedStart) / (wrappedEnd - wrappedStart)));
        }
      } else {
        const adjustedProgress = animationProgress >= wrappedStart 
          ? animationProgress - wrappedStart 
          : 1 - wrappedStart + animationProgress;
        trailProgress = Math.max(0, Math.min(1, adjustedProgress / (normalizedEnd - normalizedStart)));
      }
      
      // Calculate cursor position for this progress
      const seed = trail.points[0]?.x + trail.points[0]?.y || 0;
      const variedTrailPoints = applyStyleVariations(trail.points, settings.trailStyle, seed, settings.chaosIntensity || 1.0);
      
      const totalVariedPoints = variedTrailPoints.length;
      const originalToVariedRatio = totalVariedPoints / trail.points.length;
      const exactVariedPosition = (trail.points.length - 1) * trailProgress * originalToVariedRatio;
      const currentVariedIndex = Math.floor(exactVariedPosition);
      const variedProgressFraction = exactVariedPosition - currentVariedIndex;
      
      const pointsToDraw: Array<{ x: number; y: number }> = [];
      for (let i = 0; i <= Math.min(currentVariedIndex, totalVariedPoints - 1); i++) {
        pointsToDraw.push(variedTrailPoints[i]);
      }
      
      if (currentVariedIndex < totalVariedPoints - 1 && variedProgressFraction > 0) {
        const p1 = variedTrailPoints[currentVariedIndex];
        const p2 = variedTrailPoints[currentVariedIndex + 1];
        const interpolatedPoint = {
          x: p1.x + (p2.x - p1.x) * variedProgressFraction,
          y: p1.y + (p2.y - p1.y) * variedProgressFraction,
        };
        pointsToDraw.push(interpolatedPoint);
      }
      
      const cursorPosition = pointsToDraw.length > 0 
        ? pointsToDraw[pointsToDraw.length - 1]
        : variedTrailPoints[0] || { x: 0, y: 0 };

      // Check each click to see if we should spawn it
      trail.clicks.forEach((click, clickIndex) => {
        // Find where in the trail (0-1) this click should appear
        let clickPointIndex = 0;
        let minTimeDiff = Math.abs(trail.points[0]?.ts - click.ts);
        
        for (let i = 1; i < trail.points.length; i++) {
          const timeDiff = Math.abs(trail.points[i].ts - click.ts);
          if (timeDiff < minTimeDiff) {
            minTimeDiff = timeDiff;
            clickPointIndex = i;
          }
        }
        
        const clickProgress = trail.points.length > 1 
          ? clickPointIndex / (trail.points.length - 1) 
          : 0;
        
        const clickKey = `${trailIndex}-${clickIndex}`;
        const lastProgress = lastSpawnedProgress.current.get(clickKey) ?? -1;
        
        // Spawn if we just crossed the click's progress threshold
        if (lastProgress < clickProgress && trailProgress >= clickProgress) {
          // Update Map BEFORE spawning to prevent duplicates in same frame
          lastSpawnedProgress.current.set(clickKey, trailProgress);
          
          // Create click effect at cursor's current position
          const newEffect: ClickEffect = {
            id: `${trailIndex}-${clickIndex}-${Date.now()}`,
            x: cursorPosition.x,
            y: cursorPosition.y,
            color: trail.color,
            radiusFactor: Math.random(),
            durationFactor: Math.random(),
            startTime: Date.now(),
            trailIndex,
          };
          
          setActiveClickEffects(prev => [...prev, newEffect]);
        }
      });
    });

    // Reset tracking when animation loops
    if (animationProgress < 0.01) {
      lastSpawnedProgress.current.clear();
      setActiveClickEffects([]);
    }
  }, [animationProgress, settings.trailStyle, settings.chaosIntensity]); 
  // NOTE: Removed trails, timeRange, trailSchedule to prevent infinite re-runs
  // These are accessed via closure and are stable enough for click spawning

  // Don't clean up click effects - let them stay visible forever
  // They will naturally stop animating once they reach the animationStopPoint

  // Generate path with straight lines between points - like chalk drawing
  // Once drawn, lines NEVER change. This is the only truly stable approach.
  const generateStraightPath = (points: Array<{ x: number; y: number }>): string => {
    if (points.length < 2) return "";

    let path = `M ${points[0].x} ${points[0].y}`;

    // Draw straight lines between all points
    for (let i = 1; i < points.length; i++) {
      path += ` L ${points[i].x} ${points[i].y}`;
    }

    return path;
  };

  // Generate smooth path by interpolating extra points between data points
  // This creates smoother curves while maintaining stability
  const generateSmoothPath = (points: Array<{ x: number; y: number }>): string => {
    if (points.length < 2) return "";

    let path = `M ${points[0].x} ${points[0].y}`;

    // Add interpolated points between each pair for smoothness
    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      
      // Use quadratic curve with control point at current position
      // This creates smooth transitions
      path += ` Q ${p1.x} ${p1.y} ${(p1.x + p2.x) / 2} ${(p1.y + p2.y) / 2}`;
    }
    
    // Final segment to last point
    if (points.length > 1) {
      const lastPoint = points[points.length - 1];
      const secondLast = points[points.length - 2];
      path += ` Q ${secondLast.x} ${secondLast.y} ${lastPoint.x} ${lastPoint.y}`;
    }

    return path;
  };

  // Generate organic path with subtle, flowing variations
  // Mimics natural hand movement with gentle curves
  const generateOrganicPath = (points: Array<{ x: number; y: number }>): string => {
    if (points.length < 2) return "";

    // Seed random generator based on first point for consistency
    const seed = points[0].x + points[0].y;
    const seededRandom = (i: number) => {
      const x = Math.sin(seed + i * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    let path = `M ${points[0].x} ${points[0].y}`;

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      
      // Calculate direction perpendicular to the line for natural variation
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length > 0) {
        // Perpendicular direction (rotated 90 degrees)
        const perpX = -dy / length;
        const perpY = dx / length;
        
        // Add subtle perpendicular offset (1-3 pixels) for organic feel
        const perpOffset = (seededRandom(i) - 0.5) * 6;
        
        const controlX = (p1.x + p2.x) / 2 + perpX * perpOffset;
        const controlY = (p1.y + p2.y) / 2 + perpY * perpOffset;
        
        path += ` Q ${controlX} ${controlY} ${p2.x} ${p2.y}`;
      } else {
        path += ` L ${p2.x} ${p2.y}`;
      }
    }

    return path;
  };

  // Generate chaotic path with aggressive, sketchy variations
  // Multiple overlapping strokes like rapid sketching
  const generateChaoticPath = (points: Array<{ x: number; y: number }>): string => {
    if (points.length < 2) return "";

    const seed = points[0].x + points[0].y;
    const seededRandom = (i: number, offset: number = 0) => {
      const x = Math.sin(seed + i * 12.9898 + offset * 7.233) * 43758.5453;
      return x - Math.floor(x);
    };

    let path = `M ${points[0].x} ${points[0].y}`;

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];
      
      // Calculate segment properties
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      
      if (length > 0) {
        // Add multiple control points for sketchy effect
        const numSubSegments = Math.min(3, Math.ceil(length / 50));
        
        for (let j = 0; j < numSubSegments; j++) {
          const t = (j + 1) / (numSubSegments + 1);
          const midX = p1.x + dx * t;
          const midY = p1.y + dy * t;
          
          // Large random offsets in all directions (8-15 pixels)
          const offsetX = (seededRandom(i * 10 + j, 0) - 0.5) * 15;
          const offsetY = (seededRandom(i * 10 + j, 1) - 0.5) * 15;
          
          // Add angular variation for sketchy feel
          const angle = seededRandom(i * 10 + j, 2) * Math.PI * 2;
          const wobble = 8;
          const wobbleX = Math.cos(angle) * wobble;
          const wobbleY = Math.sin(angle) * wobble;
          
          const controlX = midX + offsetX + wobbleX;
          const controlY = midY + offsetY + wobbleY;
          
          const targetX = j === numSubSegments - 1 ? p2.x : midX + dx / (numSubSegments + 1);
          const targetY = j === numSubSegments - 1 ? p2.y : midY + dy / (numSubSegments + 1);
          
          path += ` Q ${controlX} ${controlY} ${targetX} ${targetY}`;
        }
      } else {
        path += ` L ${p2.x} ${p2.y}`;
      }
    }

    return path;
  };

  // Select path generator based on style
  const generatePath = (points: Array<{ x: number; y: number }>): string => {
    switch (settings.trailStyle) {
      case 'straight':
        return generateStraightPath(points);
      case 'smooth':
        return generateSmoothPath(points);
      case 'organic':
        return generateOrganicPath(points);
      case 'chaotic':
        return generateChaoticPath(points);
      default:
        return generateSmoothPath(points);
    }
  };

  // Apply style variations to points - creates new point array with variations baked in
  // This ensures cursor and path use the SAME varied points
  const applyStyleVariations = (
    points: Array<{ x: number; y: number }>,
    style: string,
    seed: number,
    chaosIntensity: number = 1.0
  ): Array<{ x: number; y: number }> => {
    if (points.length < 2 || style === 'straight' || style === 'smooth') {
      return points;
    }
    
    // Check cache first (only cache for organic/chaotic which are expensive)
    // Include chaos intensity in cache key
    const cacheKey = `${seed}-${style}-${points.length}-${chaosIntensity.toFixed(2)}`;
    const cached = variedPointsCache.current.get(cacheKey);
    if (cached) return cached;

    const seededRandom = (i: number, offset: number = 0) => {
      const x = Math.sin(seed + i * 12.9898 + offset * 7.233) * 43758.5453;
      return x - Math.floor(x);
    };

    const variedPoints: Array<{ x: number; y: number }> = [points[0]];

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      if (style === 'organic') {
        // Add subtle perpendicular variation
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length > 0) {
          const perpX = -dy / length;
          const perpY = dx / length;
          const perpOffset = (seededRandom(i) - 0.5) * 6;

          // Add a varied midpoint
          variedPoints.push({
            x: (p1.x + p2.x) / 2 + perpX * perpOffset,
            y: (p1.y + p2.y) / 2 + perpY * perpOffset,
          });
        }
        variedPoints.push(p2);
      } else if (style === 'chaotic') {
        // Add multiple varied points between each pair
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const numSubPoints = Math.min(3, Math.ceil(length / 50));

        for (let j = 1; j <= numSubPoints; j++) {
          const t = j / (numSubPoints + 1);
          const baseX = p1.x + dx * t;
          const baseY = p1.y + dy * t;

          // Random offsets scaled by chaos intensity
          // Base values: offsetRange = 15, wobble = 8
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

    // Cache the result for future frames
    variedPointsCache.current.set(cacheKey, variedPoints);
    
    // Limit cache size to prevent memory issues
    if (variedPointsCache.current.size > 200) {
      const firstKey = variedPointsCache.current.keys().next().value;
      variedPointsCache.current.delete(firstKey);
    }
    
    return variedPoints;
  };

  // Generate path from varied points using simple curves
  const generatePathFromVariedPoints = (
    points: Array<{ x: number; y: number }>,
    style: string
  ): string => {
    if (points.length < 2) return "";
    
    // Check cache - use first and last point positions as part of key
    // This ensures we get correct cached paths for partial trail rendering
    const cacheKey = `${style}-${points.length}-${points[0].x.toFixed(0)}-${points[0].y.toFixed(0)}-${points[points.length-1].x.toFixed(0)}-${points[points.length-1].y.toFixed(0)}`;
    const cached = pathCache.current.get(cacheKey);
    if (cached) return cached;

    let path = `M ${points[0].x} ${points[0].y}`;

    if (style === 'straight') {
      // Straight lines
      for (let i = 1; i < points.length; i++) {
        path += ` L ${points[i].x} ${points[i].y}`;
      }
    } else {
      // Smooth curves through the varied points
      for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];
        
        // Use quadratic curve with control at p1
        path += ` Q ${p1.x} ${p1.y} ${(p1.x + p2.x) / 2} ${(p1.y + p2.y) / 2}`;
      }
      
      // Final segment to last point
      if (points.length > 1) {
        const lastPoint = points[points.length - 1];
        const secondLast = points[points.length - 2];
        path += ` Q ${secondLast.x} ${secondLast.y} ${lastPoint.x} ${lastPoint.y}`;
      }
    }

    // Cache the generated path
    pathCache.current.set(cacheKey, path);
    
    // Limit cache size to prevent memory bloat
    if (pathCache.current.size > 500) {
      const firstKey = pathCache.current.keys().next().value;
      pathCache.current.delete(firstKey);
    }
    
    return path;
  };

  // Memoized Trail Component to prevent unnecessary re-renders
  const Trail = memo(({ 
    trail, 
    trailIndex,
    schedule,
    animationProgress,
    timeRange,
    settings: trailSettings 
  }: {
    trail: Trail;
    trailIndex: number;
    schedule: any;
    animationProgress: number;
    timeRange: { min: number; max: number; duration: number };
    settings: {
      trailStyle: string;
      strokeWidth: number;
      pointSize: number;
      trailOpacity: number;
      chaosIntensity?: number;
    };
  }) => {
    if (trail.points.length < 2 || !schedule) return null;

    // Calculate if this trail should be visible based on animation progress
    const normalizedStart = timeRange.duration > 0 
      ? (schedule.startTime - timeRange.min) / timeRange.duration 
      : 0;
    const normalizedEnd = timeRange.duration > 0 
      ? (schedule.endTime - timeRange.min) / timeRange.duration 
      : 1;
    
    // Wrap normalized values to [0, 1] range for looping
    const wrappedStart = normalizedStart % 1;
    const normalizedDuration = normalizedEnd - normalizedStart;
    const wrappedEnd = (wrappedStart + normalizedDuration) % 1;
    
    // Check if animation has started for this trail
    let hasStarted = false;
    if (wrappedEnd > wrappedStart) {
      hasStarted = animationProgress >= wrappedStart;
    } else {
      hasStarted = true;
    }
    
    if (!hasStarted) return null;

    // Pre-calculate varied points based on style (seed from first point)
    const seed = trail.points[0]?.x + trail.points[0]?.y || 0;
    const variedTrailPoints = applyStyleVariations(trail.points, trailSettings.trailStyle, seed, trailSettings.chaosIntensity || 1.0);
    
    const cursorSize = 32;

    // Calculate how much of the trail should be visible
    let trailProgress: number;
    if (wrappedEnd > wrappedStart) {
      if (animationProgress >= wrappedEnd) {
        trailProgress = 1;
      } else {
        trailProgress = Math.max(0, Math.min(1, (animationProgress - wrappedStart) / normalizedDuration));
      }
    } else {
      const adjustedProgress = animationProgress >= wrappedStart 
        ? animationProgress - wrappedStart 
        : 1 - wrappedStart + animationProgress;
      trailProgress = Math.max(0, Math.min(1, adjustedProgress / normalizedDuration));
    }
    
    const totalVariedPoints = variedTrailPoints.length;
    const originalToVariedRatio = totalVariedPoints / trail.points.length;
    const exactVariedPosition = (trail.points.length - 1) * trailProgress * originalToVariedRatio;
    const currentVariedIndex = Math.floor(exactVariedPosition);
    const variedProgress = exactVariedPosition - currentVariedIndex;
    
    const pointsToDraw: Array<{ x: number; y: number }> = [];
    
    for (let i = 0; i <= Math.min(currentVariedIndex, totalVariedPoints - 1); i++) {
      pointsToDraw.push(variedTrailPoints[i]);
    }
    
    if (currentVariedIndex < totalVariedPoints - 1 && variedProgress > 0) {
      const p1 = variedTrailPoints[currentVariedIndex];
      const p2 = variedTrailPoints[currentVariedIndex + 1];
      const interpolatedPoint = {
        x: p1.x + (p2.x - p1.x) * variedProgress,
        y: p1.y + (p2.y - p1.y) * variedProgress,
      };
      pointsToDraw.push(interpolatedPoint);
    }
    
    const cursorPosition = pointsToDraw.length > 0 
      ? pointsToDraw[pointsToDraw.length - 1]
      : variedTrailPoints[0] || { x: 0, y: 0 };
    
    const visiblePathData = pointsToDraw.length >= 2 
      ? generatePathFromVariedPoints(pointsToDraw, settings.trailStyle) 
      : "";
    
    // Use pointsToDraw for dots so they match the cursor and path exactly
    // Don't use trail.points because that doesn't account for style variations
    const visibleDots = pointsToDraw.slice(0, -1); // Exclude last point (cursor is there)
    
    // Get cursor type at current position
    const currentPointIndex = Math.min(
      Math.floor((trail.points.length - 1) * trailProgress),
      trail.points.length - 1
    );
    const currentCursorType = trail.points[currentPointIndex]?.cursor;
    const CursorComponent = getCursorComponent(currentCursorType);

    return (
      <g key={`trail-${trailIndex}`}>
        {visiblePathData && (
          <path
            d={visiblePathData}
            fill="none"
            stroke={trail.color}
            strokeWidth={settings.strokeWidth}
            opacity={trail.opacity}
            style={{ mixBlendMode: "multiply" }}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        
        {settings.pointSize > 0 && visibleDots.map((point, pointIndex) => (
          <circle
            key={`point-${trailIndex}-${pointIndex}`}
            cx={point.x}
            cy={point.y}
            r={settings.pointSize / 2}
            fill={trail.color}
            opacity={trail.opacity * 0.6}
            style={{ mixBlendMode: "multiply" }}
          />
        ))}

        {trailProgress > 0 && trailProgress < 1 && (
          <g transform={`translate(${cursorPosition.x}, ${cursorPosition.y})`}>
            {/* Offset to align cursor tip with position - Default cursor tip is at (12, 4) in 24px system, scaled to 32px */}
            <g transform={`translate(${-12 * (cursorSize / 24)}, ${-4 * (cursorSize / 24)})`}>
              <CursorComponent color={trail.color} size={cursorSize} />
            </g>
          </g>
        )}
      </g>
    );
  }, (prevProps, nextProps) => {
    // Custom comparison function - only re-render if these specific props change
    return (
      prevProps.animationProgress === nextProps.animationProgress &&
      prevProps.settings.trailStyle === nextProps.settings.trailStyle &&
      prevProps.settings.strokeWidth === nextProps.settings.strokeWidth &&
      prevProps.settings.pointSize === nextProps.settings.pointSize &&
      prevProps.trail === nextProps.trail
    );
  });

  return (
    <div className="internet-movement">
      {controlsVisible && (
        <div className="controls">
        <div className="control-group">
          <label htmlFor="trail-opacity">Trail Opacity</label>
          <input
            id="trail-opacity"
            type="range"
            min="0.1"
            max="1"
            step="0.1"
            value={settings.trailOpacity}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                trailOpacity: parseFloat(e.target.value),
              }))
            }
          />
          <span>{settings.trailOpacity.toFixed(1)}</span>
        </div>

        <div className="control-group">
          <label htmlFor="stroke-width">Stroke Width</label>
          <input
            id="stroke-width"
            type="range"
            min="0.5"
            max="20"
            step="0.5"
            value={settings.strokeWidth}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                strokeWidth: parseFloat(e.target.value),
              }))
            }
          />
          <span>{settings.strokeWidth.toFixed(1)}px</span>
        </div>

        <div className="control-group">
          <label htmlFor="point-size">Point Size</label>
          <input
            id="point-size"
            type="range"
            min="0"
            max="20"
            step="0.5"
            value={settings.pointSize}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                pointSize: parseFloat(e.target.value),
              }))
            }
          />
          <span>{settings.pointSize.toFixed(1)}px</span>
        </div>

        <div className="control-group">
          <label htmlFor="animation-speed">Animation Speed</label>
          <input
            id="animation-speed"
            type="range"
            min="0.1"
            max="10"
            step="0.1"
            value={settings.animationSpeed}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                animationSpeed: parseFloat(e.target.value),
              }))
            }
          />
          <span>{settings.animationSpeed.toFixed(1)}x</span>
        </div>

        <div className="control-group">
          <label htmlFor="trail-style">Trail Style</label>
          <select
            id="trail-style"
            value={settings.trailStyle}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                trailStyle: e.target.value as 'straight' | 'smooth' | 'organic' | 'chaotic',
              }))
            }
          >
            <option value="straight">Straight (Geometric)</option>
            <option value="smooth">Smooth (Curved)</option>
            <option value="organic">Organic (Subtle Variation)</option>
            <option value="chaotic">Chaotic (Sketchy)</option>
          </select>
        </div>

        {settings.trailStyle === 'chaotic' && (
          <div className="control-group">
            <label htmlFor="chaos-intensity">Chaos Intensity</label>
            <input
              id="chaos-intensity"
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              value={settings.chaosIntensity || 1.0}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  chaosIntensity: parseFloat(e.target.value),
                }))
              }
            />
            <span>{(settings.chaosIntensity || 1.0).toFixed(1)}x</span>
          </div>
        )}

        <div className="control-group">
          <label htmlFor="max-concurrent">Max Concurrent Trails</label>
          <input
            id="max-concurrent"
            type="range"
            min="1"
            max="20"
            step="1"
            value={settings.maxConcurrentTrails}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                maxConcurrentTrails: parseInt(e.target.value, 10),
              }))
            }
          />
          <span>{settings.maxConcurrentTrails}</span>
        </div>

        <div className="control-group">
          <label htmlFor="animation-mode">Animation Mode</label>
          <select
            id="animation-mode"
            value={settings.trailAnimationMode}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                trailAnimationMode: e.target.value as 'natural' | 'stagger',
              }))
            }
          >
            <option value="natural">Natural (Actual Timestamps)</option>
            <option value="stagger">Stagger (Choreographed)</option>
          </select>
        </div>

        {settings.trailAnimationMode === 'stagger' && (
          <>
            <div className="control-group">
              <label htmlFor="overlap-factor">Overlap Factor</label>
              <input
                id="overlap-factor"
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={settings.overlapFactor}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    overlapFactor: parseFloat(e.target.value),
                  }))
                }
              />
              <span>{settings.overlapFactor.toFixed(1)}</span>
            </div>

            <div className="control-group">
              <label htmlFor="min-gap">Min Gap Between Trails</label>
              <input
                id="min-gap"
                type="range"
                min="0.1"
                max="10"
                step="0.1"
                value={settings.minGapBetweenTrails}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    minGapBetweenTrails: parseFloat(e.target.value),
                  }))
                }
              />
              <span>{settings.minGapBetweenTrails.toFixed(1)}s</span>
            </div>
          </>
        )}

        <div className="control-group">
          <label>Event Filter</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
            <label style={{ fontSize: '12px', fontWeight: 'normal', textTransform: 'none' }}>
              <input
                type="checkbox"
                checked={settings.eventFilter.move}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    eventFilter: { ...s.eventFilter, move: e.target.checked },
                  }))
                }
                style={{ marginRight: '6px' }}
              />
              Move Events
            </label>
            <label style={{ fontSize: '12px', fontWeight: 'normal', textTransform: 'none' }}>
              <input
                type="checkbox"
                checked={settings.eventFilter.click}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    eventFilter: { ...s.eventFilter, click: e.target.checked },
                  }))
                }
                style={{ marginRight: '6px' }}
              />
              Click Events
            </label>
            <label style={{ fontSize: '12px', fontWeight: 'normal', textTransform: 'none' }}>
              <input
                type="checkbox"
                checked={settings.eventFilter.hold}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    eventFilter: { ...s.eventFilter, hold: e.target.checked },
                  }))
                }
                style={{ marginRight: '6px' }}
              />
              Hold Events
            </label>
            <label style={{ fontSize: '12px', fontWeight: 'normal', textTransform: 'none' }}>
              <input
                type="checkbox"
                checked={settings.eventFilter.cursor_change}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    eventFilter: { ...s.eventFilter, cursor_change: e.target.checked },
                  }))
                }
                style={{ marginRight: '6px' }}
              />
              Cursor Change Events
            </label>
          </div>
        </div>

        <div className="control-group">
          <label htmlFor="randomize-colors">
            <input
              id="randomize-colors"
              type="checkbox"
              checked={settings.randomizeColors}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  randomizeColors: e.target.checked,
                }))
              }
              style={{ marginRight: '8px' }}
            />
            Randomize Colors (Test Mode)
          </label>
        </div>

        <div style={{ fontSize: '10px', opacity: 0.5, marginTop: '8px', fontStyle: 'italic' }}>
          Tip: Double-tap 'D' to hide/show controls
        </div>

        <button onClick={fetchEvents} disabled={loading}>
          {loading ? "Loading..." : "Refresh Data"}
        </button>

        {error && <div className="error">{error}</div>}
        {!loading && events.length > 0 && (
          <div className="info">
            {events.length.toLocaleString()} events, {trails.length.toLocaleString()} trails
            <br />
            <div style={{ fontSize: "10px", marginTop: "4px", opacity: 0.7 }}>
              Move: {events.filter(e => !e.data.event || e.data.event === 'move').length} | 
              Click: {events.filter(e => e.data.event === 'click').length} | 
              Hold: {events.filter(e => e.data.event === 'hold').length} | 
              Cursor Change: {events.filter(e => e.data.event === 'cursor_change').length}
            </div>
            <span style={{ fontSize: "11px" }}>
              Progress: {(animationProgress * 100).toFixed(0)}%
            </span>
            {timeRange.duration > 0 && (
              <div style={{ fontSize: "10px", marginTop: "4px", opacity: 0.7 }}>
                Duration: {(timeRange.duration / 1000 / 60).toFixed(1)} min
                {settings.animationSpeed !== 1 && ` (${settings.animationSpeed}x speed)`}
                <br />
                Active trails: {trails.filter((t, idx) => {
                  const schedule = trailSchedule[idx];
                  if (!schedule) return false;
                  const normalizedStart = (schedule.startTime - timeRange.min) / timeRange.duration;
                  const normalizedEnd = (schedule.endTime - timeRange.min) / timeRange.duration;
                  const wrappedStart = normalizedStart % 1;
                  const wrappedEnd = (wrappedStart + (normalizedEnd - normalizedStart)) % 1;
                  let hasStarted = false;
                  if (wrappedEnd > wrappedStart) {
                    hasStarted = animationProgress >= wrappedStart;
                  } else {
                    hasStarted = true;
                  }
                  return hasStarted && animationProgress <= normalizedEnd;
                }).length}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      <div className="canvas-container" ref={containerRef}>
        <RisoPattern />
        <svg
          className="trails-svg"
          width="100%"
          height="100%"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            pointerEvents: "none",
          }}
        >
          {trails.map((trail, trailIndex) => (
            <Trail
              key={`trail-${trailIndex}`}
              trail={trail}
              trailIndex={trailIndex}
              schedule={trailSchedule[trailIndex]}
              animationProgress={animationProgress}
              timeRange={timeRange}
              settings={settings}
            />
          ))}
          {activeClickEffects.map((effect) => (
            <RippleEffect
              key={effect.id}
              effect={effect}
              settings={{
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
          ))}
        </svg>
      </div>
    </div>
  );
};

// Render the component
ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(<InternetMovement />);
// Render the component
ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(<InternetMovement />);
