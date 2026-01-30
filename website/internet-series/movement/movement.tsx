// ABOUTME: Main coordinator component for the Internet Movement visualization
// ABOUTME: Handles data fetching, trail computation, and delegates rendering to child components
import "./movement.scss";
import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import ReactDOM from "react-dom/client";
import {
  CollectionEvent,
  Trail,
  TrailState,
  KeyboardEventData,
  TypingAction,
  TypingAnimation,
  TypingState,
  ScrollAnimation,
  ViewportSize,
  ScrollViewportState,
} from "./types";
import { Controls } from "./Controls";
import { AnimatedTrails } from "./AnimatedTrails";
import { AnimatedTyping } from "./AnimatedTyping";
import { AnimatedScrollViewports } from "./AnimatedScrollViewports";

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

const API_URL =
  "https://playhtml-game-api.spencerc99.workers.dev/events/recent";
const TRAIL_TIME_THRESHOLD = 300000; // 5 minutes
const SCROLL_SESSION_THRESHOLD = 900000; // 15 minutes
const SCROLL_TIME_COMPRESSION = 0.1; // Compress scroll timing to 10% of real time
const MAX_VIEWPORT_ANIMATION_DURATION = 30000; // Cap each viewport animation at 30 seconds

const SETTINGS_STORAGE_KEY = "internet-movement-settings";

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

function discoverViewportSizes(events: CollectionEvent[]): ViewportSize[] {
  const sizeMap = new Map<string, ViewportSize>();

  events.forEach((event) => {
    const width = event.meta.vw;
    const height = event.meta.vh;
    const key = `${width}×${height}`;

    if (!sizeMap.has(key)) {
      sizeMap.set(key, { width, height, key, count: 0 });
    }
    sizeMap.get(key)!.count++;
  });

  return Array.from(sizeMap.values());
}

function packViewportsIntoCanvas(
  sizes: ViewportSize[],
  canvasWidth: number,
  canvasHeight: number,
  layoutSeed: number = 0,
): Map<string, { x: number; y: number; width: number; height: number }> {
  // Mondrian-inspired packing (golden-ratio recursive splitting).
  // Goal: cohesive single composition with tiny, consistent gutters and NO overlaps.
  //
  // IMPORTANT: We intentionally *do not* try to preserve real viewport sizes here.
  // The visualization reads better when the overall mosaic is composed first,
  // then individual viewports are assigned into the mosaic cells.

  const seed = hashParticipantId(sizes[0]?.key || "default") + layoutSeed;
  let randomSeed = seed;
  const seededRandom = () => {
    randomSeed = (randomSeed * 9301 + 49297) % 233280;
    return randomSeed / 233280;
  };

  const clamp = (v: number, min: number, max: number) =>
    Math.max(min, Math.min(max, v));

  const PHI = 0.6180339887498948; // golden ratio conjugate
  const N = Math.max(0, sizes.length);

  // NO GAPS - seamless edge-to-edge composition
  const gutter = 0;
  const margin = 0;

  // Prevent pathological tiny slivers.
  const minCellW = clamp(Math.round(canvasWidth * 0.1), 100, 300);
  const minCellH = clamp(Math.round(canvasHeight * 0.1), 100, 300);

  type Rect = { x: number; y: number; width: number; height: number };

  const area = (r: Rect) => r.width * r.height;

  // Distance from center - prefer splitting rects closer to center
  const centerDist = (r: Rect) => {
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const rectCx = r.x + r.width / 2;
    const rectCy = r.y + r.height / 2;
    return Math.sqrt((rectCx - cx) ** 2 + (rectCy - cy) ** 2);
  };

  const canSplitVert = (r: Rect) => r.width >= minCellW * 2;
  const canSplitHorz = (r: Rect) => r.height >= minCellH * 2;

  const splitRect = (r: Rect): Rect[] | null => {
    const w = r.width;
    const h = r.height;
    const preferVertical = w / Math.max(1, h) > 1.15;
    const preferHorizontal = h / Math.max(1, w) > 1.15;

    // Decide split orientation:
    // - If very wide, prefer vertical; if very tall, prefer horizontal.
    // - Otherwise, a slight bias based on area to avoid repetitive patterns.
    let splitVertical: boolean;
    if (preferVertical && canSplitVert(r)) splitVertical = true;
    else if (preferHorizontal && canSplitHorz(r)) splitVertical = false;
    else if (canSplitVert(r) && canSplitHorz(r)) {
      splitVertical = seededRandom() < 0.55;
    } else if (canSplitVert(r)) splitVertical = true;
    else if (canSplitHorz(r)) splitVertical = false;
    else return null;

    // Choose a ratio around golden ratio, with small jitter.
    // We sometimes flip to (1 - PHI) to get more size variety.
    const ratioBase = seededRandom() < 0.35 ? 1 - PHI : PHI; // 0.382 or 0.618
    const jitter = (seededRandom() - 0.5) * 0.16; // ±0.08
    const ratio = clamp(ratioBase + jitter, 0.32, 0.68);

    if (splitVertical) {
      const leftW = Math.round(w * ratio);
      const rightW = w - leftW;
      if (leftW < minCellW || rightW < minCellW) return null;
      return [
        { x: r.x, y: r.y, width: leftW, height: h },
        { x: r.x + leftW, y: r.y, width: rightW, height: h },
      ];
    } else {
      const topH = Math.round(h * ratio);
      const bottomH = h - topH;
      if (topH < minCellH || bottomH < minCellH) return null;
      return [
        { x: r.x, y: r.y, width: w, height: topH },
        { x: r.x, y: r.y + topH, width: w, height: bottomH },
      ];
    }
  };

  // Start with full canvas - no margins, edge-to-edge
  const root: Rect = {
    x: 0,
    y: 0,
    width: canvasWidth,
    height: canvasHeight,
  };

  const rects: Rect[] = [root];

  // Greedy: repeatedly split the largest area rect closest to center until we have enough cells.
  // Prefer splitting rects closer to center to compact towards center.
  // This guarantees a cohesive “single unit” and avoids overlaps by construction.
  const maxIterations = N * 12 + 40;
  for (let iter = 0; iter < maxIterations && rects.length < N; iter++) {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      if (!canSplitVert(r) && !canSplitHorz(r)) continue;

      // Score: prioritize large areas AND closeness to center
      const a = area(r);
      const dist = centerDist(r);
      const maxDist = Math.sqrt(
        (canvasWidth / 2) ** 2 + (canvasHeight / 2) ** 2,
      );
      const centerScore = 1 - dist / maxDist; // 1 = center, 0 = edge
      const score = a * (0.7 + 0.3 * centerScore); // Weight area more, but favor center

      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    if (bestIdx === -1) break;

    const target = rects[bestIdx];
    const split = splitRect(target);
    if (!split) {
      // Mark as unsplittable by shrinking slightly; prevents getting stuck on it.
      rects[bestIdx] = {
        ...target,
        width: target.width * 0.999,
        height: target.height * 0.999,
      };
      continue;
    }

    rects.splice(bestIdx, 1, split[0], split[1]);
  }

  // If we generated fewer cells than needed, just reuse (still deterministic).
  // Visual goal > strict 1:1 mapping.
  const cells: Rect[] =
    rects.length >= N
      ? rects.slice(0, N)
      : Array.from(
          { length: N },
          (_, i) => rects[i % Math.max(1, rects.length)],
        );

  // Assign cells to the incoming sizes (stable order: input order).
  const layout = new Map<string, Rect>();
  for (let i = 0; i < sizes.length; i++) {
    const cell = cells[i];
    layout.set(sizes[i].key, {
      x: clamp(cell.x, 0, canvasWidth),
      y: clamp(cell.y, 0, canvasHeight),
      width: clamp(cell.width, 0, canvasWidth - cell.x),
      height: clamp(cell.height, 0, canvasHeight - cell.y),
    });
  }

  // Post-process: expand rectangles to fill any gaps
  // This ensures seamless edge-to-edge coverage
  const fillGaps = () => {
    const rects = Array.from(layout.values());

    // Sort by position (top-to-bottom, left-to-right)
    rects.sort((a, b) => {
      if (Math.abs(a.y - b.y) < 1) return a.x - b.x;
      return a.y - b.y;
    });

    // Expand rectangles to fill horizontal gaps
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      let rightEdge = r.x + r.width;

      // Find the closest rectangle to the right on the same row
      for (let j = 0; j < rects.length; j++) {
        if (i === j) continue;
        const other = rects[j];

        // Check if on same row (y overlap) and to the right
        const yOverlap = !(
          r.y + r.height <= other.y || other.y + other.height <= r.y
        );
        if (yOverlap && other.x > r.x && other.x < rightEdge + 10) {
          // Gap detected - expand this rectangle to fill it
          const gap = other.x - rightEdge;
          if (gap > 0 && gap < 20) {
            // Only fill small gaps (< 20px)
            r.width += gap;
            rightEdge = r.x + r.width;
          }
        }
      }

      // Also expand to fill edge gaps (reach canvas edge)
      if (rightEdge < canvasWidth) {
        // Check if any rect starts after this one's right edge on same row
        let hasNeighbor = false;
        for (let j = 0; j < rects.length; j++) {
          if (i === j) continue;
          const other = rects[j];
          const yOverlap = !(
            r.y + r.height <= other.y || other.y + other.height <= r.y
          );
          if (yOverlap && other.x >= rightEdge) {
            hasNeighbor = true;
            break;
          }
        }
        if (!hasNeighbor && rightEdge < canvasWidth - 1) {
          // Fill to edge
          r.width = canvasWidth - r.x;
        }
      }
    }

    // Expand rectangles to fill vertical gaps
    for (let i = 0; i < rects.length; i++) {
      const r = rects[i];
      let bottomEdge = r.y + r.height;

      // Find the closest rectangle below on the same column
      for (let j = 0; j < rects.length; j++) {
        if (i === j) continue;
        const other = rects[j];

        // Check if on same column (x overlap) and below
        const xOverlap = !(
          r.x + r.width <= other.x || other.x + other.width <= r.x
        );
        if (xOverlap && other.y > r.y && other.y < bottomEdge + 10) {
          // Gap detected - expand this rectangle to fill it
          const gap = other.y - bottomEdge;
          if (gap > 0 && gap < 20) {
            // Only fill small gaps (< 20px)
            r.height += gap;
            bottomEdge = r.y + r.height;
          }
        }
      }

      // Also expand to fill edge gaps (reach canvas edge)
      if (bottomEdge < canvasHeight) {
        // Check if any rect starts after this one's bottom edge on same column
        let hasNeighbor = false;
        for (let j = 0; j < rects.length; j++) {
          if (i === j) continue;
          const other = rects[j];
          const xOverlap = !(
            r.x + r.width <= other.x || other.x + other.width <= r.x
          );
          if (xOverlap && other.y >= bottomEdge) {
            hasNeighbor = true;
            break;
          }
        }
        if (!hasNeighbor && bottomEdge < canvasHeight - 1) {
          // Fill to edge
          r.height = canvasHeight - r.y;
        }
      }
    }
  };

  fillGaps();

  return layout;
}

const loadSettings = () => {
  const defaults = {
    trailOpacity: 0.7,
    strokeWidth: 5,
    pointSize: 4,
    animationSpeed: 1,
    trailStyle: "chaotic" as "straight" | "smooth" | "organic" | "chaotic",
    maxConcurrentTrails: 5,
    trailAnimationMode: "stagger" as "natural" | "stagger",
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
      viewport: false,
    },
    viewportEventFilter: {
      scroll: true,
      resize: true,
      zoom: true,
    },
    domainFilter: "",
    scrollSpeed: 1.0,
    backgroundOpacity: 0.7,
    maxConcurrentScrolls: 5, // Allow 5 concurrent scroll animations
    scrollOverlapFactor: 0.8, // Higher overlap for more simultaneous animations
    minViewports: 10, // Minimum number of viewports in layout
    maxViewports: 50, // Maximum number of viewports in layout
    keyboardOverlapFactor: 0.9,
    textboxOpacity: 0.2,
    keyboardMinFontSize: 12,
    keyboardMaxFontSize: 18,
    keyboardShowCaret: true,
    keyboardAnimationSpeed: 0.5, // Slower typing speed (0.5 = half speed)
    keyboardPositionRandomness: 0.3, // 0-1 range, determines spread of position offsets
    keyboardRandomizeOrder: false, // Randomize the order of keyboard animations
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
        viewportEventFilter: {
          ...defaults.viewportEventFilter,
          ...(parsed.viewportEventFilter || {}),
        },
      };
    }
  } catch (err) {
    console.error("Failed to load settings from localStorage:", err);
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
      console.error("Failed to save settings to localStorage:", err);
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
        limit: "5000",
      });

      // Fetch cursor and keyboard events in parallel
      const promises: Promise<CollectionEvent[]>[] = [];

      if (settings.eventTypeFilter.cursor) {
        promises.push(
          fetch(`${API_URL}?${params.toString()}&type=cursor`)
            .then((res) => {
              if (!res.ok)
                throw new Error(`Failed to fetch cursor events: ${res.status}`);
              return res.json();
            })
            .then((events) => {
              console.log(`[Fetch] Received ${events.length} cursor events`);
              return events;
            }),
        );
      }

      if (settings.eventTypeFilter.keyboard) {
        promises.push(
          fetch(`${API_URL}?${params.toString()}&type=keyboard`)
            .then((res) => {
              if (!res.ok)
                throw new Error(
                  `Failed to fetch keyboard events: ${res.status}`,
                );
              return res.json();
            })
            .then((events) => {
              console.log(`[Fetch] Received ${events.length} keyboard events`);
              console.log(events.map((e) => e.data.sequence));
              return events;
            }),
        );
      }

      if (settings.eventTypeFilter.viewport) {
        promises.push(
          fetch(`${API_URL}?${params.toString()}&type=viewport`).then((res) => {
            if (!res.ok)
              throw new Error(`Failed to fetch viewport events: ${res.status}`);
            return res.json();
          }),
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

      if (e.key === "d" || e.key === "D") {
        if (now - lastDKeyTime < DOUBLE_TAP_THRESHOLD) {
          setControlsVisible((prev) => !prev);
          lastDKeyTime = 0;
        } else {
          lastDKeyTime = now;
        }
      } else if (e.key === "r" || e.key === "R") {
        if (now - lastRKeyTime < DOUBLE_TAP_THRESHOLD) {
          fetchEvents();
          lastRKeyTime = 0;
        } else {
          lastRKeyTime = now;
        }
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
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
    if (!url) return "";
    try {
      const urlObj = new URL(url.startsWith("http") ? url : `https://${url}`);
      return urlObj.hostname.replace("www.", "");
    } catch {
      return "";
    }
  };

  const availableDomains = useMemo(() => {
    const domains = new Set<string>();
    events.forEach((event) => {
      const domain = extractDomain(event.meta.url || "");
      if (domain) {
        domains.add(domain);
      }
    });
    return Array.from(domains).sort();
  }, [events]);

  // Clear domain filter if it's not in available domains (only when events change)
  useEffect(() => {
    if (
      events.length > 0 &&
      settings.domainFilter &&
      availableDomains.length > 0 &&
      !availableDomains.includes(settings.domainFilter)
    ) {
      console.log(
        `[Domain Filter] Clearing filter for "${settings.domainFilter}" - not found in available domains`,
      );
      setSettings((s) => ({ ...s, domainFilter: "" }));
    }
  }, [events.length]); // Only depend on events.length to prevent loops

  const trails = useMemo(() => {
    const sizeToUse =
      initialViewportSize.current.width > 0
        ? initialViewportSize.current
        : viewportSize;

    if (events.length === 0 || sizeToUse.width === 0) {
      return [];
    }

    const filteredEvents = settings.domainFilter
      ? events.filter((event) => {
          const eventDomain = extractDomain(event.meta.url || "");
          return eventDomain === settings.domainFilter;
        })
      : events;

    const participantColors = new Map<string, string>();
    const trails: Trail[] = [];
    const eventsByParticipantAndUrl = new Map<string, CollectionEvent[]>();

    filteredEvents.forEach((event) => {
      if (
        !event.data ||
        typeof event.data.x !== "number" ||
        typeof event.data.y !== "number"
      ) {
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

      let currentTrail: Array<{
        x: number;
        y: number;
        ts: number;
        cursor?: string;
      }> = [];
      let currentClicks: Array<{
        x: number;
        y: number;
        ts: number;
        button?: number;
        duration?: number;
      }> = [];
      let lastTimestamp = 0;

      groupEvents.forEach((event) => {
        const eventType = event.data.event || "move";

        if (eventType === "move" && !settings.eventFilter.move) return;
        if (eventType === "click" && !settings.eventFilter.click) return;
        if (eventType === "hold" && !settings.eventFilter.hold) return;
        if (
          eventType === "cursor_change" &&
          !settings.eventFilter.cursor_change
        )
          return;

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
        const isClick = eventType === "click";
        const isHold = eventType === "hold";
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
            currentClicks.push({
              x,
              y,
              ts: event.ts,
              button: event.data.button,
            });
          } else if (isHold) {
            currentClicks.push({
              x,
              y,
              ts: event.ts,
              button: event.data.button,
              duration: event.data.duration,
            });
          }
        } else {
          currentTrail.push({ x, y, ts: event.ts, cursor: cursorType });

          if (isClick) {
            currentClicks.push({
              x,
              y,
              ts: event.ts,
              button: event.data.button,
            });
          } else if (isHold) {
            currentClicks.push({
              x,
              y,
              ts: event.ts,
              button: event.data.button,
              duration: event.data.duration,
            });
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
  }, [
    events,
    settings.randomizeColors,
    settings.domainFilter,
    settings.eventFilter,
    viewportSize,
  ]);

  // Extract keyboard events before calculating timeRange
  const keyboardEvents = useMemo(() => {
    return events.filter((e) => e.type === "keyboard");
  }, [events]);

  // Extract viewport events
  const viewportEvents = useMemo(() => {
    return events.filter((e) => e.type === "viewport");
  }, [events]);

  const { timeRange, trailSchedule } = useMemo(() => {
    // Collect times from trails, keyboard, and viewport events to calculate global timeRange
    const allTimes: number[] = [];

    if (trails.length > 0) {
      allTimes.push(...trails.flatMap((t) => [t.startTime, t.endTime]));
    }

    if (keyboardEvents.length > 0) {
      allTimes.push(...keyboardEvents.map((e) => e.ts));
    }

    if (viewportEvents.length > 0) {
      allTimes.push(...viewportEvents.map((e) => e.ts));
    }

    if (allTimes.length === 0) {
      return {
        timeRange: { min: 0, max: 0, duration: 0 },
        trailSchedule: [],
      };
    }

    const min = Math.min(...allTimes);
    const max = Math.max(...allTimes);
    const dataDuration = max - min;

    if (trails.length === 0) {
      // Only keyboard events - use simple duration
      const duration = Math.max(dataDuration, 60000);
      return {
        timeRange: { min, max, duration },
        trailSchedule: [],
      };
    }

    const avgDuration =
      trails.reduce((sum, t) => sum + (t.endTime - t.startTime), 0) /
      trails.length;
    const minGapMs = settings.minGapBetweenTrails * 1000;
    const overlapMultiplier = 1 - settings.overlapFactor * 0.8;
    const baseSpacing =
      (avgDuration / settings.maxConcurrentTrails) * overlapMultiplier;
    const actualSpacing = Math.max(minGapMs, baseSpacing);

    const totalTimeNeeded = trails.length * actualSpacing;
    const cycleDuration = Math.max(
      totalTimeNeeded,
      dataDuration > 0 ? dataDuration : 60000,
    );

    const trailsByColor = new Map<string, number[]>();
    trails.forEach((trail, index) => {
      if (!trailsByColor.has(trail.color)) {
        trailsByColor.set(trail.color, []);
      }
      trailsByColor.get(trail.color)!.push(index);
    });

    const colorGroups = Array.from(trailsByColor.values());
    const orderedIndices: number[] = [];
    let maxGroupSize = Math.max(...colorGroups.map((g) => g.length));

    for (let i = 0; i < maxGroupSize; i++) {
      for (const group of colorGroups) {
        if (i < group.length) {
          orderedIndices.push(group[i]);
        }
      }
    }

    const schedule = trails.map((trail, originalIndex) => {
      if (settings.trailAnimationMode === "natural") {
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
        const timeOffset = min + startOffset - trail.startTime;

        const adjustedClicks = trail.clicks.map((click) => ({
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
      trailSchedule: schedule,
    };
  }, [
    trails,
    keyboardEvents,
    viewportEvents,
    settings.trailAnimationMode,
    settings.maxConcurrentTrails,
    settings.overlapFactor,
    settings.minGapBetweenTrails,
  ]);

  const applyStyleVariations = useCallback(
    (
      points: Array<{ x: number; y: number }>,
      style: string,
      seed: number,
      chaosIntensity: number = 1.0,
    ): Array<{ x: number; y: number }> => {
      if (points.length < 2 || style === "straight" || style === "smooth") {
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

        if (style === "organic") {
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
        } else if (style === "chaotic") {
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
    },
    [],
  );

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
        settings.chaosIntensity || 1.0,
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

        const progress =
          trail.points.length > 1
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
  }, [
    trails,
    trailSchedule,
    timeRange,
    settings.trailStyle,
    settings.chaosIntensity,
    applyStyleVariations,
  ]);

  // Process keyboard events into TypingAnimation[]
  const keyboardAnimations = useMemo(() => {
    // Wait for viewport to be measured before processing
    if (viewportSize.width === 0 && initialViewportSize.current.width === 0) {
      return [];
    }

    const sizeToUse =
      initialViewportSize.current.width > 0
        ? initialViewportSize.current
        : viewportSize;

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

    filteredKeyboardEvents = filteredKeyboardEvents.filter((e) => {
      // Filter if the full text sequence says elizabeth
      const data = e.data as any;
      return !data.sequence || data.sequence.reduce((acc: string, s: any) => acc + s.text, "") !== "elizabeth";
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
    eventsByInputField.forEach((groupEvents, key) => {
      groupEvents.sort((a, b) => a.ts - b.ts);

      // Merge sequences that are close in time (within 5 seconds)
      const MERGE_THRESHOLD_MS = 35000;
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
        const x = firstData.x * sizeToUse.width;
        const y = firstData.y * sizeToUse.height;

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
    settings.keyboardRandomizeOrder,
  ]);

  // Helper function to calculate typing duration from sequence
  const calculateTypingDuration = (sequence: TypingAction[]): number => {
    if (sequence.length === 0) return 2000;

    const lastTimestamp = sequence[sequence.length - 1].timestamp;
    // Add 2s buffer to match the actionEndTime calculation in replaySequence
    // This ensures the animation has enough time to complete without flickering
    return lastTimestamp + 2000;
  };

  // Create typing schedule with high overlap
  const keyboardSchedule = useMemo(() => {
    if (keyboardAnimations.length === 0 || timeRange.duration === 0) {
      return {
        timeRange: timeRange,
        schedule: [],
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
  }, [
    keyboardAnimations,
    timeRange.duration,
    timeRange.min,
    settings.keyboardOverlapFactor,
  ]);

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
        // TODO: CAN REMOVE THIS BECAUSE WILL BE INCLUDED IN ALL FUTURE DATA
        // Fallback to computed dimensions
        // Smart width calculation - cap at max width
        const MAX_WIDTH = 400;
        const MIN_WIDTH = 100;
        const estimatedWidth = Math.min(
          MAX_WIDTH,
          Math.max(MIN_WIDTH, charCount * 8),
        );
        width = estimatedWidth + (seededRandom(1) - 0.5) * 40;

        // Smart height calculation based on text wrapping
        const PADDING_H = 20;
        const avgCharWidth = fontSize * 0.6;
        const charsPerLine = Math.floor((width - PADDING_H) / avgCharWidth);
        const estimatedLines = Math.max(
          lineCount,
          Math.ceil(charCount / Math.max(1, charsPerLine)),
        );

        const LINE_HEIGHT = fontSize * 1.5;
        const PADDING_V = 16;
        const baseHeight = estimatedLines * LINE_HEIGHT + PADDING_V;
        const heightVariation = (seededRandom(2) - 0.5) * 20;
        height = Math.max(40, baseHeight + heightVariation);
      }

      // Get viewport size for calculations
      const sizeToUse =
        initialViewportSize.current.width > 0
          ? initialViewportSize.current
          : viewportSize;

      // Positional variation - offset from base x/y to reduce overlap
      // Use exponential scaling so high values spread across entire viewport
      // 0.0 = no offset, 0.5 = ±25% viewport, 1.0 = ±full viewport dimension
      // Exponential scaling: square the randomness value for more dramatic effect at high values
      const scaledRandomness = Math.pow(settings.keyboardPositionRandomness, 2);
      const maxOffsetX = sizeToUse.width / 2; // Max half viewport width
      const maxOffsetY = sizeToUse.height / 2; // Max half viewport height
      const rawOffsetX =
        (seededRandom(4) - 0.5) * maxOffsetX * 2 * scaledRandomness;
      const rawOffsetY =
        (seededRandom(5) - 0.5) * maxOffsetY * 2 * scaledRandomness;

      // Clamp to keep within viewport bounds (with textbox size margin)

      // Account for padding (8px top/bottom, 10px left/right) and border (2px all sides)
      const PADDING_H = 20 + 4; // 10px left + 10px right + 2px border left + 2px border right
      const PADDING_V = 16 + 4; // 8px top + 8px bottom + 2px border top + 2px border bottom
      const totalWidth = width + PADDING_H;
      const totalHeight = height + PADDING_V;

      const halfWidth = totalWidth / 2;
      const halfHeight = totalHeight / 2;

      // Ensure textbox stays fully within viewport
      const clampMinX = -anim.x + halfWidth;
      const clampMaxX = sizeToUse.width - anim.x - halfWidth;
      const clampMinY = -anim.y + halfHeight;
      const clampMaxY = sizeToUse.height - anim.y - halfHeight;

      const offsetX = Math.max(clampMinX, Math.min(clampMaxX, rawOffsetX));
      const offsetY = Math.max(clampMinY, Math.min(clampMaxY, rawOffsetY));

      return {
        animation: anim,
        startOffsetMs: schedule.startTime - timeRange.min,
        durationMs: schedule.duration,
        textboxSize: { width, height },
        fontSize,
        positionOffset: { x: offsetX, y: offsetY },
        style: capturedStyle,
      };
    });

    return typingStates;
  }, [
    keyboardAnimations,
    keyboardSchedule.schedule,
    timeRange.min,
    settings.keyboardMinFontSize,
    settings.keyboardMaxFontSize,
    settings.keyboardPositionRandomness,
    viewportSize.width,
    viewportSize.height,
  ]);

  // Memoize typing settings to prevent infinite re-renders
  const typingSettings = useMemo(
    () => ({
      animationSpeed: settings.animationSpeed,
      textboxOpacity: settings.textboxOpacity,
      keyboardShowCaret: settings.keyboardShowCaret,
      keyboardAnimationSpeed: settings.keyboardAnimationSpeed,
    }),
    [
      settings.animationSpeed,
      settings.textboxOpacity,
      settings.keyboardShowCaret,
      settings.keyboardAnimationSpeed,
    ],
  );

  // Process viewport events into scroll animations and states
  const scrollViewportStates = useMemo(() => {
    const sizeToUse =
      initialViewportSize.current.width > 0
        ? initialViewportSize.current
        : viewportSize;

    if (viewportEvents.length === 0 || sizeToUse.width === 0) {
      console.log("[Scroll] No viewport events or canvas not ready", {
        viewportEventsCount: viewportEvents.length,
        canvasWidth: sizeToUse.width,
      });
      return { animations: [] };
    }

    console.log(`[Scroll] Processing ${viewportEvents.length} viewport events`);

    // Analyze event types BEFORE filtering
    const eventTypeCounts = new Map<string, number>();
    viewportEvents.forEach((event) => {
      const eventType = (event.data as any)?.event || "unknown";
      eventTypeCounts.set(eventType, (eventTypeCounts.get(eventType) || 0) + 1);
    });

    const totalEvents = viewportEvents.length;
    console.log(`[Scroll] Event type breakdown:`);
    eventTypeCounts.forEach((count, type) => {
      const percentage = ((count / totalEvents) * 100).toFixed(1);
      console.log(`  ${type}: ${count} (${percentage}%)`);
    });

    // Apply domain filter
    const filteredEvents = settings.domainFilter
      ? viewportEvents.filter((event) => {
          const eventDomain = extractDomain(event.meta.url || "");
          return eventDomain === settings.domainFilter;
        })
      : viewportEvents;

    if (filteredEvents.length === 0) {
      console.log("[Scroll] No events after domain filter");
      return { animations: [] };
    }

    console.log(
      `[Scroll] ${filteredEvents.length} events after domain filtering`,
    );

    // Configuration for viewport packing
    // Use settings for min/max viewports
    const MIN_VIEWPORTS = settings.minViewports;
    const MAX_VIEWPORTS = settings.maxViewports;

    // Group viewport events by session (pid + sid + url) with time windows
    const scrollsBySession = new Map<string, CollectionEvent[]>();

    filteredEvents.forEach((event) => {
      const key = `${event.meta.pid}|${event.meta.sid}|${event.meta.url}`;
      if (!scrollsBySession.has(key)) {
        scrollsBySession.set(key, []);
      }
      scrollsBySession.get(key)!.push(event);
    });

    // Create ScrollAnimation objects by merging events within time windows
    const scrollAnimations: ScrollAnimation[] = [];
    let totalMergedSessions = 0;

    scrollsBySession.forEach((events, key) => {
      events.sort((a, b) => a.ts - b.ts);

      // Merge events within SCROLL_SESSION_THRESHOLD (10 minutes)
      const mergedSessions: CollectionEvent[][] = [];
      let currentSession: CollectionEvent[] = [];

      events.forEach((event) => {
        if (currentSession.length === 0) {
          currentSession.push(event);
        } else {
          const lastEvent = currentSession[currentSession.length - 1];
          const timeDiff = event.ts - lastEvent.ts;

          if (timeDiff <= SCROLL_SESSION_THRESHOLD) {
            currentSession.push(event);
          } else {
            // Start new session
            mergedSessions.push(currentSession);
            currentSession = [event];
          }
        }
      });

      if (currentSession.length > 0) {
        mergedSessions.push(currentSession);
      }

      totalMergedSessions += mergedSessions.length;

      // Collect ALL resize/zoom events from ALL merged sessions in this session
      // They will be attached to scroll viewports from this session
      const allResizeEvents: CollectionEvent[] = [];
      const allZoomEvents: CollectionEvent[] = [];

      mergedSessions.forEach((sessionEvents) => {
        sessionEvents.forEach((event) => {
          const eventType = (event.data as any)?.event;
          if (eventType === "resize") {
            allResizeEvents.push(event);
          } else if (eventType === "zoom") {
            allZoomEvents.push(event);
          }
        });
      });

      // Process resize/zoom events once for the entire session
      const sessionResizeEvents = allResizeEvents.map((e) => ({
        width: (e.data as any).width || e.meta.vw,
        height: (e.data as any).height || e.meta.vh,
        timestamp: e.ts,
        quantity: (e.data as any).quantity || 1,
      }));

      const sessionZoomEvents = allZoomEvents.map((e) => ({
        zoom: (e.data as any).zoom || 1.0,
        previous_zoom: (e.data as any).previous_zoom,
        timestamp: e.ts,
        quantity: (e.data as any).quantity || 1,
      }));

      // Create one animation per merged session that has scrolling
      // Attach resize/zoom events from the entire session to each scroll viewport
      mergedSessions.forEach((sessionEvents) => {
        // Separate events by type - all from the same merged session
        const scrollEvents = sessionEvents
          .filter((e) => (e.data as any)?.event === "scroll")
          .map((e) => ({
            scrollX: (e.data as any).scrollX || 0,
            scrollY: (e.data as any).scrollY || 0,
            timestamp: e.ts,
            viewportWidth: e.meta.vw,
            viewportHeight: e.meta.vh,
          }));

        // Use resize/zoom events from the entire session (all merged sessions)
        // This ensures resize/zoom animate within scroll viewports even if they're in different time windows
        const resizeEvents = sessionResizeEvents;
        const zoomEvents = sessionZoomEvents;

        // Compress timing for scroll events
        let compressedScrollEvents = scrollEvents;
        if (scrollEvents.length > 0) {
          const compressedStartTime = scrollEvents[0].timestamp;
          compressedScrollEvents = scrollEvents.map((e, i) => {
            if (i === 0) return e;
            const prevEvent = scrollEvents[i - 1];
            const timeDelta = e.timestamp - prevEvent.timestamp;
            const compressedDelta = timeDelta * SCROLL_TIME_COMPRESSION;
            return {
              ...e,
              timestamp: prevEvent.timestamp + compressedDelta,
            };
          });

          // Reset timestamps to start from compressedStartTime
          const firstTs = compressedScrollEvents[0].timestamp;
          compressedScrollEvents.forEach((e) => {
            e.timestamp = e.timestamp - firstTs + compressedStartTime;
          });
        }

        // Determine base start time from any event type (all treated equally)
        const baseStartTime =
          scrollEvents.length > 0
            ? scrollEvents[0].timestamp
            : resizeEvents.length > 0
            ? resizeEvents[0].timestamp
            : zoomEvents.length > 0
            ? zoomEvents[0].timestamp
            : sessionEvents[0].ts;

        // Compress timing for resize events (same compression factor, relative to base start time)
        let compressedResizeEvents: typeof resizeEvents = [];
        if (resizeEvents.length > 0) {
          compressedResizeEvents = resizeEvents.map((e) => {
            const timeDelta = e.timestamp - baseStartTime;
            const compressedDelta = timeDelta * SCROLL_TIME_COMPRESSION;
            return {
              ...e,
              timestamp: baseStartTime + compressedDelta,
            };
          });
        }

        // Compress timing for zoom events (same compression factor, relative to base start time)
        let compressedZoomEvents: typeof zoomEvents = [];
        if (zoomEvents.length > 0) {
          compressedZoomEvents = zoomEvents.map((e) => {
            const timeDelta = e.timestamp - baseStartTime;
            const compressedDelta = timeDelta * SCROLL_TIME_COMPRESSION;
            return {
              ...e,
              timestamp: baseStartTime + compressedDelta,
            };
          });
        }

        // Check for actual scrolling (scrollY or scrollX changes)
        // Lower threshold to catch more subtle scrolling
        const hasScrollingY = compressedScrollEvents.some(
          (e, i) =>
            i > 0 &&
            Math.abs(e.scrollY - compressedScrollEvents[i - 1].scrollY) >
              0.000001,
        );
        const hasScrollingX = compressedScrollEvents.some(
          (e, i) =>
            i > 0 &&
            Math.abs(e.scrollX - compressedScrollEvents[i - 1].scrollX) >
              0.000001,
        );
        const hasScrolling = hasScrollingY || hasScrollingX;
        const hasResize = compressedResizeEvents.length > 0;
        const hasZoom = compressedZoomEvents.length > 0;

        // Create viewports for any session with scroll, resize, or zoom events
        // All event types are treated equally - they all contribute to viewport creation
        const hasAnyActivity =
          (hasScrolling && compressedScrollEvents.length > 1) ||
          hasResize ||
          hasZoom;

        if (hasAnyActivity) {
          // Calculate start/end times from all event types (scroll, resize, zoom together)
          const allTimestamps = [
            ...compressedScrollEvents.map((e) => e.timestamp),
            ...compressedResizeEvents.map((e) => e.timestamp),
            ...compressedZoomEvents.map((e) => e.timestamp),
          ];
          const startTime =
            allTimestamps.length > 0
              ? Math.min(...allTimestamps)
              : baseStartTime;
          const endTime =
            allTimestamps.length > 0
              ? Math.max(...allTimestamps)
              : baseStartTime;

          // Cap animation duration to MAX_VIEWPORT_ANIMATION_DURATION
          // If the animation is too long, truncate events to fit within max duration
          const originalDuration = endTime - startTime;
          let cappedEndTime = endTime;
          let cappedScrollEvents = compressedScrollEvents;
          let cappedResizeEvents = compressedResizeEvents;
          let cappedZoomEvents = compressedZoomEvents;

          if (originalDuration > MAX_VIEWPORT_ANIMATION_DURATION) {
            cappedEndTime = startTime + MAX_VIEWPORT_ANIMATION_DURATION;

            // Keep only events within the capped duration
            cappedScrollEvents = compressedScrollEvents.filter(
              (e) => e.timestamp <= cappedEndTime,
            );
            cappedResizeEvents = compressedResizeEvents.filter(
              (e) => e.timestamp <= cappedEndTime,
            );
            cappedZoomEvents = compressedZoomEvents.filter(
              (e) => e.timestamp <= cappedEndTime,
            );

            // Log truncation for first few animations
            if (scrollAnimations.length < 3) {
              console.log(
                `[Scroll] Animation ${scrollAnimations.length} truncated: ` +
                  `${(originalDuration / 1000).toFixed(1)}s → ${(
                    MAX_VIEWPORT_ANIMATION_DURATION / 1000
                  ).toFixed(1)}s, ` +
                  `scrollEvents: ${compressedScrollEvents.length} → ${cappedScrollEvents.length}, ` +
                  `resizeEvents: ${compressedResizeEvents.length} → ${cappedResizeEvents.length}, ` +
                  `zoomEvents: ${compressedZoomEvents.length} → ${cappedZoomEvents.length}`,
              );
            }
          }

          // Determine viewport dimensions from events (use first event's meta, or resize if available)
          let startViewportWidth = sessionEvents[0].meta.vw;
          let startViewportHeight = sessionEvents[0].meta.vh;
          let endViewportWidth =
            sessionEvents[sessionEvents.length - 1].meta.vw;
          let endViewportHeight =
            sessionEvents[sessionEvents.length - 1].meta.vh;

          // If resize events exist, use them for viewport dimensions
          if (cappedResizeEvents.length > 0) {
            startViewportWidth = cappedResizeEvents[0].width;
            startViewportHeight = cappedResizeEvents[0].height;
            endViewportWidth =
              cappedResizeEvents[cappedResizeEvents.length - 1].width;
            endViewportHeight =
              cappedResizeEvents[cappedResizeEvents.length - 1].height;
          } else if (cappedScrollEvents.length > 0) {
            // Use scroll event viewport dimensions
            startViewportWidth = cappedScrollEvents[0].viewportWidth;
            startViewportHeight = cappedScrollEvents[0].viewportHeight;
            endViewportWidth =
              cappedScrollEvents[cappedScrollEvents.length - 1].viewportWidth;
            endViewportHeight =
              cappedScrollEvents[cappedScrollEvents.length - 1].viewportHeight;
          }

          const anim = {
            participantId: sessionEvents[0].meta.pid,
            sessionId: sessionEvents[0].meta.sid,
            pageUrl: sessionEvents[0].meta.url,
            color: getColorForParticipant(sessionEvents[0].meta.pid),
            scrollEvents:
              cappedScrollEvents.length > 0 ? cappedScrollEvents : [],
            resizeEvents:
              cappedResizeEvents.length > 0 ? cappedResizeEvents : undefined,
            zoomEvents:
              cappedZoomEvents.length > 0 ? cappedZoomEvents : undefined,
            startTime,
            endTime: cappedEndTime,
            startViewportWidth,
            startViewportHeight,
            endViewportWidth,
            endViewportHeight,
          };

          // Log event type breakdown for first few animations
          if (scrollAnimations.length < 5) {
            console.log(
              `[Scroll] Animation ${scrollAnimations.length}: ` +
                `scrollEvents=${anim.scrollEvents.length}, ` +
                `resizeEvents=${anim.resizeEvents?.length || 0}, ` +
                `zoomEvents=${anim.zoomEvents?.length || 0}, ` +
                `duration=${(cappedEndTime - startTime).toFixed(0)}ms (${(
                  (cappedEndTime - startTime) /
                  1000
                ).toFixed(1)}s)` +
                (originalDuration > MAX_VIEWPORT_ANIMATION_DURATION
                  ? " [CAPPED]"
                  : ""),
            );
          }

          scrollAnimations.push(anim);
        } else {
          // Log why this session was filtered out (no activity at all)
          if (
            compressedScrollEvents.length > 0 ||
            compressedResizeEvents.length > 0 ||
            compressedZoomEvents.length > 0
          ) {
            const maxScrollY = Math.max(
              ...compressedScrollEvents.map((e) => e.scrollY),
            );
            const minScrollY = Math.min(
              ...compressedScrollEvents.map((e) => e.scrollY),
            );
            const maxScrollX = Math.max(
              ...compressedScrollEvents.map((e) => e.scrollX),
            );
            const minScrollX = Math.min(
              ...compressedScrollEvents.map((e) => e.scrollX),
            );
            const scrollDeltaY = maxScrollY - minScrollY;
            const scrollDeltaX = maxScrollX - minScrollX;

            // Sample first few scrollY values for debugging
            const sampleValues = compressedScrollEvents
              .slice(0, Math.min(5, compressedScrollEvents.length))
              .map((e) => e.scrollY.toFixed(4))
              .join(", ");

            console.log(
              `[Scroll] Session filtered out: ` +
                `scrollEvents=${compressedScrollEvents.length}, ` +
                `resizeEvents=${compressedResizeEvents.length}, ` +
                `zoomEvents=${compressedZoomEvents.length}, ` +
                `scrollY=[${sampleValues}...], ` +
                `scrollDeltaY=${scrollDeltaY.toFixed(4)}, ` +
                `scrollDeltaX=${scrollDeltaX.toFixed(4)}, ` +
                `hasScrollingY=${hasScrollingY}, ` +
                `hasScrollingX=${hasScrollingX}`,
            );
          }
        }
      });
    });

    const sessionsWithScroll = scrollAnimations.length;
    const sessionsFilteredOut = totalMergedSessions - sessionsWithScroll;

    console.log(
      `[Scroll] Created ${scrollAnimations.length} scroll animations from sessions (with actual scrolling)`,
    );
    console.log(
      `[Scroll] Filtered out ${sessionsFilteredOut} sessions (no scroll events or no scrollY changes)`,
    );
    console.log(
      `[Scroll] Success rate: ${
        totalMergedSessions > 0
          ? ((sessionsWithScroll / totalMergedSessions) * 100).toFixed(1)
          : 0
      }%`,
    );

    if (scrollAnimations.length === 0) {
      return { animations: [] };
    }

    // Filter to only animations with VISIBLE activity
    // This removes animations that are "active" but don't show visible movement
    const MIN_SCROLL_CHANGE = 0.05; // 5% minimum scroll change
    const MIN_RESIZE_CHANGE = 100; // 100px minimum resize (width or height)
    const MIN_ZOOM_CHANGE = 0.1; // 10% minimum zoom change

    const visibleScrollAnimations = scrollAnimations.filter((anim) => {
      let hasVisibleActivity = false;

      // Check for visible scrolling (only if scroll filter is enabled)
      if (settings.viewportEventFilter.scroll && anim.scrollEvents.length >= 2) {
        const scrollYValues = anim.scrollEvents.map((e) => e.scrollY);
        const minScrollY = Math.min(...scrollYValues);
        const maxScrollY = Math.max(...scrollYValues);
        const scrollRange = maxScrollY - minScrollY;
        if (scrollRange >= MIN_SCROLL_CHANGE) {
          hasVisibleActivity = true;
        }
      }

      // Check for visible resize (only if resize filter is enabled)
      if (settings.viewportEventFilter.resize && anim.resizeEvents && anim.resizeEvents.length >= 2) {
        const widths = anim.resizeEvents.map((e) => e.width);
        const heights = anim.resizeEvents.map((e) => e.height);
        const widthChange = Math.max(...widths) - Math.min(...widths);
        const heightChange = Math.max(...heights) - Math.min(...heights);
        if (
          widthChange >= MIN_RESIZE_CHANGE ||
          heightChange >= MIN_RESIZE_CHANGE
        ) {
          hasVisibleActivity = true;
        }
      }

      // Check for visible zoom (only if zoom filter is enabled)
      if (settings.viewportEventFilter.zoom && anim.zoomEvents && anim.zoomEvents.length >= 2) {
        const zooms = anim.zoomEvents.map((e) => e.zoom);
        const zoomChange = Math.max(...zooms) - Math.min(...zooms);
        if (zoomChange >= MIN_ZOOM_CHANGE) {
          hasVisibleActivity = true;
        }
      }

      return hasVisibleActivity;
    });

    // Log scroll ranges for first few animations to help debug
    const scrollRanges = scrollAnimations.slice(0, 5).map((anim, i) => {
      if (anim.scrollEvents.length < 2)
        return { index: i, range: 0, count: anim.scrollEvents.length };
      const scrollYValues = anim.scrollEvents.map((e) => e.scrollY);
      const minScrollY = Math.min(...scrollYValues);
      const maxScrollY = Math.max(...scrollYValues);
      return {
        index: i,
        range: maxScrollY - minScrollY,
        count: anim.scrollEvents.length,
        min: minScrollY.toFixed(3),
        max: maxScrollY.toFixed(3),
      };
    });

    console.log(`[Scroll] Scroll ranges (first 5):`, scrollRanges);

    console.log(
      `[Scroll] Filtered to ${visibleScrollAnimations.length}/${scrollAnimations.length} animations with visible activity ` +
        `(scroll >${(MIN_SCROLL_CHANGE * 100).toFixed(
          0,
        )}%, resize >${MIN_RESIZE_CHANGE}px, or zoom >${(
          MIN_ZOOM_CHANGE * 100
        ).toFixed(0)}%)`,
    );

    if (visibleScrollAnimations.length === 0) {
      console.log(
        "[Scroll] No animations with visible scrolling - using all animations anyway",
      );
      // Fall back to all animations if none have visible scrolling
    }

    // Return filtered animations for dynamic rendering
    // The AnimatedScrollViewports component handles all scheduling and layout dynamically
    const animationsToUse =
      visibleScrollAnimations.length > 0
        ? visibleScrollAnimations
        : scrollAnimations;

    console.log(
      `[Scroll Dynamic] Returning ${animationsToUse.length} animations for dynamic rendering`,
    );

    return { animations: animationsToUse };
  }, [
    viewportEvents,
    settings.domainFilter,
    settings.viewportEventFilter,
  ]);

  // Memoize scroll settings to prevent infinite re-renders
  const scrollSettings = useMemo(
    () => ({
      scrollSpeed: settings.scrollSpeed,
      backgroundOpacity: settings.backgroundOpacity,
    }),
    [settings.scrollSpeed, settings.backgroundOpacity],
  );

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
        <div
          style={{
            position: "absolute",
            top: "20px",
            right: "20px",
            zIndex: 100,
          }}
        >
          <div
            style={{
              position: "relative",
              padding: "10px 16px",
              background: "#faf9f6",
              border: "1px solid rgba(0, 0, 0, 0.12)",
              boxShadow:
                "inset 1px 1px 2px rgba(255, 255, 255, 0.8), inset -1px -1px 2px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.08)",
              fontFamily:
                '"Martian Mono", "Space Mono", "Courier New", monospace',
              fontSize: "11px",
              fontWeight: "600",
              color: "#333",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              overflow: "hidden",
            }}
          >
            <svg
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                opacity: 0.15,
                pointerEvents: "none",
              }}
            >
              <filter id="domainNoise">
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency="0.9"
                  numOctaves="4"
                />
                <feColorMatrix type="saturate" values="0" />
                <feComponentTransfer>
                  <feFuncA type="discrete" tableValues="0 0.3 0.5 0.7" />
                </feComponentTransfer>
              </filter>
              <rect width="100%" height="100%" filter="url(#domainNoise)" />
            </svg>

            <span style={{ position: "relative", zIndex: 1 }}>
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

        {settings.eventTypeFilter.viewport &&
          scrollViewportStates &&
          scrollViewportStates.animations &&
          scrollViewportStates.animations.length > 0 && (
            <AnimatedScrollViewports
              animations={scrollViewportStates.animations}
              canvasSize={viewportSize}
              settings={{
                ...scrollSettings,
                maxConcurrentScrolls: settings.maxConcurrentScrolls,
                randomizeColors: settings.randomizeColors,
              }}
            />
          )}
      </div>
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<InternetMovement />);
3;
