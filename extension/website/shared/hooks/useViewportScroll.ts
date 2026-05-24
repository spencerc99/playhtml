// ABOUTME: Hook for processing viewport events into scroll animations
// ABOUTME: Extracts viewport/scroll-specific logic from movement.tsx for cleaner separation of concerns

import { useMemo } from "react";
import { CollectionEvent, ScrollAnimation } from "../types";
import {
  getColorForParticipant,
  eventMatchesAnyFilter,
  SCROLL_SESSION_THRESHOLD,
  SCROLL_TIME_COMPRESSION,
  MAX_VIEWPORT_ANIMATION_DURATION,
  type FilterChip,
} from "../utils/eventUtils";

// Settings interface for viewport scroll
export interface ViewportScrollSettings {
  filters: readonly FilterChip[];
  pidFilter: string;
  viewportEventFilter: {
    scroll: boolean;
    resize: boolean;
    zoom: boolean;
  };
}

export interface UseViewportScrollResult {
  animations: ScrollAnimation[];
  timeBounds: { min: number; max: number };
  urlMetadata: Map<string, { title?: string; favicon?: string }>;
}

// Visibility thresholds for filtering animations
const MIN_SCROLL_CHANGE = 0.05; // 5% minimum scroll change
const MIN_RESIZE_CHANGE = 100; // 100px minimum resize (width or height)
const MIN_ZOOM_CHANGE = 0.1; // 10% minimum zoom change

/**
 * Hook for processing viewport events into scroll animations
 *
 * @param events - All collection events (will be filtered to viewport type)
 * @param viewportSize - Current viewport dimensions
 * @param settings - Viewport scroll settings
 * @returns Scroll animations ready for rendering, plus time bounds for coordination
 */
export function useViewportScroll(
  events: CollectionEvent[],
  viewportSize: { width: number; height: number },
  settings: ViewportScrollSettings,
): UseViewportScrollResult {
  // Filter to viewport events only
  const viewportEvents = useMemo(() => {
    return events.filter((e) => e.type === "viewport");
  }, [events]);

  // Build a per-URL metadata index from any navigation events that happen to
  // be in `events` (when navigation/favicon viz is also active). When only the
  // scroll viz is active, navigation events aren't fetched and title bars
  // fall back to the domain — by design, to keep the scroll fetch focused.
  const urlMetadata = useMemo(() => {
    const byUrl = new Map<string, { title?: string; favicon?: string; ts: number }>();
    for (const e of events) {
      if (e.type !== "navigation") continue;
      const url = e.meta?.url;
      if (!url) continue;
      const data = e.data as Record<string, unknown> | undefined;
      const title = typeof data?.title === "string" ? (data!.title as string) : undefined;
      const favicon =
        typeof data?.favicon_url === "string" ? (data!.favicon_url as string) : undefined;
      if (!title && !favicon) continue;
      const prev = byUrl.get(url);
      if (!prev || e.ts >= prev.ts) {
        byUrl.set(url, {
          title: title || prev?.title,
          favicon: favicon || prev?.favicon,
          ts: e.ts,
        });
      }
    }
    return byUrl;
  }, [events]);

  // Process viewport events into scroll animations
  const result = useMemo(() => {
    if (viewportEvents.length === 0 || viewportSize.width === 0) {
      return { animations: [], timeBounds: { min: 0, max: 0 } };
    }

    // Analyze event types BEFORE filtering
    const eventTypeCounts = new Map<string, number>();
    viewportEvents.forEach((event) => {
      const eventType = (event.data as any)?.event || "unknown";
      eventTypeCounts.set(eventType, (eventTypeCounts.get(eventType) || 0) + 1);
    });

    // Apply URL-scope chips + pid filter.
    const hasFilters = (settings.filters?.length ?? 0) > 0;
    const filteredEvents =
      hasFilters || settings.pidFilter
        ? viewportEvents.filter((event) => {
            if (settings.pidFilter && event.meta?.pid !== settings.pidFilter)
              return false;
            return eventMatchesAnyFilter(event.meta.url || "", settings.filters);
          })
        : viewportEvents;

    if (filteredEvents.length === 0) {
      return { animations: [], timeBounds: { min: 0, max: 0 } };
    }

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

    scrollsBySession.forEach((sessionEvents) => {
      sessionEvents.sort((a, b) => a.ts - b.ts);

      // Merge events within SCROLL_SESSION_THRESHOLD
      const mergedSessions: CollectionEvent[][] = [];
      let currentSession: CollectionEvent[] = [];

      sessionEvents.forEach((event) => {
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
      const allResizeEvents: CollectionEvent[] = [];
      const allZoomEvents: CollectionEvent[] = [];

      mergedSessions.forEach((sessionEvts) => {
        sessionEvts.forEach((event) => {
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
      mergedSessions.forEach((mergedSessionEvents) => {
        // Separate events by type
        const scrollEvents = mergedSessionEvents
          .filter((e) => (e.data as any)?.event === "scroll")
          .map((e) => ({
            scrollX: (e.data as any).scrollX || 0,
            scrollY: (e.data as any).scrollY || 0,
            timestamp: e.ts,
            viewportWidth: e.meta.vw,
            viewportHeight: e.meta.vh,
          }));

        // Use resize/zoom events from the entire session
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

        // Determine base start time from any event type
        const baseStartTime =
          scrollEvents.length > 0
            ? scrollEvents[0].timestamp
            : resizeEvents.length > 0
            ? resizeEvents[0].timestamp
            : zoomEvents.length > 0
            ? zoomEvents[0].timestamp
            : mergedSessionEvents[0].ts;

        // Compress timing for resize events
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

        // Compress timing for zoom events
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

        // Check for actual scrolling
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
        const hasAnyActivity =
          (hasScrolling && compressedScrollEvents.length > 1) ||
          hasResize ||
          hasZoom;

        if (hasAnyActivity) {
          // Calculate start/end times from all event types
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

          // Cap animation duration
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

            if (scrollAnimations.length < 3) {
              console.log(
                `[Scroll] Animation ${scrollAnimations.length} truncated: ` +
                  `${(originalDuration / 1000).toFixed(1)}s → ${(
                    MAX_VIEWPORT_ANIMATION_DURATION / 1000
                  ).toFixed(1)}s`,
              );
            }
          }

          // Determine viewport dimensions
          let startViewportWidth = mergedSessionEvents[0].meta.vw;
          let startViewportHeight = mergedSessionEvents[0].meta.vh;
          let endViewportWidth =
            mergedSessionEvents[mergedSessionEvents.length - 1].meta.vw;
          let endViewportHeight =
            mergedSessionEvents[mergedSessionEvents.length - 1].meta.vh;

          if (cappedResizeEvents.length > 0) {
            startViewportWidth = cappedResizeEvents[0].width;
            startViewportHeight = cappedResizeEvents[0].height;
            endViewportWidth =
              cappedResizeEvents[cappedResizeEvents.length - 1].width;
            endViewportHeight =
              cappedResizeEvents[cappedResizeEvents.length - 1].height;
          } else if (cappedScrollEvents.length > 0) {
            startViewportWidth = cappedScrollEvents[0].viewportWidth;
            startViewportHeight = cappedScrollEvents[0].viewportHeight;
            endViewportWidth =
              cappedScrollEvents[cappedScrollEvents.length - 1].viewportWidth;
            endViewportHeight =
              cappedScrollEvents[cappedScrollEvents.length - 1].viewportHeight;
          }

          const animUrl = mergedSessionEvents[0].meta.url;
          const metadata = urlMetadata.get(animUrl);
          const anim = {
            participantId: mergedSessionEvents[0].meta.pid,
            sessionId: mergedSessionEvents[0].meta.sid,
            pageUrl: animUrl,
            pageTitle: metadata?.title,
            faviconUrl: metadata?.favicon,
            color: getColorForParticipant(mergedSessionEvents[0].meta.pid),
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

          scrollAnimations.push(anim);
        }
      });
    });

    if (scrollAnimations.length === 0) {
      return { animations: [], timeBounds: { min: 0, max: 0 } };
    }

    // Filter to only animations with VISIBLE activity
    const visibleScrollAnimations = scrollAnimations.filter((anim) => {
      let hasVisibleActivity = false;

      // Check for visible scrolling
      if (
        settings.viewportEventFilter.scroll &&
        anim.scrollEvents.length >= 2
      ) {
        const scrollYValues = anim.scrollEvents.map((e) => e.scrollY);
        const minScrollY = Math.min(...scrollYValues);
        const maxScrollY = Math.max(...scrollYValues);
        const scrollRange = maxScrollY - minScrollY;
        if (scrollRange >= MIN_SCROLL_CHANGE) {
          hasVisibleActivity = true;
        }
      }

      // Check for visible resize
      if (
        settings.viewportEventFilter.resize &&
        anim.resizeEvents &&
        anim.resizeEvents.length >= 2
      ) {
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

      // Check for visible zoom
      if (
        settings.viewportEventFilter.zoom &&
        anim.zoomEvents &&
        anim.zoomEvents.length >= 2
      ) {
        const zooms = anim.zoomEvents.map((e) => e.zoom);
        const zoomChange = Math.max(...zooms) - Math.min(...zooms);
        if (zoomChange >= MIN_ZOOM_CHANGE) {
          hasVisibleActivity = true;
        }
      }

      return hasVisibleActivity;
    });

    // Fall back to all animations if none have visible activity
    const animationsToUse =
      visibleScrollAnimations.length > 0
        ? visibleScrollAnimations
        : scrollAnimations;

    // Calculate time bounds from all animations
    const allTimes = animationsToUse.flatMap((a) => [a.startTime, a.endTime]);
    const timeBounds =
      allTimes.length > 0
        ? { min: Math.min(...allTimes), max: Math.max(...allTimes) }
        : { min: 0, max: 0 };

    return { animations: animationsToUse, timeBounds };
  }, [
    viewportEvents,
    urlMetadata,
    viewportSize.width,
    settings.filters,
    settings.pidFilter,
    settings.viewportEventFilter,
  ]);

  // urlMetadata is already memoized above; expose as-is. Consumers only read
  // `title` and `favicon`, so passing the extra `ts` field is harmless.
  return { ...result, urlMetadata } as UseViewportScrollResult;
}
