// ABOUTME: Dynamic animated scroll viewport visualization component
// ABOUTME: Renders viewports on-demand with fade transitions and dynamic space packing
import React, { useState, useEffect, useRef, memo, useCallback } from "react";
import { ScrollAnimation, ActiveViewport, ViewportPhase } from "./types";

// Configuration constants
const FADE_IN_DURATION = 400; // ms
const FADE_OUT_DURATION = 600; // ms
const FADE_OUT_DELAY = 300; // ms after animation ends before starting fade out
const FILL_CHECK_INTERVAL = 300; // ms between checking for empty spaces
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
  };
}

// RISO-inspired color palette for randomization
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
const calculateViewportSize = (
  animation: ScrollAnimation,
  canvasWidth: number,
  canvasHeight: number,
  seed: number,
): { width: number; height: number } => {
  // Get original viewport dimensions and aspect ratio
  const avgWidth =
    (animation.startViewportWidth + animation.endViewportWidth) / 2;
  const avgHeight =
    (animation.startViewportHeight + animation.endViewportHeight) / 2;
  const aspectRatio = avgWidth / Math.max(1, avgHeight);

  // Target scale with some randomization (15-35% of canvas)
  const targetScale = 0.15 + seededRandom(seed, 10) * 0.2;

  // Calculate base dimensions preserving aspect ratio
  let width = canvasWidth * targetScale;
  let height = width / aspectRatio;

  // If height exceeds bounds, scale down by height instead
  const maxWidth = canvasWidth * 0.5;
  const maxHeight = canvasHeight * 0.5;

  if (width > maxWidth) {
    width = maxWidth;
    height = width / aspectRatio;
  }

  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }

  // Ensure minimum size while preserving aspect ratio
  if (width < MIN_VIEWPORT_SIZE) {
    width = MIN_VIEWPORT_SIZE;
    height = width / aspectRatio;
  }

  if (height < MIN_VIEWPORT_SIZE) {
    height = MIN_VIEWPORT_SIZE;
    width = height * aspectRatio;
  }

  return { width, height };
};

export const AnimatedScrollViewports: React.FC<AnimatedScrollViewportsProps> =
  memo(({ animations, canvasSize, settings }) => {
    const [activeViewports, setActiveViewports] = useState<ActiveViewport[]>(
      [],
    );
    const animationQueueRef = useRef<ScrollAnimation[]>([]);
    const queueIndexRef = useRef(0);
    const animationFrameRef = useRef<number>();
    const lastFillCheckRef = useRef(0);
    const startTimeRef = useRef<number | null>(null);

    // Settings ref to avoid re-renders
    const settingsRef = useRef(settings);
    useEffect(() => {
      settingsRef.current = settings;
    }, [settings]);

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

        // Count non-fading-out viewports
        const activeCount = activeViewports.filter(
          (v) => v.phase !== "fade-out",
        ).length;

        if (activeCount >= maxConcurrentScrolls) {
          return; // At capacity
        }

        const animation = getNextAnimation();
        if (!animation) return;

        // Calculate size for this viewport
        const seed =
          hashString(animation.participantId + animation.sessionId) +
          currentTime;
        const size = calculateViewportSize(
          animation,
          canvasSize.width,
          canvasSize.height,
          seed,
        );

        // Get occupied rects (exclude fading-out viewports from collision)
        const occupiedRects = activeViewports
          .filter((v) => v.phase !== "fade-out")
          .map((v) => v.rect);

        // Find available position
        const position = findAvailablePosition(
          size.width,
          size.height,
          occupiedRects,
          canvasSize.width,
          canvasSize.height,
          seed,
        );

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

        setActiveViewports((prev) => [...prev, newViewport]);
        console.log(
          `[Scroll Dynamic] Added viewport ${newViewport.id}, now ${
            activeCount + 1
          } active`,
        );
      },
      [activeViewports, canvasSize, getNextAnimation],
    );

    // Update viewport phases based on time
    const updateViewports = useCallback((currentTime: number) => {
      setActiveViewports((prev) => {
        let changed = false;
        const updated = prev.map((viewport) => {
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

        return changed ? filtered : prev;
      });
    }, []);

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

        animationFrameRef.current = requestAnimationFrame(animate);
      };

      animationFrameRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }, [animations.length, canvasSize.width, updateViewports, tryAddViewport]);

    // Force re-render on each frame for smooth animations
    const [, setFrame] = useState(0);
    useEffect(() => {
      let frameId: number;
      const tick = () => {
        setFrame((f) => f + 1);
        frameId = requestAnimationFrame(tick);
      };
      frameId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frameId);
    }, []);

    if (animations.length === 0) {
      return null;
    }

    const currentTime =
      startTimeRef.current !== null
        ? performance.now() - startTimeRef.current
        : 0;

    return (
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        <defs>
          <filter id="scrollNoise">
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

        {activeViewports.map((viewport) => (
          <DynamicViewportRect
            key={viewport.id}
            viewport={viewport}
            currentTime={currentTime}
            settings={settingsRef.current}
          />
        ))}
      </svg>
    );
  });

// Helper functions for animation calculations (unchanged from original)
function calculateScrollPosition(
  scrollEvents: Array<{
    scrollY: number;
    timestamp: number;
    viewportWidth: number;
    viewportHeight: number;
  }>,
  currentTime: number,
): { scrollY: number } {
  if (scrollEvents.length === 0) return { scrollY: 0 };

  if (currentTime < scrollEvents[0].timestamp) {
    return { scrollY: scrollEvents[0].scrollY };
  }
  if (currentTime >= scrollEvents[scrollEvents.length - 1].timestamp) {
    return { scrollY: scrollEvents[scrollEvents.length - 1].scrollY };
  }

  for (let i = 0; i < scrollEvents.length - 1; i++) {
    if (
      scrollEvents[i].timestamp <= currentTime &&
      scrollEvents[i + 1].timestamp > currentTime
    ) {
      const progress =
        (currentTime - scrollEvents[i].timestamp) /
        (scrollEvents[i + 1].timestamp - scrollEvents[i].timestamp);
      return {
        scrollY:
          scrollEvents[i].scrollY +
          (scrollEvents[i + 1].scrollY - scrollEvents[i].scrollY) * progress,
      };
    }
  }

  return { scrollY: scrollEvents[0].scrollY };
}

function calculateResizeDimensions(
  resizeEvents: Array<{ width: number; height: number; timestamp: number }>,
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

  for (let i = 0; i < resizeEvents.length - 1; i++) {
    if (
      resizeEvents[i].timestamp <= currentTime &&
      resizeEvents[i + 1].timestamp > currentTime
    ) {
      const progress =
        (currentTime - resizeEvents[i].timestamp) /
        (resizeEvents[i + 1].timestamp - resizeEvents[i].timestamp);
      return {
        width:
          resizeEvents[i].width +
          (resizeEvents[i + 1].width - resizeEvents[i].width) * progress,
        height:
          resizeEvents[i].height +
          (resizeEvents[i + 1].height - resizeEvents[i].height) * progress,
      };
    }
  }

  return { width: defaultWidth, height: defaultHeight };
}

function calculateZoomLevel(
  zoomEvents: Array<{ zoom: number; timestamp: number }>,
  currentTime: number,
): number {
  if (zoomEvents.length === 0) return 1.0;

  if (currentTime < zoomEvents[0].timestamp) {
    return zoomEvents[0].zoom;
  }
  if (currentTime >= zoomEvents[zoomEvents.length - 1].timestamp) {
    return zoomEvents[zoomEvents.length - 1].zoom;
  }

  for (let i = 0; i < zoomEvents.length - 1; i++) {
    if (
      zoomEvents[i].timestamp <= currentTime &&
      zoomEvents[i + 1].timestamp > currentTime
    ) {
      const progress =
        (currentTime - zoomEvents[i].timestamp) /
        (zoomEvents[i + 1].timestamp - zoomEvents[i].timestamp);
      return (
        zoomEvents[i].zoom +
        (zoomEvents[i + 1].zoom - zoomEvents[i].zoom) * progress
      );
    }
  }

  return 1.0;
}

// Dynamic viewport renderer
const DynamicViewportRect = memo(
  ({
    viewport,
    currentTime,
    settings,
  }: {
    viewport: ActiveViewport;
    currentTime: number;
    settings: {
      scrollSpeed: number;
      backgroundOpacity: number;
      randomizeColors?: boolean;
    };
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
    const animProgress = Math.min(1, animElapsed / durationMs);

    // Get the animation's time range
    const allTimestamps = [
      ...animation.scrollEvents.map((e) => e.timestamp),
      ...(animation.resizeEvents?.map((e) => e.timestamp) || []),
      ...(animation.zoomEvents?.map((e) => e.timestamp) || []),
    ];

    if (allTimestamps.length === 0) {
      return null;
    }

    const minTime = Math.min(...allTimestamps);
    const maxTime = Math.max(...allTimestamps);
    const timeRange = maxTime - minTime;
    const currentAnimTime = minTime + animProgress * timeRange;

    // Calculate scroll range to determine "page length"
    let scrollRange = 1; // Default: full page
    let minScrollY = 0;
    let maxScrollY = 1;
    if (animation.scrollEvents.length >= 2) {
      const scrollYValues = animation.scrollEvents.map((e) => e.scrollY);
      minScrollY = Math.min(...scrollYValues);
      maxScrollY = Math.max(...scrollYValues);
      scrollRange = Math.max(0.1, maxScrollY - minScrollY); // At least 10%
    }

    // Calculate scroll position and check if actively scrolling
    let scrollY = 0;
    let isActivelyScrolling = false;
    if (animation.scrollEvents.length > 0) {
      const scrollResult = calculateScrollPosition(
        animation.scrollEvents,
        currentAnimTime,
      );
      scrollY = scrollResult.scrollY;

      // Check if scroll position is changing (compare to slightly earlier time)
      const prevTime = Math.max(minTime, currentAnimTime - 50);
      const prevScroll = calculateScrollPosition(
        animation.scrollEvents,
        prevTime,
      ).scrollY;
      isActivelyScrolling = Math.abs(scrollY - prevScroll) > 0.001;
    }

    // Calculate resize and check if actively resizing
    let viewportWidth = rect.width;
    let viewportHeight = rect.height;
    let isActivelyResizing = false;

    if (animation.resizeEvents && animation.resizeEvents.length > 0) {
      const resizeData = calculateResizeDimensions(
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
      const prevTime = Math.max(minTime, currentAnimTime - 50);
      const prevResize = calculateResizeDimensions(
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
      zoomLevel = calculateZoomLevel(
        animation.zoomEvents.map((e) => ({
          zoom: e.zoom,
          timestamp: e.timestamp,
        })),
        currentAnimTime,
      );

      // Check if actively zooming
      const prevTime = Math.max(minTime, currentAnimTime - 50);
      const prevZoom = calculateZoomLevel(
        animation.zoomEvents.map((e) => ({
          zoom: e.zoom,
          timestamp: e.timestamp,
        })),
        prevTime,
      );
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
    const bgHeight = visualHeight * pageMultiplier;
    const scrollableHeight = bgHeight - visualHeight;
    const bgOffsetY = scrollY * scrollableHeight;

    const viewportCenterX = visualX + visualWidth / 2;
    const viewportCenterY = visualY + visualHeight / 2;
    const zoomTransform =
      isActivelyZooming && zoomLevel !== 1.0
        ? `translate(${viewportCenterX}, ${viewportCenterY}) scale(${zoomLevel}) translate(${-viewportCenterX}, ${-viewportCenterY})`
        : undefined;

    // Seeded random for visual variety
    const localSeededRandom = (offset: number = 0) => {
      const x = Math.sin(backgroundSeed + offset * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    // Determine edge tint color (participant color or random RISO color)
    const edgeTintColor = settings.randomizeColors
      ? RISO_COLORS[Math.floor(localSeededRandom(20) * RISO_COLORS.length)]
      : animation.color;

    const baseLuminosity = 0.85 + localSeededRandom(1) * 0.15;
    const colorValue = Math.round(baseLuminosity * 255);
    const backgroundColor = `rgb(${colorValue}, ${colorValue}, ${colorValue})`;
    const opacityVariation = 0.92 + localSeededRandom(2) * 0.08;

    // Border style based on active animation type
    let borderStrokeWidth = 2;
    let borderDashArray = "none";
    let borderColor = `rgb(180, 180, 180)`; // Default gray

    if (isActivelyZooming) {
      borderStrokeWidth = 4;
      borderDashArray = "6 3"; // Dashed for zoom
      borderColor = edgeTintColor;
    } else if (isActivelyResizing) {
      borderStrokeWidth = 4;
      borderDashArray = "2 2"; // Dotted for resize
      borderColor = edgeTintColor;
    } else if (isActivelyScrolling) {
      borderStrokeWidth = 3;
      borderDashArray = "none"; // Solid for scroll
      borderColor = edgeTintColor;
    }

    // Content pattern variation based on seed
    const bandSpacing = 60 + localSeededRandom(15) * 80; // 60-140px spacing
    const hasContentBlocks = localSeededRandom(16) > 0.4; // 60% chance of content blocks
    const blockPattern = Math.floor(localSeededRandom(17) * 4); // 4 different patterns

    // Scrollbar thumb size based on page length (smaller thumb = longer page)
    // Direct mapping: scrollRange 0.1 (short scroll) → 36px, scrollRange 1.0 (full page) → 6px
    const trackHeight = visualHeight - 8;
    // Normalize scrollRange from 0.1-1.0 to 0-1 for interpolation
    const normalizedRange = Math.min(1, (scrollRange - 0.1) / 0.9);
    // Lerp from 36px (short page) to 6px (long page)
    const thumbHeight = Math.round(36 - normalizedRange * 30);
    const thumbTravel = trackHeight - thumbHeight;

    // Scrollbar colors (monochrome)
    const scrollbarTrackColor = `rgb(200, 200, 200)`;
    const scrollbarThumbLuminosity = 0.4 + localSeededRandom(21) * 0.2; // 0.4-0.6
    const scrollbarThumbColorValue = Math.round(scrollbarThumbLuminosity * 255);
    const scrollbarThumbColor = `rgb(${scrollbarThumbColorValue}, ${scrollbarThumbColorValue}, ${scrollbarThumbColorValue})`;

    return (
      <g opacity={opacity} style={{ transition: "opacity 0.1s ease-out" }}>
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
            {/* Background */}
            <rect
              x={visualX}
              y={visualY - bgOffsetY}
              width={visualWidth}
              height={bgHeight}
              fill={backgroundColor}
              filter="url(#scrollNoise)"
              opacity={settings.backgroundOpacity * opacityVariation}
            />
            <rect
              x={visualX}
              y={visualY - bgOffsetY}
              width={visualWidth}
              height={bgHeight}
              fill="#000"
              filter="url(#scrollGrain)"
              opacity={settings.backgroundOpacity * 0.15 * opacityVariation}
            />

            {/* Content pattern - horizontal bands with varied spacing */}
            <g
              opacity={
                settings.backgroundOpacity * (0.25 + localSeededRandom(7) * 0.1)
              }
            >
              {Array.from(
                { length: Math.ceil(bgHeight / bandSpacing) },
                (_, i) => {
                  const bandLuminosity = 0.4 + localSeededRandom(8 + i) * 0.2;
                  const bandColorValue = Math.round(bandLuminosity * 255);
                  const bandWidth =
                    visualWidth * (0.3 + localSeededRandom(30 + i) * 0.6); // 30-90% width
                  const bandX =
                    visualX +
                    localSeededRandom(40 + i) * (visualWidth - bandWidth);
                  return (
                    <rect
                      key={`band-${i}`}
                      x={bandX}
                      y={visualY - bgOffsetY + i * bandSpacing}
                      width={bandWidth}
                      height={2}
                      fill={`rgb(${bandColorValue}, ${bandColorValue}, ${bandColorValue})`}
                      opacity={0.25 + localSeededRandom(9 + i) * 0.15}
                    />
                  );
                },
              )}
            </g>

            {/* Content blocks - mostly light/subtle with occasional dark ink accents */}
            {hasContentBlocks && (
              <g opacity={settings.backgroundOpacity * 0.5}>
                {Array.from({ length: Math.ceil(bgHeight / 180) }, (_, i) => {
                  const blockY = visualY - bgOffsetY + i * 180 + 30;
                  const sectionSeed = localSeededRandom(50 + i);

                  // Determine section type: 70% light content, 20% medium, 10% dark accent
                  const isDarkAccent = sectionSeed < 0.1;
                  const isMediumBlock = sectionSeed >= 0.1 && sectionSeed < 0.3;

                  // Light content colors (most common)
                  const lightLuminosity =
                    0.55 + localSeededRandom(51 + i) * 0.25; // 0.55-0.8
                  const lightColorValue = Math.round(lightLuminosity * 255);
                  const lightFill = `rgb(${lightColorValue}, ${lightColorValue}, ${lightColorValue})`;

                  // Dark accent colors (rare, dramatic)
                  const darkLuminosity = 0.08 + localSeededRandom(52 + i) * 0.2; // 0.08-0.28
                  const darkColorValue = Math.round(darkLuminosity * 255);
                  const darkFill = `rgb(${darkColorValue}, ${darkColorValue}, ${darkColorValue})`;

                  if (isDarkAccent) {
                    // Atmospheric dark accent with gradient layers (cohesive with wash effects)
                    const isLeft = localSeededRandom(63 + i) > 0.5;
                    const blotchHeight = 60 + localSeededRandom(64 + i) * 80;
                    const blotchWidth =
                      visualWidth * (0.4 + localSeededRandom(65 + i) * 0.3);
                    const xPos = isLeft
                      ? visualX + visualWidth * 0.02
                      : visualX +
                        visualWidth -
                        blotchWidth -
                        visualWidth * 0.02;

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
                          fill={`url(#${
                            isLeft ? "wash-diagonal-" : "wash-reverse-"
                          }${viewport.id})`}
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
                            xPos +
                            localSeededRandom(100 + i + j) * blotchWidth * 0.7;
                          const dotY =
                            blockY +
                            localSeededRandom(110 + i + j) * blotchHeight * 0.7;
                          const dotSize =
                            3 + localSeededRandom(120 + i + j) * 5;
                          return (
                            <circle
                              key={`dot-${j}`}
                              cx={dotX + blotchWidth * 0.15}
                              cy={dotY + blotchHeight * 0.15}
                              r={dotSize}
                              fill="white"
                              opacity={
                                0.1 + localSeededRandom(130 + i + j) * 0.15
                              }
                            />
                          );
                        })}
                      </g>
                    );
                  } else if (isMediumBlock) {
                    // Medium-toned block - single block, simple
                    const mediumLuminosity =
                      0.4 + localSeededRandom(55 + i) * 0.2;
                    const mediumColorValue = Math.round(mediumLuminosity * 255);
                    const mediumFill = `rgb(${mediumColorValue}, ${mediumColorValue}, ${mediumColorValue})`;
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
                  } else {
                    // Light content blocks (most common) - varied layouts, sparse
                    const layoutVariant = Math.floor(
                      localSeededRandom(56 + i) * 5,
                    );

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
                                visualWidth *
                                (0.2 + localSeededRandom(67 + i + j) * 0.15)
                              }
                              height={15 + localSeededRandom(68 + i + j) * 20}
                              fill={lightFill}
                              opacity={
                                0.25 + localSeededRandom(69 + i + j) * 0.1
                              }
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
                                visualWidth *
                                (0.35 + localSeededRandom(80 + i + j) * 0.4)
                              }
                              height={2}
                              fill={lightFill}
                              opacity={
                                0.2 + localSeededRandom(81 + i + j) * 0.1
                              }
                            />
                          ))}
                        </g>
                      );
                    } else {
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
                    }
                  }
                })}
              </g>
            )}

            {/* Gradient washes - occasional large atmospheric areas */}
            {localSeededRandom(200) > 0.4 && (
              <g opacity={settings.backgroundOpacity * 0.6}>
                {Array.from({ length: Math.ceil(bgHeight / 350) }, (_, i) => {
                  const washY =
                    visualY -
                    bgOffsetY +
                    i * 350 +
                    localSeededRandom(201 + i) * 100;
                  const washType = Math.floor(localSeededRandom(202 + i) * 4);
                  const washHeight = 80 + localSeededRandom(203 + i) * 120;
                  const washWidth =
                    visualWidth * (0.5 + localSeededRandom(204 + i) * 0.45);
                  const isLeft = localSeededRandom(205 + i) > 0.5;
                  const washX = isLeft
                    ? visualX
                    : visualX + visualWidth - washWidth;

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
                    <g
                      key={`wash-${i}`}
                      filter={`url(#ink-wash-${viewport.id})`}
                    >
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
                        x={
                          washX +
                          (isLeft ? washWidth * 0.15 : -washWidth * 0.15)
                        }
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
                })}
              </g>
            )}

            {/* Overlapping depth layers - scattered semi-transparent shapes */}
            {localSeededRandom(300) > 0.5 && (
              <g opacity={settings.backgroundOpacity * 0.4}>
                {Array.from({ length: Math.ceil(bgHeight / 280) }, (_, i) => {
                  const layerY = visualY - bgOffsetY + i * 280 + 60;

                  // Skip most to keep sparse
                  if (localSeededRandom(301 + i) < 0.5) return null;

                  const baseX =
                    visualX + localSeededRandom(302 + i) * visualWidth * 0.4;
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
                        fill={`rgb(${Math.round(layer3Lum * 255)}, ${Math.round(
                          layer3Lum * 255,
                        )}, ${Math.round(layer3Lum * 255)})`}
                        opacity={0.25}
                        rx={3}
                      />
                      {/* Middle layer */}
                      <rect
                        x={baseX + 5}
                        y={layerY + 4}
                        width={baseWidth - 5}
                        height={baseHeight - 5}
                        fill={`rgb(${Math.round(layer2Lum * 255)}, ${Math.round(
                          layer2Lum * 255,
                        )}, ${Math.round(layer2Lum * 255)})`}
                        opacity={0.35}
                        rx={2}
                      />
                      {/* Front layer - smallest, darkest */}
                      <rect
                        x={baseX + 15}
                        y={layerY + 12}
                        width={baseWidth - 25}
                        height={baseHeight - 20}
                        fill={`rgb(${Math.round(layer1Lum * 255)}, ${Math.round(
                          layer1Lum * 255,
                        )}, ${Math.round(layer1Lum * 255)})`}
                        opacity={0.45}
                        rx={2}
                      />
                    </g>
                  );
                })}
              </g>
            )}
          </g>

          {/* Edge tint overlays - inner glow effect */}
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
        </g>

        {/* Border with activity-based styling */}
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
              opacity={
                isActivelyScrolling ? 0.9 : 0.6 + localSeededRandom(6) * 0.2
              }
              rx={2}
            />
          </>
        )}
      </g>
    );
  },
);
