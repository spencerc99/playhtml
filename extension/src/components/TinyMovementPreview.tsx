import React, { useEffect, useMemo, useRef, useState } from "react";
import browser from "webextension-polyfill";
import type { CollectionEvent } from "../collectors/types";
import type { CollectionEvent as MovementCollectionEvent } from "../../../website/internet-series/movement/types";
// Reuse movement visualization components
import { AnimatedTrails } from "../../../website/internet-series/movement/components/AnimatedTrails";
import { useCursorTrails } from "../../../website/internet-series/movement/hooks/useCursorTrails";

export function TinyMovementPreview() {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Load up to 200 recent cursor events for the active tab's domain from background store
  useEffect(() => {
    (async () => {
      try {
        const [tab] = await browser.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (!tab?.url) return;
        const url = new URL(tab.url);
        const domain = url.hostname.replace(/^www\./, '');
        const res: any = await browser.runtime.sendMessage({
          type: "GET_RECENT_EVENTS",
          domain,
        });
        if (res?.success && Array.isArray(res.events)) {
          setEvents(res.events as CollectionEvent[]);
        }
      } catch {}
    })();
  }, []);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  // Settings optimized for a tiny, low-cost preview
  const settings = useMemo(
    () => ({
      // Match internet movement defaults where sensible for a preview
      trailOpacity: 0.7,
      randomizeColors: true,
      domainFilter: "",
      eventFilter: { move: true, click: true, hold: true, cursor_change: true },
      trailStyle: "chaotic" as const,
      chaosIntensity: 0.5,
      trailAnimationMode: "stagger" as const,
      maxConcurrentTrails: 3,
      overlapFactor: 0.5,
      minGapBetweenTrails: 0.1, // seconds
      documentSpace: false,
    }),
    [],
  );

  const { trailStates, timeBounds, cycleDuration } = useCursorTrails(
    events as unknown as MovementCollectionEvent[],
    { width: size.width, height: size.height },
    settings,
  );

  const timeRange = useMemo(
    () => ({
      min: timeBounds.min,
      max: timeBounds.max,
      duration: Math.max(1000, cycleDuration || 0),
    }),
    [timeBounds.min, timeBounds.max, cycleDuration],
  );

  return (
    <div ref={containerRef} style={{ position: "absolute", inset: 0 }}>
      {size.width > 0 && size.height > 0 && trailStates.length > 0 ? (
        <AnimatedTrails
          trailStates={trailStates}
          timeRange={timeRange}
          showClickRipples={false}
          settings={{
            strokeWidth: 1,
            pointSize: 0,
            trailOpacity: 0.7,
            animationSpeed: 1.0,
            clickMinRadius: 6,
            clickMaxRadius: 18,
            clickMinDuration: 300,
            clickMaxDuration: 800,
            clickExpansionDuration: 250,
            clickStrokeWidth: 1.5,
            clickOpacity: 0.4,
            clickNumRings: 2,
            clickRingDelayMs: 120,
            clickAnimationStopPoint: 0.9,
          }}
        />
      ) : null}
    </div>
  );
}
