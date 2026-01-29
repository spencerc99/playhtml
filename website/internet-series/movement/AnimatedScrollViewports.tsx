// ABOUTME: Animated scroll viewport visualization component
// ABOUTME: Shows scrolling behavior across different viewport sizes in a dynamic mosaic layout
import React, { useState, useEffect, useRef, memo, useMemo } from "react";
import { ScrollViewportState } from "./types";

interface AnimatedScrollViewportsProps {
  scrollViewportStates: ScrollViewportState[][];
  timeRange: { min: number; max: number; duration: number };
  settings: {
    scrollSpeed: number;
    backgroundOpacity: number;
  };
}

export const AnimatedScrollViewports: React.FC<AnimatedScrollViewportsProps> =
  memo(({ scrollViewportStates, timeRange, settings }) => {
    const [elapsedTimeMs, setElapsedTimeMs] = useState(0);
    const animationRef = useRef<number>();
    const lastLogTime = useRef<number>(0);

    // Refs for settings that shouldn't trigger re-render
    const settingsRef = useRef(settings);
    useEffect(() => {
      settingsRef.current = settings;
    }, [settings]);

    // Animation loop (same pattern as AnimatedTrails/AnimatedTyping)
    useEffect(() => {
      if (scrollViewportStates.length === 0 || timeRange.duration === 0) return;

      let startTime: number | null = null;

      const animate = (timestamp: number) => {
        if (startTime === null) startTime = timestamp;

        const realElapsed = timestamp - startTime;
        const scaledElapsed = realElapsed * settingsRef.current.scrollSpeed;
        const loopedElapsed = scaledElapsed % timeRange.duration;

        setElapsedTimeMs(loopedElapsed);

        // Log concurrent viewport count every 2 seconds
        if (realElapsed - lastLogTime.current > 2000) {
          lastLogTime.current = realElapsed;
          const currentLayout = scrollViewportStates[0] || [];
          const activeViewports = currentLayout.filter((state) => {
            const endOffsetMs = state.startOffsetMs + state.durationMs;
            const wrapsAround = endOffsetMs > timeRange.duration;
            if (wrapsAround) {
              return (
                loopedElapsed >= state.startOffsetMs ||
                loopedElapsed <= endOffsetMs - timeRange.duration
              );
            } else {
              return (
                loopedElapsed >= state.startOffsetMs &&
                loopedElapsed <= endOffsetMs
              );
            }
          });

          // Find active viewports and log their timing details with event counts
          const activeDetails = currentLayout
            .map((state, i) => ({
              index: i,
              startOffsetMs: state.startOffsetMs,
              durationMs: state.durationMs,
              endOffsetMs: state.startOffsetMs + state.durationMs,
              scrollEvents: state.animation.scrollEvents.length,
              resizeEvents: state.animation.resizeEvents?.length || 0,
              zoomEvents: state.animation.zoomEvents?.length || 0,
              isActive:
                loopedElapsed >= state.startOffsetMs &&
                loopedElapsed <= state.startOffsetMs + state.durationMs,
            }))
            .filter((d) => d.isActive);

          // Count how many have actual scroll events
          const activeWithScroll = activeDetails.filter(
            (d) => d.scrollEvents > 0,
          ).length;

          console.log(
            `[Scroll] Concurrent viewports: ${activeViewports.length}/${currentLayout.length} active ` +
              `(${activeWithScroll} with scroll) at ${loopedElapsed.toFixed(
                0,
              )}ms`,
            activeDetails.length > 0 && activeDetails.length <= 5
              ? activeDetails
              : `${activeDetails.length} active`,
          );
        }

        animationRef.current = requestAnimationFrame(animate);
      };

      animationRef.current = requestAnimationFrame(animate);

      return () => {
        if (animationRef.current) {
          cancelAnimationFrame(animationRef.current);
        }
      };
    }, [scrollViewportStates, timeRange.duration]);

    // Use the single layout (no rotation)
    const currentLayout = useMemo(() => {
      if (scrollViewportStates.length === 0) return [];
      const layout = scrollViewportStates[0]; // Always use first (and only) layout

      // Log schedule on first render with event type breakdown
      if (layout.length > 0) {
        const eventTypeCounts = {
          scroll: layout.filter((s) => s.animation.scrollEvents.length > 0)
            .length,
          resize: layout.filter(
            (s) => (s.animation.resizeEvents?.length || 0) > 0,
          ).length,
          zoom: layout.filter((s) => (s.animation.zoomEvents?.length || 0) > 0)
            .length,
          scrollOnly: layout.filter(
            (s) =>
              s.animation.scrollEvents.length > 0 &&
              (s.animation.resizeEvents?.length || 0) === 0 &&
              (s.animation.zoomEvents?.length || 0) === 0,
          ).length,
        };

        console.log(
          `[Scroll] Viewport schedule (${layout.length} total): ` +
            `scroll=${eventTypeCounts.scroll}, ` +
            `resize=${eventTypeCounts.resize}, ` +
            `zoom=${eventTypeCounts.zoom}, ` +
            `scrollOnly=${eventTypeCounts.scrollOnly}`,
        );

        console.log(
          `[Scroll] First 15 viewports:`,
          layout.slice(0, 15).map((state, i) => ({
            index: i,
            startOffsetMs: state.startOffsetMs.toFixed(0),
            durationMs: state.durationMs.toFixed(0),
            scrollEvents: state.animation.scrollEvents.length,
            resizeEvents: state.animation.resizeEvents?.length || 0,
            zoomEvents: state.animation.zoomEvents?.length || 0,
          })),
        );
      }

      return layout;
    }, [scrollViewportStates]);

    if (scrollViewportStates.length === 0 || currentLayout.length === 0) {
      return null;
    }

    return (
      <svg
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      >
        <defs>
          {/* Shared RISO texture pattern (reuse from movement.tsx) */}
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

        {/* Render each viewport in current layout */}
        {currentLayout.map((state, index) => (
          <ViewportRect
            key={`viewport-${index}`}
            viewportKey={`viewport-${index}`}
            viewportRect={state.viewportRect}
            state={state}
            elapsedTimeMs={elapsedTimeMs}
            timeRange={timeRange}
            settings={settingsRef.current}
          />
        ))}
      </svg>
    );
  });

// Helper function to calculate resize dimensions at given time
function calculateResizeDimensions(
  resizeEvents: Array<{
    width: number;
    height: number;
    timestamp: number;
  }>,
  currentTime: number,
  defaultWidth: number,
  defaultHeight: number,
): { width: number; height: number } {
  if (resizeEvents.length === 0) {
    return { width: defaultWidth, height: defaultHeight };
  }

  // Handle edge cases
  if (currentTime < resizeEvents[0].timestamp) {
    return {
      width: resizeEvents[0].width,
      height: resizeEvents[0].height,
    };
  }
  if (currentTime >= resizeEvents[resizeEvents.length - 1].timestamp) {
    const last = resizeEvents[resizeEvents.length - 1];
    return {
      width: last.width,
      height: last.height,
    };
  }

  // Find surrounding events for interpolation
  let prevEvent = resizeEvents[0];
  let nextEvent = resizeEvents[0];

  for (let i = 0; i < resizeEvents.length - 1; i++) {
    if (
      resizeEvents[i].timestamp <= currentTime &&
      resizeEvents[i + 1].timestamp > currentTime
    ) {
      prevEvent = resizeEvents[i];
      nextEvent = resizeEvents[i + 1];
      break;
    }
  }

  // Linear interpolation between events
  const timeDelta = nextEvent.timestamp - prevEvent.timestamp;
  if (timeDelta === 0) {
    return {
      width: prevEvent.width,
      height: prevEvent.height,
    };
  }

  const progress = (currentTime - prevEvent.timestamp) / timeDelta;
  return {
    width: prevEvent.width + (nextEvent.width - prevEvent.width) * progress,
    height: prevEvent.height + (nextEvent.height - prevEvent.height) * progress,
  };
}

// Helper function to calculate zoom level at given time
function calculateZoomLevel(
  zoomEvents: Array<{
    zoom: number;
    timestamp: number;
  }>,
  currentTime: number,
): number {
  if (zoomEvents.length === 0) {
    return 1.0;
  }

  // Handle edge cases
  if (currentTime < zoomEvents[0].timestamp) {
    return zoomEvents[0].zoom;
  }
  if (currentTime >= zoomEvents[zoomEvents.length - 1].timestamp) {
    return zoomEvents[zoomEvents.length - 1].zoom;
  }

  // Find surrounding events for interpolation
  let prevEvent = zoomEvents[0];
  let nextEvent = zoomEvents[0];

  for (let i = 0; i < zoomEvents.length - 1; i++) {
    if (
      zoomEvents[i].timestamp <= currentTime &&
      zoomEvents[i + 1].timestamp > currentTime
    ) {
      prevEvent = zoomEvents[i];
      nextEvent = zoomEvents[i + 1];
      break;
    }
  }

  // Linear interpolation between events
  const timeDelta = nextEvent.timestamp - prevEvent.timestamp;
  if (timeDelta === 0) {
    return prevEvent.zoom;
  }

  const progress = (currentTime - prevEvent.timestamp) / timeDelta;
  return prevEvent.zoom + (nextEvent.zoom - prevEvent.zoom) * progress;
}

// Helper function to calculate scroll position and viewport dimensions at given time
function calculateScrollPosition(
  scrollEvents: Array<{
    scrollY: number;
    timestamp: number;
    viewportWidth: number;
    viewportHeight: number;
  }>,
  currentTime: number,
): { scrollY: number; viewportWidth: number; viewportHeight: number } {
  if (scrollEvents.length === 0)
    return { scrollY: 0, viewportWidth: 1920, viewportHeight: 1080 };

  // Handle edge cases
  if (currentTime < scrollEvents[0].timestamp) {
    return {
      scrollY: scrollEvents[0].scrollY,
      viewportWidth: scrollEvents[0].viewportWidth,
      viewportHeight: scrollEvents[0].viewportHeight,
    };
  }
  if (currentTime >= scrollEvents[scrollEvents.length - 1].timestamp) {
    const last = scrollEvents[scrollEvents.length - 1];
    return {
      scrollY: last.scrollY,
      viewportWidth: last.viewportWidth,
      viewportHeight: last.viewportHeight,
    };
  }

  // Find surrounding events for interpolation
  let prevEvent = scrollEvents[0];
  let nextEvent = scrollEvents[0];

  for (let i = 0; i < scrollEvents.length - 1; i++) {
    if (
      scrollEvents[i].timestamp <= currentTime &&
      scrollEvents[i + 1].timestamp > currentTime
    ) {
      prevEvent = scrollEvents[i];
      nextEvent = scrollEvents[i + 1];
      break;
    }
  }

  // Linear interpolation between events
  const timeDelta = nextEvent.timestamp - prevEvent.timestamp;
  if (timeDelta === 0) {
    return {
      scrollY: prevEvent.scrollY,
      viewportWidth: prevEvent.viewportWidth,
      viewportHeight: prevEvent.viewportHeight,
    };
  }

  const progress = (currentTime - prevEvent.timestamp) / timeDelta;
  return {
    scrollY:
      prevEvent.scrollY + (nextEvent.scrollY - prevEvent.scrollY) * progress,
    viewportWidth:
      prevEvent.viewportWidth +
      (nextEvent.viewportWidth - prevEvent.viewportWidth) * progress,
    viewportHeight:
      prevEvent.viewportHeight +
      (nextEvent.viewportHeight - prevEvent.viewportHeight) * progress,
  };
}

// ViewportRect Sub-Component
const ViewportRect = memo(
  ({
    viewportKey,
    viewportRect,
    state,
    elapsedTimeMs,
    timeRange,
    settings,
  }: {
    viewportKey: string;
    viewportRect: { x: number; y: number; width: number; height: number };
    state: ScrollViewportState;
    elapsedTimeMs: number;
    timeRange: { min: number; max: number; duration: number };
    settings: {
      scrollSpeed: number;
      backgroundOpacity: number;
    };
  }) => {
    // Check if this viewport's animation is active
    // Handle wrapping: if animation spans across timeRange.duration boundary
    const endOffsetMs = state.startOffsetMs + state.durationMs;
    const wrapsAround = endOffsetMs > timeRange.duration;

    let isActive = false;
    if (wrapsAround) {
      // Animation wraps: active if elapsedTimeMs >= startOffsetMs OR elapsedTimeMs <= (endOffsetMs - timeRange.duration)
      isActive =
        elapsedTimeMs >= state.startOffsetMs ||
        elapsedTimeMs <= endOffsetMs - timeRange.duration;
    } else {
      // Normal case: active if within start and end
      isActive =
        elapsedTimeMs >= state.startOffsetMs && elapsedTimeMs <= endOffsetMs;
    }

    // Base dimensions come from the packed viewport (from packing algorithm)
    // Resize/zoom animate relative to this base size
    const baseWidth = viewportRect.width;
    const baseHeight = viewportRect.height;

    // Calculate current scroll position and viewport dimensions
    let scrollY = 0;
    let viewportWidth = baseWidth;
    let viewportHeight = baseHeight;
    let zoomLevel = 1.0;
    let color = state.animation.color;
    let hasResize = false;
    let hasZoom = false;

    if (isActive) {
      // Calculate elapsed time within the animation, handling wrapping
      let animElapsed = elapsedTimeMs - state.startOffsetMs;
      if (animElapsed < 0) {
        // We're in the wrapped portion of the animation
        animElapsed = timeRange.duration - state.startOffsetMs + elapsedTimeMs;
      }
      // Clamp to animation duration
      animElapsed = Math.min(animElapsed, state.durationMs);

      // Sequence events chronologically with compressed gaps
      // Collect all events with their timestamps
      const allEvents: Array<{
        type: "scroll" | "resize" | "zoom";
        timestamp: number;
        data?: any;
      }> = [];

      if (state.animation.scrollEvents.length > 0) {
        state.animation.scrollEvents.forEach((e) => {
          allEvents.push({ type: "scroll", timestamp: e.timestamp, data: e });
        });
      }
      if (
        state.animation.resizeEvents &&
        state.animation.resizeEvents.length > 0
      ) {
        state.animation.resizeEvents.forEach((e) => {
          allEvents.push({ type: "resize", timestamp: e.timestamp, data: e });
        });
      }
      if (state.animation.zoomEvents && state.animation.zoomEvents.length > 0) {
        state.animation.zoomEvents.forEach((e) => {
          allEvents.push({ type: "zoom", timestamp: e.timestamp, data: e });
        });
      }

      if (allEvents.length > 0) {
        // Sort by timestamp to get chronological order
        allEvents.sort((a, b) => a.timestamp - b.timestamp);

        // Find earliest and latest timestamps
        const earliestTime = allEvents[0].timestamp;
        const latestTime = allEvents[allEvents.length - 1].timestamp;
        const originalDuration = latestTime - earliestTime;

        // Compress timeline: remove gaps but maintain relative timing within each event type
        // Strategy: map the animation progress to a compressed timeline
        // We'll compress gaps between different event types, but keep relative timing within each type
        const compressionFactor = 0.1; // Compress gaps by 90% (10x faster)
        const minGapBetweenTypes = 50; // Minimum 50ms gap between different event types

        // Build compressed timeline: group events by type and compress gaps between types
        let compressedTime = earliestTime;
        let lastType: "scroll" | "resize" | "zoom" | null = null;
        const compressedTimeline: Array<{
          originalTime: number;
          compressedTime: number;
          type: "scroll" | "resize" | "zoom";
          data: any;
        }> = [];

        allEvents.forEach((event) => {
          if (lastType !== null && lastType !== event.type) {
            // Different event type - add compressed gap
            const gap =
              event.timestamp -
              compressedTimeline[compressedTimeline.length - 1].originalTime;
            compressedTime += Math.max(
              minGapBetweenTypes,
              gap * compressionFactor,
            );
          } else if (lastType === event.type) {
            // Same event type - maintain relative timing (less compression)
            const gap =
              event.timestamp -
              compressedTimeline[compressedTimeline.length - 1].originalTime;
            compressedTime += gap * 0.5; // Less compression within same type
          }

          compressedTimeline.push({
            originalTime: event.timestamp,
            compressedTime: compressedTime,
            type: event.type,
            data: event.data,
          });

          lastType = event.type;
        });

        const compressedDuration = compressedTime - earliestTime;
        const compressedLatestTime =
          compressedTimeline[compressedTimeline.length - 1].compressedTime;

        // Map animation elapsed time to compressed timeline
        const progress = Math.min(animElapsed / state.durationMs, 1);
        const targetCompressedTime =
          earliestTime + progress * compressedDuration;

        // Find current time in original timeline by interpolating compressed timeline
        let currentOriginalTime = earliestTime;

        if (targetCompressedTime <= earliestTime) {
          currentOriginalTime = earliestTime;
        } else if (targetCompressedTime >= compressedLatestTime) {
          currentOriginalTime = latestTime;
        } else {
          // Interpolate between compressed timeline points
          for (let i = 0; i < compressedTimeline.length - 1; i++) {
            const curr = compressedTimeline[i];
            const next = compressedTimeline[i + 1];

            if (
              targetCompressedTime >= curr.compressedTime &&
              targetCompressedTime <= next.compressedTime
            ) {
              const localProgress =
                (targetCompressedTime - curr.compressedTime) /
                (next.compressedTime - curr.compressedTime);
              currentOriginalTime =
                curr.originalTime +
                (next.originalTime - curr.originalTime) * localProgress;
              break;
            }
          }
        }

        // Calculate scroll position using compressed timeline
        if (state.animation.scrollEvents.length > 0) {
          const scrollStartTime = Math.min(
            ...state.animation.scrollEvents.map((e) => e.timestamp),
          );
          const scrollEndTime = Math.max(
            ...state.animation.scrollEvents.map((e) => e.timestamp),
          );

          if (
            currentOriginalTime >= scrollStartTime &&
            currentOriginalTime <= scrollEndTime
          ) {
            const scrollData = calculateScrollPosition(
              state.animation.scrollEvents,
              currentOriginalTime,
            );
            scrollY = scrollData.scrollY;
          } else if (currentOriginalTime > scrollEndTime) {
            const lastScroll =
              state.animation.scrollEvents[
                state.animation.scrollEvents.length - 1
              ];
            scrollY = lastScroll.scrollY;
          } else {
            scrollY = state.animation.scrollEvents[0].scrollY;
          }
        } else {
          scrollY = 0;
        }

        // Calculate resize dimensions using compressed timeline
        if (
          state.animation.resizeEvents &&
          state.animation.resizeEvents.length > 0
        ) {
          const resizeStartTime = Math.min(
            ...state.animation.resizeEvents.map((e) => e.timestamp),
          );
          const resizeEndTime = Math.max(
            ...state.animation.resizeEvents.map((e) => e.timestamp),
          );

          if (
            currentOriginalTime >= resizeStartTime &&
            currentOriginalTime <= resizeEndTime
          ) {
            hasResize = true;
            const resizeData = calculateResizeDimensions(
              state.animation.resizeEvents,
              currentOriginalTime,
              state.animation.startViewportWidth,
              state.animation.startViewportHeight,
            );

            const widthScale =
              baseWidth / Math.max(1, state.animation.startViewportWidth);
            const heightScale =
              baseHeight / Math.max(1, state.animation.startViewportHeight);

            viewportWidth = resizeData.width * widthScale;
            viewportHeight = resizeData.height * heightScale;
          } else if (currentOriginalTime > resizeEndTime) {
            hasResize = true;
            const lastResize =
              state.animation.resizeEvents[
                state.animation.resizeEvents.length - 1
              ];
            const widthScale =
              baseWidth / Math.max(1, state.animation.startViewportWidth);
            const heightScale =
              baseHeight / Math.max(1, state.animation.startViewportHeight);
            viewportWidth = lastResize.width * widthScale;
            viewportHeight = lastResize.height * heightScale;
          }
        }

        // Calculate zoom level using compressed timeline
        if (
          state.animation.zoomEvents &&
          state.animation.zoomEvents.length > 0
        ) {
          const zoomStartTime = Math.min(
            ...state.animation.zoomEvents.map((e) => e.timestamp),
          );
          const zoomEndTime = Math.max(
            ...state.animation.zoomEvents.map((e) => e.timestamp),
          );

          if (
            currentOriginalTime >= zoomStartTime &&
            currentOriginalTime <= zoomEndTime
          ) {
            hasZoom = true;
            zoomLevel = calculateZoomLevel(
              state.animation.zoomEvents.map((e) => ({
                zoom: e.zoom,
                timestamp: e.timestamp,
              })),
              currentOriginalTime,
            );
          } else if (currentOriginalTime > zoomEndTime) {
            hasZoom = true;
            const lastZoom =
              state.animation.zoomEvents[state.animation.zoomEvents.length - 1];
            zoomLevel = lastZoom.zoom;
          }
        }
      }
    }

    // Calculate visual dimensions - use packed viewport as base, animate resize/zoom relative to it
    const visualWidth = viewportWidth;
    const visualHeight = viewportHeight;
    const visualX = viewportRect.x + (baseWidth - visualWidth) / 2;
    const visualY = viewportRect.y + (baseHeight - visualHeight) / 2;

    // Background height assumes page is 3x viewport height (adjust based on actual scroll range)
    // scrollY is normalized 0-1, so we need to scale it to the scrollable area
    const bgHeight = visualHeight * 3;
    const scrollableHeight = bgHeight - visualHeight;
    const bgOffsetY = scrollY * scrollableHeight;

    // Apply zoom transform - zoom happens within the viewport, centered
    // Transform: translate viewport center to origin, scale, translate back
    const viewportCenterX = visualX + visualWidth / 2;
    const viewportCenterY = visualY + visualHeight / 2;
    const zoomTransform =
      hasZoom && zoomLevel !== 1.0
        ? `translate(${viewportCenterX}, ${viewportCenterY}) scale(${zoomLevel}) translate(${-viewportCenterX}, ${-viewportCenterY})`
        : undefined;

    // Generate visual variety using backgroundSeed (similar to typing inputs)
    // Create seeded random function for consistent variation per viewport
    const seededRandom = (offset: number = 0) => {
      const x = Math.sin(state.backgroundSeed + offset * 12.9898) * 43758.5453;
      return x - Math.floor(x);
    };

    // Generate luminosity variation (0.85 to 1.0 - keep it light like typing inputs)
    const baseLuminosity = 0.85 + seededRandom(1) * 0.15; // 0.85 to 1.0
    const luminosity = Math.max(0.85, baseLuminosity); // Ensure minimum visibility
    const colorValue = Math.round(luminosity * 255);
    const backgroundColor = `rgb(${colorValue}, ${colorValue}, ${colorValue})`;

    // Slight opacity variation for more visual interest
    const opacityVariation = 0.92 + seededRandom(2) * 0.08; // 0.92 to 1.0

    return (
      <g>
        {/* Clip path to constrain scrolling background - use visual dimensions */}
        <defs>
          <clipPath id={`viewport-clip-${viewportKey}`}>
            <rect
              x={visualX}
              y={visualY}
              width={visualWidth}
              height={visualHeight}
            />
          </clipPath>
        </defs>

        {/* Scrolling background - page content simulation */}
        {/* Apply zoom transform to the content group - zooms content within viewport */}
        <g clipPath={`url(#viewport-clip-${viewportKey})`}>
          <g transform={zoomTransform || undefined}>
            {/* Base paper texture with luminosity variation */}
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

            {/* Horizontal bands to make scrolling visible - with subtle variation */}
            <g
              opacity={
                settings.backgroundOpacity * (0.25 + seededRandom(7) * 0.1)
              }
            >
              {Array.from({ length: Math.ceil(bgHeight / 100) }, (_, i) => {
                const bandLuminosity = 0.4 + seededRandom(8 + i) * 0.2; // 0.4-0.6 variation
                const bandColorValue = Math.round(bandLuminosity * 255);
                return (
                  <rect
                    key={`band-${i}`}
                    x={visualX}
                    y={visualY - bgOffsetY + i * 100}
                    width={visualWidth}
                    height={2}
                    fill={`rgb(${bandColorValue}, ${bandColorValue}, ${bandColorValue})`}
                    opacity={0.25 + seededRandom(9 + i) * 0.15} // 0.25-0.4 variation
                  />
                );
              })}
            </g>
          </g>
        </g>

        {/* Viewport border - use visual dimensions, animate if resizing */}
        {/* Add subtle border color variation based on backgroundSeed */}
        {(() => {
          const borderLuminosity = 0.5 + seededRandom(3) * 0.3; // 0.5 to 0.8 (medium gray range)
          const borderColorValue = Math.round(borderLuminosity * 255);
          const borderColor = `rgb(${borderColorValue}, ${borderColorValue}, ${borderColorValue})`;

          return (
            <rect
              x={visualX}
              y={visualY}
              width={visualWidth}
              height={visualHeight}
              fill="none"
              stroke={borderColor}
              strokeWidth={hasResize ? 4 : 3}
              // strokeDasharray={isActive && hasResize ? "8 4" : "none"}
              strokeDasharray={"none"}
              opacity={isActive ? 0.7 + seededRandom(4) * 0.2 : 0.3} // 0.7-0.9 when active
            />
          );
        })()}

        {/* Activity indicators */}
        {isActive && (
          <>
            {/* Scroll indicator */}
            {state.animation.scrollEvents.length > 0 && (
              <>
                {/* <text
                  x={visualX + 12}
                  y={visualY + 44}
                  fontSize={12}
                  fill={color}
                  fontFamily="monospace"
                  opacity={0.6}
                >
                  ↓ {Math.round(scrollY * 100)}%
                </text> */}

                {/* Scroll bar indicator with subtle variation */}
                <rect
                  x={visualX + visualWidth - 8}
                  y={visualY + 4}
                  width={4}
                  height={visualHeight - 8}
                  fill="#ccc"
                  opacity={0.15 + seededRandom(5) * 0.1} // 0.15-0.25 variation
                  rx={2}
                />
                <rect
                  x={visualX + visualWidth - 8}
                  y={visualY + 4 + scrollY * (visualHeight - 40)}
                  width={4}
                  height={32}
                  fill={color}
                  opacity={0.5 + seededRandom(6) * 0.2} // 0.5-0.7 variation
                  rx={2}
                />
              </>
            )}
            {/*   {hasResize && (
          //     <text
          //       x={visualX + 12}
          //       y={
          //         visualY + (state.animation.scrollEvents.length > 0 ? 60 : 44)
          //       }
          //       fontSize={12}
          //       fill={color}
          //       fontFamily="monospace"
          //       opacity={0.6}
          //     >
          //       ↕ {Math.round(viewportWidth)}×{Math.round(viewportHeight)}
          //     </text>
          //   )} */}

            {/*hasZoom && (
              <text
                x={visualX + 12}
                y={
                  visualY +
                  (state.animation.scrollEvents.length > 0 || hasResize
                    ? 76
                    : 44)
                }
                fontSize={12}
                fill={color}
                fontFamily="monospace"
                opacity={0.6}
              >
                🔍 {zoomLevel.toFixed(2)}x
              </text>
            )*/}

            {/*}   {hasZoom && (
          //     <circle
          //       cx={visualX + visualWidth / 2}
          //       cy={visualY + visualHeight / 2}
          //       r={Math.min(visualWidth, visualHeight) * 0.35}
          //       fill="none"
          //       stroke={color}
          //       strokeWidth={zoomLevel !== 1.0 ? 2 : 1}
          //       strokeDasharray={zoomLevel !== 1.0 ? "4 4" : "2 2"}
          //       opacity={zoomLevel !== 1.0 ? 0.6 : 0.3}
          //     /> */}
          </>
        )}
      </g>
    );
  },
  (prev, next) => {
    return prev.elapsedTimeMs === next.elapsedTimeMs;
  },
);
