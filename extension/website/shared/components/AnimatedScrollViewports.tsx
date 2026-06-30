// ABOUTME: Dynamic animated scroll viewport visualization component
// ABOUTME: Renders viewports on-demand with fade transitions and dynamic space packing
import React, {
  useState,
  useEffect,
  useRef,
  memo,
  useCallback,
  useMemo,
} from "react";
import { ScrollAnimation, ActiveViewport, ViewportPhase } from "../types";
import { RISO_COLORS, extractDomain } from "../utils/eventUtils";
import {
  isMonochromeStyle,
  colorWash,
  colorShade,
  colorizeLuminosity,
} from "../utils/colorStyle";
import { PagePreview } from "./PagePreview";
import { useDebugHover } from "./DebugHover";

// Configuration constants
const FADE_IN_DURATION = 400; // ms
const FADE_OUT_DURATION = 600; // ms
const FADE_OUT_DELAY = 300; // ms after animation ends before starting fade out
const FILL_CHECK_INTERVAL = 300; // ms between checking for empty spaces
const FRAME_INTERVAL_MS = 1000 / 30; // Visual update cadence
const MIN_VIEWPORT_SIZE = 150; // Minimum viewport dimension
const PACKING_ATTEMPTS = 15; // Number of random positions to try when packing
const VIEWPORT_MARGIN = 8; // Gap between viewports

interface AnimatedScrollViewportsProps {
  animations: ScrollAnimation[];
  canvasSize: { width: number; height: number };
  settings: {
    scrollSpeed: number;
    backgroundOpacity: number;
    maxConcurrentScrolls: number;
    randomizeColors?: boolean;
    showPagePreview?: boolean;
    allowOverlap?: boolean;
    showScrollEvents?: boolean;
    showResizeEvents?: boolean;
    showZoomEvents?: boolean;
    windowScale?: number;
    windowBleed?: number;
    showTitleBar?: boolean;
    trailVisualStyle?: string;
  };
  // Live URL → metadata lookup. Read at render time so title bars update as
  // navigation events stream in, even for viewports that were added before
  // the metadata for their URL arrived.
  urlMetadata?: Map<string, { title?: string; favicon?: string }>;
}

// Generate unique ID for viewports
let viewportIdCounter = 0;
const generateViewportId = () =>
  `viewport-${++viewportIdCounter}-${Date.now()}`;

// Seeded random for consistent variation
const seededRandom = (seed: number, offset: number = 0) => {
  const x = Math.sin(seed + offset * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// Hash function for generating seeds
const hashString = (str: string): number => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
};

// Check if two rectangles overlap (with margin)
const rectsOverlap = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  margin: number = VIEWPORT_MARGIN,
): boolean => {
  return !(
    a.x + a.width + margin <= b.x ||
    b.x + b.width + margin <= a.x ||
    a.y + a.height + margin <= b.y ||
    b.y + b.height + margin <= a.y
  );
};

// Try to find a position for a new viewport that doesn't overlap existing ones
const findAvailablePosition = (
  width: number,
  height: number,
  occupiedRects: Array<{ x: number; y: number; width: number; height: number }>,
  canvasWidth: number,
  canvasHeight: number,
  seed: number,
): { x: number; y: number } | null => {
  // Try random positions
  for (let attempt = 0; attempt < PACKING_ATTEMPTS; attempt++) {
    const x =
      seededRandom(seed, attempt * 2) *
        (canvasWidth - width - VIEWPORT_MARGIN * 2) +
      VIEWPORT_MARGIN;
    const y =
      seededRandom(seed, attempt * 2 + 1) *
        (canvasHeight - height - VIEWPORT_MARGIN * 2) +
      VIEWPORT_MARGIN;

    const candidate = { x, y, width, height };

    // Check if this position overlaps any occupied rect
    let hasOverlap = false;
    for (const rect of occupiedRects) {
      if (rectsOverlap(candidate, rect)) {
        hasOverlap = true;
        break;
      }
    }

    if (!hasOverlap) {
      return { x, y };
    }
  }

  // Try grid-based positions as fallback
  const gridStepX = canvasWidth / 4;
  const gridStepY = canvasHeight / 4;

  for (let gx = 0; gx < 4; gx++) {
    for (let gy = 0; gy < 4; gy++) {
      const x = gx * gridStepX + VIEWPORT_MARGIN;
      const y = gy * gridStepY + VIEWPORT_MARGIN;

      // Ensure it fits within canvas
      if (
        x + width > canvasWidth - VIEWPORT_MARGIN ||
        y + height > canvasHeight - VIEWPORT_MARGIN
      ) {
        continue;
      }

      const candidate = { x, y, width, height };

      let hasOverlap = false;
      for (const rect of occupiedRects) {
        if (rectsOverlap(candidate, rect)) {
          hasOverlap = true;
          break;
        }
      }

      if (!hasOverlap) {
        return { x, y };
      }
    }
  }

  return null; // No space found
};

// Calculate viewport dimensions based on animation data, preserving original aspect ratio
// windowScale: 0 = tiny, 0.5 = medium (default), 1 = large
const calculateViewportSize = (
  animation: ScrollAnimation,
  canvasWidth: number,
  canvasHeight: number,
  seed: number,
  windowScale: number = 0.5,
): { width: number; height: number } => {
  const avgWidth =
    (animation.startViewportWidth + animation.endViewportWidth) / 2;
  const avgHeight =
    (animation.startViewportHeight + animation.endViewportHeight) / 2;
  const aspectRatio = avgWidth / Math.max(1, avgHeight);

  // Scale range maps windowScale 0..1 to 5-15% .. 30-50% of canvas
  const minScale = 0.05 + windowScale * 0.25;
  const maxScale = 0.15 + windowScale * 0.35;
  const targetScale = minScale + seededRandom(seed, 10) * (maxScale - minScale);

  let width = canvasWidth * targetScale;
  let height = width / aspectRatio;

  const maxWidth = canvasWidth * 0.7;
  const maxHeight = canvasHeight * 0.7;

  if (width > maxWidth) {
    width = maxWidth;
    height = width / aspectRatio;
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }

  const minSize = Math.max(40, MIN_VIEWPORT_SIZE * (0.3 + windowScale * 0.7));
  if (width < minSize) {
    width = minSize;
    height = width / aspectRatio;
  }
  if (height < minSize) {
    height = minSize;
    width = height * aspectRatio;
  }

  return { width, height };
};

export const AnimatedScrollViewports: React.FC<AnimatedScrollViewportsProps> =
  memo(({ animations, canvasSize, settings, urlMetadata }) => {
    const [activeViewports, setActiveViewports] = useState<ActiveViewport[]>(
      [],
    );
    const [frameTime, setFrameTime] = useState(0);
    const activeViewportsRef = useRef<ActiveViewport[]>([]);
    const animationQueueRef = useRef<ScrollAnimation[]>([]);
    const queueIndexRef = useRef(0);
    const animationFrameRef = useRef<number | null>(null);
    const lastFillCheckRef = useRef(0);
    const lastFrameUpdateRef = useRef(0);
    const startTimeRef = useRef<number | null>(null);

    // Settings ref to avoid re-renders
    const settingsRef = useRef(settings);
    useEffect(() => {
      settingsRef.current = settings;
    }, [settings]);

    const commitActiveViewports = useCallback(
      (update: (previous: ActiveViewport[]) => ActiveViewport[]) => {
        setActiveViewports((previous) => {
          const next = update(previous);
          activeViewportsRef.current = next;
          return next;
        });
      },
      [],
    );

    useEffect(() => {
      activeViewportsRef.current = activeViewports;
    }, [activeViewports]);

    // Initialize animation queue when animations change
    useEffect(() => {
      if (animations.length > 0) {
        // Shuffle the animations for variety
        const shuffled = [...animations];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        animationQueueRef.current = shuffled;
        queueIndexRef.current = 0;
        console.log(
          `[Scroll Dynamic] Initialized queue with ${shuffled.length} animations`,
        );
      }
    }, [animations]);

    // Get next animation from queue (cycles through)
    const getNextAnimation = useCallback((): ScrollAnimation | null => {
      const queue = animationQueueRef.current;
      if (queue.length === 0) return null;

      const animation = queue[queueIndexRef.current];
      queueIndexRef.current = (queueIndexRef.current + 1) % queue.length;
      return animation;
    }, []);

    // Try to add a new viewport to an available space
    const tryAddViewport = useCallback(
      (currentTime: number) => {
        const { maxConcurrentScrolls } = settingsRef.current;
        const visibleViewports = activeViewportsRef.current.filter(
          (v) => v.phase !== "fade-out",
        );

        // Count non-fading-out viewports
        const activeCount = visibleViewports.length;

        if (activeCount >= maxConcurrentScrolls) {
          return; // At capacity
        }

        const animation = getNextAnimation();
        if (!animation) return;

        // Filter by enabled event types
        const s = settingsRef.current;
        const hasScroll =
          s.showScrollEvents !== false && animation.scrollEvents.length > 0;
        const hasResize =
          s.showResizeEvents !== false &&
          (animation.resizeEvents?.length ?? 0) > 0;
        const hasZoom =
          s.showZoomEvents !== false && (animation.zoomEvents?.length ?? 0) > 0;
        if (!hasScroll && !hasResize && !hasZoom) return;

        // Calculate size for this viewport
        const seed =
          hashString(animation.participantId + animation.sessionId) +
          currentTime;
        const size = calculateViewportSize(
          animation,
          canvasSize.width,
          canvasSize.height,
          seed,
          settingsRef.current.windowScale ?? 0.5,
        );

        // Find position — skip collision check when overlap is allowed
        let position: { x: number; y: number } | null;
        if (settingsRef.current.allowOverlap) {
          // Spread viewports across the FULL canvas, not just the rect of
          // valid top-left positions. Uniform top-left placement biases
          // coverage toward the middle (since center pixels fall inside more
          // candidate rects than edge pixels). Sampling the *center*
          // uniformly across the whole canvas — and allowing each viewport
          // to hang up to half its size off any edge — gives a flat coverage
          // distribution that reaches the corners.
          const overhangFrac = settingsRef.current.windowBleed ?? 0.45;
          const overhangX = size.width * overhangFrac;
          const overhangY = size.height * overhangFrac;

          // Coverage-aware tie-break: try a few candidates and pick the one
          // whose center is farthest from any currently-active viewport.
          // Cheap (4 samples × N active), keeps placements from clumping.
          const activeCenters = visibleViewports.map((v) => ({
            cx: v.rect.x + v.rect.width / 2,
            cy: v.rect.y + v.rect.height / 2,
          }));
          const NUM_CANDIDATES = 4;
          let best: { x: number; y: number } | null = null;
          let bestScore = -Infinity;
          for (let c = 0; c < NUM_CANDIDATES; c++) {
            const cx = seededRandom(seed, c * 2) * canvasSize.width;
            const cy = seededRandom(seed, c * 2 + 1) * canvasSize.height;
            const x = Math.max(
              -overhangX,
              Math.min(
                canvasSize.width - size.width + overhangX,
                cx - size.width / 2,
              ),
            );
            const y = Math.max(
              -overhangY,
              Math.min(
                canvasSize.height - size.height + overhangY,
                cy - size.height / 2,
              ),
            );
            let nearest = Infinity;
            for (const a of activeCenters) {
              const dx = a.cx - (x + size.width / 2);
              const dy = a.cy - (y + size.height / 2);
              const d2 = dx * dx + dy * dy;
              if (d2 < nearest) nearest = d2;
            }
            const score = activeCenters.length === 0 ? 0 : nearest;
            if (score > bestScore) {
              bestScore = score;
              best = { x, y };
            }
          }
          position = best;
        } else {
          const occupiedRects = visibleViewports.map((v) => v.rect);
          position = findAvailablePosition(
            size.width,
            size.height,
            occupiedRects,
            canvasSize.width,
            canvasSize.height,
            seed,
          );
        }

        if (!position) {
          // No space available, put animation back
          queueIndexRef.current =
            (queueIndexRef.current - 1 + animationQueueRef.current.length) %
            animationQueueRef.current.length;
          return;
        }

        // Create new active viewport
        const newViewport: ActiveViewport = {
          id: generateViewportId(),
          animation,
          rect: { ...position, width: size.width, height: size.height },
          phase: "fade-in",
          phaseStartTime: currentTime,
          animationStartTime: currentTime + FADE_IN_DURATION,
          durationMs: animation.endTime - animation.startTime,
          backgroundSeed: seed,
        };

        commitActiveViewports((prev) => [...prev, newViewport]);
        console.log(
          `[Scroll Dynamic] Added viewport ${newViewport.id}, now ${
            activeCount + 1
          } active`,
        );
      },
      [canvasSize, commitActiveViewports, getNextAnimation],
    );

    // Update viewport phases based on time
    const updateViewports = useCallback(
      (currentTime: number) => {
        const currentViewports = activeViewportsRef.current;
        if (currentViewports.length === 0) return;

        let changed = false;
        const updated = currentViewports.map((viewport) => {
          // Check phase transitions
          if (viewport.phase === "fade-in") {
            const fadeInElapsed = currentTime - viewport.phaseStartTime;
            if (fadeInElapsed >= FADE_IN_DURATION) {
              changed = true;
              return {
                ...viewport,
                phase: "animating" as ViewportPhase,
                phaseStartTime: currentTime,
              };
            }
          } else if (viewport.phase === "animating") {
            const animElapsed = currentTime - viewport.animationStartTime;
            if (animElapsed >= viewport.durationMs + FADE_OUT_DELAY) {
              changed = true;
              return {
                ...viewport,
                phase: "fade-out" as ViewportPhase,
                phaseStartTime: currentTime,
              };
            }
          }
          return viewport;
        });

        // Remove fully faded out viewports
        const filtered = updated.filter((viewport) => {
          if (viewport.phase === "fade-out") {
            const fadeOutElapsed = currentTime - viewport.phaseStartTime;
            if (fadeOutElapsed >= FADE_OUT_DURATION) {
              changed = true;
              console.log(`[Scroll Dynamic] Removed viewport ${viewport.id}`);
              return false;
            }
          }
          return true;
        });

        if (changed) {
          commitActiveViewports(() => filtered);
        }
      },
      [commitActiveViewports],
    );

    // Main animation loop
    useEffect(() => {
      if (animations.length === 0 || canvasSize.width === 0) return;

      const animate = (timestamp: number) => {
        if (startTimeRef.current === null) {
          startTimeRef.current = timestamp;
        }

        const currentTime = timestamp - startTimeRef.current;

        // Update viewport phases
        updateViewports(currentTime);

        // Periodically try to fill empty spaces
        if (currentTime - lastFillCheckRef.current >= FILL_CHECK_INTERVAL) {
          lastFillCheckRef.current = currentTime;
          tryAddViewport(currentTime);
        }

        if (currentTime - lastFrameUpdateRef.current >= FRAME_INTERVAL_MS) {
          lastFrameUpdateRef.current = currentTime;
          setFrameTime(currentTime);
        }

        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animationFrameRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }, [animations.length, canvasSize.width, updateViewports, tryAddViewport]);

    if (animations.length === 0) {
      return null;
    }

    const currentTime = frameTime;

    return (
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        <defs>
          <filter id="scrollNoise">
            {/* Paper-grain noise composited OVER the source fill (not replacing
                it) so a colored background rect keeps its color and just gains a
                subtle textured tooth. Previously this replaced the source with
                grayscale noise, which silently hid any fill color. */}
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="3"
              stitchTiles="stitch"
              result="noise"
            />
            {/* Keep only a faint dark grain (low alpha) from the noise. */}
            <feColorMatrix
              in="noise"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.12 0"
              result="grain"
            />
            {/* Clip the grain to the source shape and lay it over the fill. */}
            <feComposite
              in="grain"
              in2="SourceGraphic"
              operator="in"
              result="clippedGrain"
            />
            <feMerge>
              <feMergeNode in="SourceGraphic" />
              <feMergeNode in="clippedGrain" />
            </feMerge>
          </filter>
          <filter id="scrollGrain">
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
        </defs>

        {activeViewports.map((viewport) => {
          const live = urlMetadata?.get(viewport.animation.pageUrl);
          return (
            <DynamicViewportRect
              key={viewport.id}
              viewport={viewport}
              currentTime={currentTime}
              settings={settingsRef.current}
              livePageTitle={live?.title}
              liveFaviconUrl={live?.favicon}
            />
          );
        })}
      </svg>
    );
  });

// Best-effort title derivation purely from the URL — used as a fallback when
// no captured page title is available. Currently handles Wikipedia articles
// since the article slug IS the title; everything else returns null so the
// caller can fall through to the domain.
function deriveTitleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith("wikipedia.org")) {
      const m = parsed.pathname.match(/^\/wiki\/(.+)$/);
      if (m) {
        const slug = decodeURIComponent(m[1]).replace(/_/g, " ");
        // Skip namespace pages (Special:, Talk:, User:, Category:, etc.) and
        // the Main Page — neither is useful as a title-bar label.
        if (/^[A-Za-z_]+:/.test(slug) || slug === "Main Page") return null;
        return slug;
      }
    }
  } catch {
    // ignore malformed URLs
  }
  return null;
}

type ScrollKeyframe = ScrollAnimation["scrollEvents"][number];
type ResizeKeyframe = NonNullable<ScrollAnimation["resizeEvents"]>[number];
type ZoomKeyframe = NonNullable<ScrollAnimation["zoomEvents"]>[number];

export interface ViewportAnimationTimeline {
  hasEvents: boolean;
  minTime: number;
  maxTime: number;
  timeRange: number;
  minScrollY: number;
  maxScrollY: number;
  scrollRange: number;
}

function findSegmentIndex(
  events: Array<{ timestamp: number }>,
  currentTime: number,
): number {
  let low = 0;
  let high = events.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (events[mid].timestamp <= currentTime) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return Math.max(0, Math.min(high, events.length - 2));
}

function interpolationProgress(
  startTimestamp: number,
  endTimestamp: number,
  currentTime: number,
): number {
  const duration = endTimestamp - startTimestamp;
  if (duration <= 0) return 1;
  return (currentTime - startTimestamp) / duration;
}

export function buildViewportAnimationTimeline(
  animation: ScrollAnimation,
): ViewportAnimationTimeline {
  let minTime = Infinity;
  let maxTime = -Infinity;

  const includeTimestamp = (timestamp: number) => {
    minTime = Math.min(minTime, timestamp);
    maxTime = Math.max(maxTime, timestamp);
  };

  for (const event of animation.scrollEvents) includeTimestamp(event.timestamp);
  for (const event of animation.resizeEvents ?? [])
    includeTimestamp(event.timestamp);
  for (const event of animation.zoomEvents ?? [])
    includeTimestamp(event.timestamp);

  let minScrollY = 0;
  let maxScrollY = 1;
  let scrollRange = 1;

  if (animation.scrollEvents.length >= 2) {
    minScrollY = Infinity;
    maxScrollY = -Infinity;
    for (const event of animation.scrollEvents) {
      minScrollY = Math.min(minScrollY, event.scrollY);
      maxScrollY = Math.max(maxScrollY, event.scrollY);
    }
    scrollRange = Math.max(0.1, maxScrollY - minScrollY);
  }

  const hasEvents = Number.isFinite(minTime) && Number.isFinite(maxTime);

  return {
    hasEvents,
    minTime: hasEvents ? minTime : 0,
    maxTime: hasEvents ? maxTime : 0,
    timeRange: hasEvents ? maxTime - minTime : 0,
    minScrollY,
    maxScrollY,
    scrollRange,
  };
}

export function getScrollPositionAtTime(
  scrollEvents: ScrollKeyframe[],
  currentTime: number,
): { scrollY: number } {
  if (scrollEvents.length === 0) return { scrollY: 0 };

  if (currentTime < scrollEvents[0].timestamp) {
    return { scrollY: scrollEvents[0].scrollY };
  }
  if (currentTime >= scrollEvents[scrollEvents.length - 1].timestamp) {
    return { scrollY: scrollEvents[scrollEvents.length - 1].scrollY };
  }

  const index = findSegmentIndex(scrollEvents, currentTime);
  const start = scrollEvents[index];
  const end = scrollEvents[index + 1];
  const progress = interpolationProgress(
    start.timestamp,
    end.timestamp,
    currentTime,
  );

  return {
    scrollY: start.scrollY + (end.scrollY - start.scrollY) * progress,
  };
}

export function getResizeDimensionsAtTime(
  resizeEvents: ResizeKeyframe[],
  currentTime: number,
  defaultWidth: number,
  defaultHeight: number,
): { width: number; height: number } {
  if (resizeEvents.length === 0) {
    return { width: defaultWidth, height: defaultHeight };
  }

  if (currentTime < resizeEvents[0].timestamp) {
    return { width: resizeEvents[0].width, height: resizeEvents[0].height };
  }
  if (currentTime >= resizeEvents[resizeEvents.length - 1].timestamp) {
    const last = resizeEvents[resizeEvents.length - 1];
    return { width: last.width, height: last.height };
  }

  const index = findSegmentIndex(resizeEvents, currentTime);
  const start = resizeEvents[index];
  const end = resizeEvents[index + 1];
  const progress = interpolationProgress(
    start.timestamp,
    end.timestamp,
    currentTime,
  );

  return {
    width: start.width + (end.width - start.width) * progress,
    height: start.height + (end.height - start.height) * progress,
  };
}

export function getZoomLevelAtTime(
  zoomEvents: ZoomKeyframe[],
  currentTime: number,
): number {
  if (zoomEvents.length === 0) return 1.0;

  if (currentTime < zoomEvents[0].timestamp) {
    return zoomEvents[0].zoom;
  }
  if (currentTime >= zoomEvents[zoomEvents.length - 1].timestamp) {
    return zoomEvents[zoomEvents.length - 1].zoom;
  }

  const index = findSegmentIndex(zoomEvents, currentTime);
  const start = zoomEvents[index];
  const end = zoomEvents[index + 1];
  const progress = interpolationProgress(
    start.timestamp,
    end.timestamp,
    currentTime,
  );

  return start.zoom + (end.zoom - start.zoom) * progress;
}

// Dynamic viewport renderer
const DynamicViewportRect = memo(
  ({
    viewport,
    currentTime,
    settings,
    livePageTitle,
    liveFaviconUrl,
  }: {
    viewport: ActiveViewport;
    currentTime: number;
    settings: {
      scrollSpeed: number;
      backgroundOpacity: number;
      randomizeColors?: boolean;
      showPagePreview?: boolean;
      allowOverlap?: boolean;
      showScrollEvents?: boolean;
      showResizeEvents?: boolean;
      showZoomEvents?: boolean;
      showTitleBar?: boolean;
      trailVisualStyle?: string;
    };
    livePageTitle?: string;
    liveFaviconUrl?: string;
  }) => {
    const {
      animation,
      rect,
      phase,
      phaseStartTime,
      animationStartTime,
      durationMs,
      backgroundSeed,
    } = viewport;
    const timeline = useMemo(
      () => buildViewportAnimationTimeline(animation),
      [animation],
    );

    // Calculate opacity based on phase
    let opacity = 1;
    if (phase === "fade-in") {
      const fadeProgress = Math.min(
        1,
        (currentTime - phaseStartTime) / FADE_IN_DURATION,
      );
      opacity = fadeProgress;
    } else if (phase === "fade-out") {
      const fadeProgress = Math.min(
        1,
        (currentTime - phaseStartTime) / FADE_OUT_DURATION,
      );
      opacity = 1 - fadeProgress;
    }

    // Calculate animation progress
    const animElapsed = Math.max(
      0,
      (currentTime - animationStartTime) * settings.scrollSpeed,
    );
    const animProgress =
      durationMs <= 0 ? 1 : Math.min(1, animElapsed / durationMs);
    const currentAnimTime =
      timeline.minTime + animProgress * timeline.timeRange;
    const scrollRange = timeline.scrollRange;

    // Calculate scroll position
    let scrollY = 0;
    if (animation.scrollEvents.length > 0) {
      const scrollResult = getScrollPositionAtTime(
        animation.scrollEvents,
        currentAnimTime,
      );
      scrollY = scrollResult.scrollY;
    }

    // Calculate resize and check if actively resizing
    let viewportWidth = rect.width;
    let viewportHeight = rect.height;
    let isActivelyResizing = false;

    if (animation.resizeEvents && animation.resizeEvents.length > 0) {
      const resizeData = getResizeDimensionsAtTime(
        animation.resizeEvents,
        currentAnimTime,
        animation.startViewportWidth,
        animation.startViewportHeight,
      );
      const widthScale = rect.width / Math.max(1, animation.startViewportWidth);
      const heightScale =
        rect.height / Math.max(1, animation.startViewportHeight);
      viewportWidth = resizeData.width * widthScale;
      viewportHeight = resizeData.height * heightScale;

      // Check if actively resizing
      const prevTime = Math.max(timeline.minTime, currentAnimTime - 50);
      const prevResize = getResizeDimensionsAtTime(
        animation.resizeEvents,
        prevTime,
        animation.startViewportWidth,
        animation.startViewportHeight,
      );
      isActivelyResizing =
        Math.abs(resizeData.width - prevResize.width) > 1 ||
        Math.abs(resizeData.height - prevResize.height) > 1;
    }

    // Calculate zoom and check if actively zooming
    let zoomLevel = 1.0;
    let isActivelyZooming = false;
    if (animation.zoomEvents && animation.zoomEvents.length > 0) {
      zoomLevel = getZoomLevelAtTime(animation.zoomEvents, currentAnimTime);

      // Check if actively zooming
      const prevTime = Math.max(timeline.minTime, currentAnimTime - 50);
      const prevZoom = getZoomLevelAtTime(animation.zoomEvents, prevTime);
      isActivelyZooming = Math.abs(zoomLevel - prevZoom) > 0.005;
    }

    // Visual calculations
    const visualWidth = viewportWidth;
    const visualHeight = viewportHeight;
    const visualX = rect.x + (rect.width - visualWidth) / 2;
    const visualY = rect.y + (rect.height - visualHeight) / 2;

    // Page height based on scroll range (bigger range = taller page)
    // Range of 0.1 (10%) = 2x viewport, range of 1.0 (100%) = 6x viewport
    const pageMultiplier = 2 + scrollRange * 4;
    const bgHeight = Math.max(
      0,
      Math.min(10000, visualHeight * pageMultiplier),
    );
    const scrollableHeight = bgHeight - visualHeight;
    const bgOffsetY = scrollY * scrollableHeight;

    const viewportCenterX = visualX + visualWidth / 2;
    const viewportCenterY = visualY + visualHeight / 2;
    const scrolledContentTransform =
      bgOffsetY === 0 ? undefined : `translate(0 ${-bgOffsetY})`;
    const zoomTransform =
      isActivelyZooming && zoomLevel !== 1.0
        ? `translate(${viewportCenterX}, ${viewportCenterY}) scale(${zoomLevel}) translate(${-viewportCenterX}, ${-viewportCenterY})`
        : undefined;

    // Seeded random for visual variety
    const localSeededRandom = useCallback(
      (offset: number = 0) => {
        const x = Math.sin(backgroundSeed + offset * 12.9898) * 43758.5453;
        return x - Math.floor(x);
      },
      [backgroundSeed],
    );

    // Determine edge tint color (participant color or random RISO color)
    const edgeTintColor = settings.randomizeColors
      ? RISO_COLORS[Math.floor(localSeededRandom(20) * RISO_COLORS.length)]
      : animation.color;

    // Color mode washes the whole window in the participant hue so the inner
    // (grayscale) content reads as a study in that color; monochrome keeps the
    // original near-white paper look.
    const mono = isMonochromeStyle(settings.trailVisualStyle);

    // Fill helper for the page-content elements (bands, blocks, depth layers):
    // grayscale in monochrome mode, re-hued into the window color in color mode
    // (preserving the original luminosity so contrast/structure is unchanged).
    // `satScale` lets light elements stay pale while darker ones saturate.
    const contentFill = useCallback(
      (lum: number, satScale = 0.7) =>
        mono
          ? `rgb(${Math.round(lum * 255)}, ${Math.round(lum * 255)}, ${Math.round(lum * 255)})`
          : colorizeLuminosity(edgeTintColor, lum, satScale),
      [mono, edgeTintColor],
    );

    const baseLuminosity = 0.85 + localSeededRandom(1) * 0.15;
    const colorValue = Math.round(baseLuminosity * 255);
    // Color mode: a clearly-tinted pastel window background (mid-light + decent
    // saturation so it reads as colored against the warm paper, not near-white).
    // Per-window lightness jitter keeps panels from looking identical.
    const bgLuminosity = 0.66 + localSeededRandom(1) * 0.12; // 0.66–0.78
    const backgroundColor = mono
      ? `rgb(${colorValue}, ${colorValue}, ${colorValue})`
      : colorizeLuminosity(edgeTintColor, bgLuminosity, 0.55);
    const opacityVariation = 0.92 + localSeededRandom(2) * 0.08;

    // Resize gets a dotted border without changing viewport brightness.
    // Neutral soft gray in both modes — a colored outline is too much once the
    // whole window is colored.
    const borderStrokeWidth = 2;
    const borderDashArray = isActivelyResizing ? "2 2" : "none";
    const borderColor = `rgb(180, 180, 180)`;

    // Content pattern variation based on seed
    const bandSpacing = Math.max(1, 60 + localSeededRandom(15) * 80); // 60-140px spacing
    const hasContentBlocks = localSeededRandom(16) > 0.4; // 60% chance of content blocks

    const bandRects = useMemo(
      () =>
        Array.from({ length: Math.ceil(bgHeight / bandSpacing) }, (_, i) => {
          const bandLuminosity = 0.4 + localSeededRandom(8 + i) * 0.2;
          const bandWidth =
            visualWidth * (0.3 + localSeededRandom(30 + i) * 0.6); // 30-90% width
          const bandX =
            visualX + localSeededRandom(40 + i) * (visualWidth - bandWidth);
          return (
            <rect
              key={`band-${i}`}
              x={bandX}
              y={visualY + i * bandSpacing}
              width={bandWidth}
              height={2}
              fill={contentFill(bandLuminosity)}
              opacity={0.25 + localSeededRandom(9 + i) * 0.15}
            />
          );
        }),
      [
        bgHeight,
        bandSpacing,
        localSeededRandom,
        visualWidth,
        visualX,
        visualY,
        contentFill,
      ],
    );

    const contentBlocks = useMemo(() => {
      if (!hasContentBlocks) return null;

      return Array.from({ length: Math.ceil(bgHeight / 180) }, (_, i) => {
        const blockY = visualY + i * 180 + 30;
        const sectionSeed = localSeededRandom(50 + i);

        // Determine section type: 70% light content, 20% medium, 10% dark accent
        const isDarkAccent = sectionSeed < 0.1;
        const isMediumBlock = sectionSeed >= 0.1 && sectionSeed < 0.3;

        // Light content colors (most common)
        const lightLuminosity = 0.55 + localSeededRandom(51 + i) * 0.25; // 0.55-0.8
        const lightFill = contentFill(lightLuminosity);

        // Dark accent colors (rare, dramatic) — saturate more so they read.
        const darkLuminosity = 0.08 + localSeededRandom(52 + i) * 0.2; // 0.08-0.28
        const darkFill = contentFill(darkLuminosity, 0.9);

        if (isDarkAccent) {
          // Atmospheric dark accent with gradient layers (cohesive with wash effects)
          const isLeft = localSeededRandom(63 + i) > 0.5;
          const blotchHeight = 60 + localSeededRandom(64 + i) * 80;
          const blotchWidth =
            visualWidth * (0.4 + localSeededRandom(65 + i) * 0.3);
          const xPos = isLeft
            ? visualX + visualWidth * 0.02
            : visualX + visualWidth - blotchWidth - visualWidth * 0.02;

          // Choose gradient direction based on position
          const gradientId = isLeft
            ? `wash-horizontal-${viewport.id}`
            : `wash-reverse-${viewport.id}`;
          const altGradientId =
            localSeededRandom(66 + i) > 0.5
              ? `wash-diagonal-${viewport.id}`
              : `wash-vertical-${viewport.id}`;

          return (
            <g key={`block-${i}`}>
              {/* Outermost layer - soft, large, lighter */}
              <g filter={`url(#ink-wash-${viewport.id})`}>
                <rect
                  x={xPos - blotchWidth * 0.1}
                  y={blockY - blotchHeight * 0.1}
                  width={blotchWidth * 1.2}
                  height={blotchHeight * 1.2}
                  fill={`url(#${gradientId})`}
                  opacity={0.4}
                />
              </g>

              {/* Middle layer - medium size, uses alt gradient */}
              <g filter={`url(#ink-wash-${viewport.id})`}>
                <rect
                  x={xPos + blotchWidth * 0.05}
                  y={blockY + blotchHeight * 0.08}
                  width={blotchWidth * 0.85}
                  height={blotchHeight * 0.8}
                  fill={`url(#${altGradientId})`}
                  opacity={0.55}
                />
              </g>

              {/* Core layer - smallest, darkest solid for depth */}
              <g filter={`url(#ink-wash-${viewport.id})`}>
                <rect
                  x={xPos + blotchWidth * 0.15}
                  y={blockY + blotchHeight * 0.2}
                  width={blotchWidth * 0.55}
                  height={blotchHeight * 0.5}
                  fill={darkFill}
                  opacity={0.7}
                />
              </g>

              {/* Accent gradient overlay - adds color variation */}
              <rect
                x={xPos}
                y={blockY}
                width={blotchWidth}
                height={blotchHeight}
                fill={`url(#${isLeft ? "wash-diagonal-" : "wash-reverse-"}${viewport.id})`}
                opacity={0.25}
              />

              {/* Speckle texture across all layers */}
              <rect
                x={xPos - blotchWidth * 0.1}
                y={blockY - blotchHeight * 0.1}
                width={blotchWidth * 1.2}
                height={blotchHeight * 1.2}
                fill="white"
                opacity={0.12}
                filter={`url(#speckle-${viewport.id})`}
              />

              {/* Scattered light dots for texture variation */}
              {[0, 1, 2].map((j) => {
                const dotX =
                  xPos + localSeededRandom(100 + i + j) * blotchWidth * 0.7;
                const dotY =
                  blockY + localSeededRandom(110 + i + j) * blotchHeight * 0.7;
                const dotSize = 3 + localSeededRandom(120 + i + j) * 5;
                return (
                  <circle
                    key={`dot-${j}`}
                    cx={dotX + blotchWidth * 0.15}
                    cy={dotY + blotchHeight * 0.15}
                    r={dotSize}
                    fill="white"
                    opacity={0.1 + localSeededRandom(130 + i + j) * 0.15}
                  />
                );
              })}
            </g>
          );
        } else if (isMediumBlock) {
          // Medium-toned block - single block, simple
          const mediumLuminosity = 0.4 + localSeededRandom(55 + i) * 0.2;
          const mediumFill = contentFill(mediumLuminosity);
          const blockHeight = 25 + localSeededRandom(61 + i) * 35;
          const isLeft = localSeededRandom(62 + i) > 0.5;

          return (
            <g key={`block-${i}`}>
              <rect
                x={
                  isLeft
                    ? visualX + visualWidth * 0.08
                    : visualX + visualWidth * 0.45
                }
                y={blockY}
                width={visualWidth * 0.47}
                height={blockHeight}
                fill={mediumFill}
                opacity={0.35}
                rx={2}
              />
            </g>
          );
        }

        // Light content blocks (most common) - varied layouts, sparse
        const layoutVariant = Math.floor(localSeededRandom(56 + i) * 5);

        if (layoutVariant === 0) {
          // Empty/whitespace - adds breathing room
          return <g key={`block-${i}`} />;
        } else if (layoutVariant === 1) {
          // Single wide block
          return (
            <g key={`block-${i}`}>
              <rect
                x={visualX + visualWidth * 0.1}
                y={blockY}
                width={visualWidth * 0.7}
                height={20 + localSeededRandom(60 + i) * 30}
                fill={lightFill}
                opacity={0.28}
                rx={2}
              />
            </g>
          );
        } else if (layoutVariant === 2) {
          // Two scattered rectangles (reduced from 3)
          return (
            <g key={`block-${i}`}>
              {[0, 1].map((j) => (
                <rect
                  key={`sub-${j}`}
                  x={
                    visualX +
                    visualWidth * (0.08 + j * 0.45) +
                    localSeededRandom(65 + i + j) * 15
                  }
                  y={blockY + localSeededRandom(66 + i + j) * 10}
                  width={
                    visualWidth * (0.2 + localSeededRandom(67 + i + j) * 0.15)
                  }
                  height={15 + localSeededRandom(68 + i + j) * 20}
                  fill={lightFill}
                  opacity={0.25 + localSeededRandom(69 + i + j) * 0.1}
                  rx={2}
                />
              ))}
            </g>
          );
        } else if (layoutVariant === 3) {
          // Two text-like lines (reduced from 4)
          return (
            <g key={`block-${i}`}>
              {[0, 1].map((j) => (
                <rect
                  key={`line-${j}`}
                  x={visualX + visualWidth * 0.1}
                  y={blockY + j * 10}
                  width={
                    visualWidth * (0.35 + localSeededRandom(80 + i + j) * 0.4)
                  }
                  height={2}
                  fill={lightFill}
                  opacity={0.2 + localSeededRandom(81 + i + j) * 0.1}
                />
              ))}
            </g>
          );
        }

        // Single side block (simplified from image + text)
        const isLeft = localSeededRandom(57 + i) > 0.5;
        const blockX = isLeft
          ? visualX + visualWidth * 0.08
          : visualX + visualWidth * 0.5;
        return (
          <g key={`block-${i}`}>
            <rect
              x={blockX}
              y={blockY}
              width={visualWidth * 0.42}
              height={30 + localSeededRandom(58 + i) * 25}
              fill={lightFill}
              opacity={0.3}
              rx={3}
            />
          </g>
        );
      });
    }, [
      bgHeight,
      hasContentBlocks,
      localSeededRandom,
      visualWidth,
      visualX,
      visualY,
      viewport.id,
      contentFill,
    ]);

    const gradientWashes = useMemo(() => {
      if (localSeededRandom(200) <= 0.4) return null;

      return Array.from({ length: Math.ceil(bgHeight / 350) }, (_, i) => {
        const washY = visualY + i * 350 + localSeededRandom(201 + i) * 100;
        const washType = Math.floor(localSeededRandom(202 + i) * 4);
        const washHeight = 80 + localSeededRandom(203 + i) * 120;
        const washWidth =
          visualWidth * (0.5 + localSeededRandom(204 + i) * 0.45);
        const isLeft = localSeededRandom(205 + i) > 0.5;
        const washX = isLeft ? visualX : visualX + visualWidth - washWidth;

        // Skip some to keep it sparse
        if (localSeededRandom(206 + i) < 0.35) return null;

        const gradientId =
          washType === 0
            ? `wash-vertical-${viewport.id}`
            : washType === 1
              ? `wash-horizontal-${viewport.id}`
              : washType === 2
                ? `wash-diagonal-${viewport.id}`
                : `wash-reverse-${viewport.id}`;

        return (
          <g key={`wash-${i}`} filter={`url(#ink-wash-${viewport.id})`}>
            {/* Main gradient wash */}
            <rect
              x={washX}
              y={washY}
              width={washWidth}
              height={washHeight}
              fill={`url(#${gradientId})`}
              opacity={0.5 + localSeededRandom(207 + i) * 0.3}
            />
            {/* Overlapping secondary layer - offset and semi-transparent */}
            <rect
              x={washX + (isLeft ? washWidth * 0.15 : -washWidth * 0.15)}
              y={washY + washHeight * 0.2}
              width={washWidth * 0.7}
              height={washHeight * 0.6}
              fill={`url(#${gradientId})`}
              opacity={0.35}
            />
            {/* Light speckle overlay for texture */}
            <rect
              x={washX}
              y={washY}
              width={washWidth}
              height={washHeight}
              fill="white"
              opacity={0.1}
              filter={`url(#speckle-${viewport.id})`}
            />
          </g>
        );
      });
    }, [
      bgHeight,
      localSeededRandom,
      visualWidth,
      visualX,
      visualY,
      viewport.id,
    ]);

    const depthLayers = useMemo(() => {
      if (localSeededRandom(300) <= 0.5) return null;

      return Array.from({ length: Math.ceil(bgHeight / 280) }, (_, i) => {
        const layerY = visualY + i * 280 + 60;

        // Skip most to keep sparse
        if (localSeededRandom(301 + i) < 0.5) return null;

        const baseX = visualX + localSeededRandom(302 + i) * visualWidth * 0.4;
        const baseWidth =
          visualWidth * (0.3 + localSeededRandom(303 + i) * 0.35);
        const baseHeight = 40 + localSeededRandom(304 + i) * 60;

        // Layer colors - varying grays
        const layer1Lum = 0.3 + localSeededRandom(305 + i) * 0.2;
        const layer2Lum = 0.45 + localSeededRandom(306 + i) * 0.2;
        const layer3Lum = 0.6 + localSeededRandom(307 + i) * 0.2;

        return (
          <g key={`layers-${i}`}>
            {/* Back layer - largest, lightest */}
            <rect
              x={baseX - 10}
              y={layerY - 8}
              width={baseWidth + 20}
              height={baseHeight + 16}
              fill={contentFill(layer3Lum)}
              opacity={0.25}
              rx={3}
            />
            {/* Middle layer */}
            <rect
              x={baseX + 5}
              y={layerY + 4}
              width={baseWidth - 5}
              height={baseHeight - 5}
              fill={contentFill(layer2Lum)}
              opacity={0.35}
              rx={2}
            />
            {/* Front layer - smallest, darkest */}
            <rect
              x={baseX + 15}
              y={layerY + 12}
              width={baseWidth - 25}
              height={baseHeight - 20}
              fill={contentFill(layer1Lum, 0.85)}
              opacity={0.45}
              rx={2}
            />
          </g>
        );
      });
    }, [
      bgHeight,
      localSeededRandom,
      visualWidth,
      visualX,
      visualY,
      contentFill,
    ]);

    // Scrollbar thumb size based on page length (smaller thumb = longer page)
    // Direct mapping: scrollRange 0.1 (short scroll) → 36px, scrollRange 1.0 (full page) → 6px
    const trackHeight = visualHeight - 8;
    // Normalize scrollRange from 0.1-1.0 to 0-1 for interpolation
    const normalizedRange = Math.min(1, (scrollRange - 0.1) / 0.9);
    // Lerp from 36px (short page) to 6px (long page)
    const thumbHeight = Math.round(36 - normalizedRange * 30);
    const thumbTravel = trackHeight - thumbHeight;

    // Scrollbar colors — tinted to the window hue in color mode.
    const scrollbarTrackColor = mono
      ? `rgb(200, 200, 200)`
      : colorWash(edgeTintColor, 0.3, 20);
    const scrollbarThumbLuminosity = 0.4 + localSeededRandom(21) * 0.2; // 0.4-0.6
    const scrollbarThumbColorValue = Math.round(scrollbarThumbLuminosity * 255);
    const scrollbarThumbColor = mono
      ? `rgb(${scrollbarThumbColorValue}, ${scrollbarThumbColorValue}, ${scrollbarThumbColorValue})`
      : colorShade(edgeTintColor, 45);

    const debug = useDebugHover();
    const showDebug = () => {
      if (!debug.enabled) return;
      const scrollCount = animation.scrollEvents.length;
      const resizeCount = animation.resizeEvents?.length ?? 0;
      const zoomCount = animation.zoomEvents?.length ?? 0;
      debug.show({
        kind: "Scroll viewport",
        id: viewport.id,
        color: animation.color,
        title: animation.pageTitle || animation.pageUrl,
        fields: [
          { label: "url", value: animation.pageUrl },
          { label: "scrolls", value: String(scrollCount) },
          { label: "resizes", value: String(resizeCount) },
          { label: "zooms", value: String(zoomCount) },
          {
            label: "duration",
            value: `${Math.round((animation.endTime - animation.startTime) / 1000)}s`,
          },
          {
            label: "viewport",
            value: `${animation.startViewportWidth}×${animation.startViewportHeight}`,
          },
          {
            label: "pid",
            value: `${animation.participantId.slice(0, 7)}…${animation.participantId.slice(-4)}`,
          },
        ],
      });
    };
    const hideDebug = () => {
      if (!debug.enabled) return;
      debug.hide(viewport.id);
    };

    return (
      <g
        opacity={opacity}
        style={{
          transition: "opacity 0.1s ease-out",
          pointerEvents: debug.enabled ? "auto" : undefined,
          cursor: debug.enabled ? "help" : undefined,
        }}
        onMouseEnter={debug.enabled ? showDebug : undefined}
        onMouseMove={debug.enabled ? showDebug : undefined}
        onMouseLeave={debug.enabled ? hideDebug : undefined}
      >
        <defs>
          <clipPath id={`viewport-clip-${viewport.id}`}>
            <rect
              x={visualX}
              y={visualY}
              width={visualWidth}
              height={visualHeight}
            />
          </clipPath>
          {/* Edge tint gradient for inner glow effect */}
          <linearGradient
            id={`edge-tint-left-${viewport.id}`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor={edgeTintColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={edgeTintColor} stopOpacity="0" />
          </linearGradient>
          {/* Ink wash texture filter */}
          <filter
            id={`ink-wash-${viewport.id}`}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.04"
              numOctaves="3"
              seed={backgroundSeed}
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="3"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
          {/* Color-mottle filter: turns a solid fill into organic, splotchy
              patches by using high-contrast fractal noise as the alpha. Low
              frequency = big blobs; the discrete alpha ramp makes hard-edged
              patches (paint-soak look) rather than a smooth gradient. */}
          <filter
            id={`color-mottle-${viewport.id}`}
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012 0.018"
              numOctaves="4"
              seed={backgroundSeed + 37}
              result="blobs"
            />
            <feColorMatrix
              in="blobs"
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1.6 -0.5"
              result="mask"
            />
            <feComponentTransfer in="mask" result="rampedMask">
              <feFuncA type="discrete" tableValues="0 0.25 0.5 0.7 0.9 1" />
            </feComponentTransfer>
            <feComposite in="SourceGraphic" in2="rampedMask" operator="in" />
          </filter>
          {/* Speckle texture filter */}
          <filter
            id={`speckle-${viewport.id}`}
            x="0%"
            y="0%"
            width="100%"
            height="100%"
          >
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.5"
              numOctaves="4"
              seed={backgroundSeed + 100}
              result="noise"
            />
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 15 -7"
              result="speckles"
            />
            <feComposite
              in="SourceGraphic"
              in2="speckles"
              operator="arithmetic"
              k1="0"
              k2="1"
              k3="0.15"
              k4="0"
            />
          </filter>
          <linearGradient
            id={`edge-tint-right-${viewport.id}`}
            x1="100%"
            y1="0%"
            x2="0%"
            y2="0%"
          >
            <stop offset="0%" stopColor={edgeTintColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={edgeTintColor} stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id={`edge-tint-top-${viewport.id}`}
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor={edgeTintColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={edgeTintColor} stopOpacity="0" />
          </linearGradient>
          <linearGradient
            id={`edge-tint-bottom-${viewport.id}`}
            x1="0%"
            y1="100%"
            x2="0%"
            y2="0%"
          >
            <stop offset="0%" stopColor={edgeTintColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={edgeTintColor} stopOpacity="0" />
          </linearGradient>
          {/* Gradient wash - vertical dark to light */}
          <linearGradient
            id={`wash-vertical-${viewport.id}`}
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
          >
            <stop offset="0%" stopColor="rgb(40,40,40)" stopOpacity="0.7" />
            <stop offset="40%" stopColor="rgb(80,80,80)" stopOpacity="0.4" />
            <stop
              offset="100%"
              stopColor="rgb(180,180,180)"
              stopOpacity="0.1"
            />
          </linearGradient>
          {/* Gradient wash - horizontal dark to light */}
          <linearGradient
            id={`wash-horizontal-${viewport.id}`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
          >
            <stop offset="0%" stopColor="rgb(30,30,30)" stopOpacity="0.65" />
            <stop offset="50%" stopColor="rgb(100,100,100)" stopOpacity="0.3" />
            <stop
              offset="100%"
              stopColor="rgb(200,200,200)"
              stopOpacity="0.05"
            />
          </linearGradient>
          {/* Gradient wash - diagonal */}
          <linearGradient
            id={`wash-diagonal-${viewport.id}`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
          >
            <stop offset="0%" stopColor="rgb(25,25,25)" stopOpacity="0.6" />
            <stop
              offset="60%"
              stopColor="rgb(120,120,120)"
              stopOpacity="0.25"
            />
            <stop offset="100%" stopColor="rgb(220,220,220)" stopOpacity="0" />
          </linearGradient>
          {/* Reverse gradient wash */}
          <linearGradient
            id={`wash-reverse-${viewport.id}`}
            x1="100%"
            y1="100%"
            x2="0%"
            y2="0%"
          >
            <stop offset="0%" stopColor="rgb(35,35,35)" stopOpacity="0.55" />
            <stop offset="70%" stopColor="rgb(140,140,140)" stopOpacity="0.2" />
            <stop offset="100%" stopColor="rgb(210,210,210)" stopOpacity="0" />
          </linearGradient>
        </defs>

        <g clipPath={`url(#viewport-clip-${viewport.id})`}>
          <g transform={zoomTransform || undefined}>
            <g transform={scrolledContentTransform}>
              {/* Background */}
              <rect
                x={visualX}
                y={visualY}
                width={visualWidth}
                height={bgHeight}
                fill={backgroundColor}
                filter="url(#scrollNoise)"
                opacity={settings.backgroundOpacity * opacityVariation}
              />
              <rect
                x={visualX}
                y={visualY}
                width={visualWidth}
                height={bgHeight}
                fill="#000"
                filter="url(#scrollGrain)"
                opacity={settings.backgroundOpacity * 0.15 * opacityVariation}
              />

              {/* Content pattern - horizontal bands with varied spacing */}
              <g
                opacity={
                  settings.backgroundOpacity *
                  (0.25 + localSeededRandom(7) * 0.1)
                }
              >
                {bandRects}
              </g>

              {/* Content blocks - mostly light/subtle with occasional dark ink accents */}
              {contentBlocks && (
                <g opacity={settings.backgroundOpacity * 0.5}>
                  {contentBlocks}
                </g>
              )}

              {/* Gradient washes - occasional large atmospheric areas */}
              {gradientWashes && (
                <g opacity={settings.backgroundOpacity * 0.6}>
                  {gradientWashes}
                </g>
              )}

              {/* Overlapping depth layers - scattered semi-transparent shapes */}
              {depthLayers && (
                <g opacity={settings.backgroundOpacity * 0.4}>{depthLayers}</g>
              )}
            </g>
          </g>

          {/* Abstract pixelated page preview via iframe */}
          {settings.showPagePreview && animation.pageUrl && (
            <PagePreview
              url={animation.pageUrl}
              x={visualX}
              y={visualY}
              width={visualWidth}
              height={visualHeight}
              scrollY={scrollY}
              scrollRange={scrollRange}
            />
          )}

          {/* Edge tint overlays — inner glow. Only in monochrome mode, where
              it's the sole color accent; in color mode the whole window is
              already colored, so the glow is too much. */}
          {mono && (
            <>
              <rect
                x={visualX}
                y={visualY}
                width={12}
                height={visualHeight}
                fill={`url(#edge-tint-left-${viewport.id})`}
              />
              <rect
                x={visualX + visualWidth - 12}
                y={visualY}
                width={12}
                height={visualHeight}
                fill={`url(#edge-tint-right-${viewport.id})`}
              />
              <rect
                x={visualX}
                y={visualY}
                width={visualWidth}
                height={12}
                fill={`url(#edge-tint-top-${viewport.id})`}
              />
              <rect
                x={visualX}
                y={visualY + visualHeight - 12}
                width={visualWidth}
                height={12}
                fill={`url(#edge-tint-bottom-${viewport.id})`}
              />
            </>
          )}
        </g>

        {/* Window title bar — favicon + page title, browser-chrome style */}
        {settings.showTitleBar !== false && (
          <ViewportTitleBar
            viewportId={viewport.id}
            x={visualX}
            y={visualY}
            width={visualWidth}
            height={visualHeight}
            pageUrl={animation.pageUrl}
            pageTitle={livePageTitle ?? animation.pageTitle}
            faviconUrl={liveFaviconUrl ?? animation.faviconUrl}
            accentColor={edgeTintColor}
          />
        )}

        {/* Viewport border */}
        <rect
          x={visualX}
          y={visualY}
          width={visualWidth}
          height={visualHeight}
          fill="none"
          stroke={borderColor}
          strokeWidth={borderStrokeWidth}
          strokeDasharray={borderDashArray}
          opacity={0.7 + localSeededRandom(4) * 0.2}
        />

        {/* Scrollbar with scaled thumb (monochrome) */}
        {animation.scrollEvents.length > 0 && (
          <>
            <rect
              x={visualX + visualWidth - 8}
              y={visualY + 4}
              width={4}
              height={trackHeight}
              fill={scrollbarTrackColor}
              opacity={0.2 + localSeededRandom(5) * 0.1}
              rx={2}
            />
            <rect
              x={visualX + visualWidth - 8}
              y={visualY + 4 + scrollY * thumbTravel}
              width={4}
              height={thumbHeight}
              fill={scrollbarThumbColor}
              opacity={0.6 + localSeededRandom(6) * 0.2}
              rx={2}
            />
          </>
        )}
      </g>
    );
  },
);

// Renders a thin browser-chrome-style title bar across the top of a viewport.
// Sized relative to viewport width so it stays legible at any scale.
const TITLE_BAR_MIN_HEIGHT = 14;
const TITLE_BAR_MAX_HEIGHT = 22;

const ViewportTitleBar = memo(
  ({
    viewportId,
    x,
    y,
    width,
    height,
    pageUrl,
    pageTitle,
    faviconUrl,
    accentColor,
  }: {
    viewportId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    pageUrl: string;
    pageTitle?: string;
    faviconUrl?: string;
    accentColor: string;
  }) => {
    const barHeight = Math.max(
      TITLE_BAR_MIN_HEIGHT,
      Math.min(TITLE_BAR_MAX_HEIGHT, Math.round(height * 0.075)),
    );
    const padX = Math.max(4, Math.round(barHeight * 0.45));
    const iconSize = Math.max(8, barHeight - 6);
    const fontSize = Math.max(8, Math.round(barHeight * 0.55));

    const domain = extractDomain(pageUrl);
    const displayTitle =
      (pageTitle && pageTitle.trim()) ||
      deriveTitleFromUrl(pageUrl) ||
      domain ||
      pageUrl;
    const resolvedFavicon =
      faviconUrl ||
      (domain
        ? `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
        : undefined);

    const clipId = `titlebar-clip-${viewportId}`;
    const washId = `titlebar-wash-${viewportId}`;

    return (
      <g pointerEvents="none">
        <defs>
          <clipPath id={clipId}>
            <rect x={x} y={y} width={width} height={barHeight} />
          </clipPath>
          <linearGradient id={washId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgb(245,240,232)" stopOpacity="0.95" />
            <stop
              offset="100%"
              stopColor="rgb(210,204,193)"
              stopOpacity="0.85"
            />
          </linearGradient>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          {/* Base wash */}
          <rect
            x={x}
            y={y}
            width={width}
            height={barHeight}
            fill={`url(#${washId})`}
          />
          {/* Subtle paper noise to match the textured aesthetic */}
          <rect
            x={x}
            y={y}
            width={width}
            height={barHeight}
            fill="#000"
            filter="url(#scrollGrain)"
            opacity={0.08}
          />
          {/* Hairline accent across the bottom edge in the participant/RISO color */}
          <rect
            x={x}
            y={y + barHeight - 1}
            width={width}
            height={1}
            fill={accentColor}
            opacity={0.45}
          />

          {/* Favicon */}
          {resolvedFavicon && (
            <image
              href={resolvedFavicon}
              x={x + padX}
              y={y + (barHeight - iconSize) / 2}
              width={iconSize}
              height={iconSize}
              preserveAspectRatio="xMidYMid meet"
            />
          )}

          {/* Title text */}
          <text
            x={x + padX + (resolvedFavicon ? iconSize + padX * 0.6 : 0)}
            y={y + barHeight / 2}
            fontSize={fontSize}
            fontFamily="Atkinson Hyperlegible, system-ui, sans-serif"
            fill="rgb(61, 56, 51)"
            opacity={0.85}
            dominantBaseline="central"
          >
            {displayTitle}
          </text>
        </g>
      </g>
    );
  },
);
ViewportTitleBar.displayName = "ViewportTitleBar";
