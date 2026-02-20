// ABOUTME: Homepage for wewere.online
// ABOUTME: Shows animated cursor trails from real server events behind centered wordmark

import React, { useState, useEffect } from "react";
import { AnimatedTrails } from "@movement/components/AnimatedTrails";
import { useCursorTrails } from "@movement/hooks/useCursorTrails";
import type { CollectionEvent } from "@movement/types";
import styles from "./App.module.scss";

function RisoTexture() {
  return (
    <svg
      width="100%"
      height="100%"
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
      </defs>
      <rect width="100%" height="100%" filter="url(#noise)" />
      <rect
        width="100%"
        height="100%"
        filter="url(#grain)"
        style={{ opacity: 0.3 }}
      />
    </svg>
  );
}

const WORKER_URL = "https://playhtml-game-api.spencerc99.workers.dev";
const EVENT_LIMIT = 500;

const TRAIL_SETTINGS = {
  trailOpacity: 0.5,
  randomizeColors: true,
  domainFilter: "",
  eventFilter: { move: true, click: true, hold: false, cursor_change: false },
  trailStyle: "chaotic" as const,
  chaosIntensity: 0.6,
  trailAnimationMode: "stagger" as const,
  maxConcurrentTrails: 10,
  overlapFactor: 1,
  minGapBetweenTrails: 0.1,
};

const ANIMATION_SETTINGS = {
  strokeWidth: 5,
  pointSize: 4,
  trailOpacity: 0.5,
  animationSpeed: 0.5,
  clickMinRadius: 10,
  clickMaxRadius: 30,
  clickMinDuration: 600,
  clickMaxDuration: 1200,
  clickExpansionDuration: 400,
  clickStrokeWidth: 1,
  clickOpacity: 0.4,
  clickNumRings: 2,
  clickRingDelayMs: 80,
  clickAnimationStopPoint: 0.8,
};

export default function App() {
  const [events, setEvents] = useState<CollectionEvent[]>([]);
  const [viewportSize, setViewportSize] = useState({
    width: window.innerWidth,
    height: window.innerHeight,
  });

  useEffect(() => {
    fetch(`${WORKER_URL}/events/recent?type=cursor&limit=${EVENT_LIMIT}`)
      .then((r) => r.json())
      .then((data: CollectionEvent[]) => setEvents(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onResize = () =>
      setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const { trailStates, timeBounds, cycleDuration } = useCursorTrails(
    events,
    viewportSize,
    TRAIL_SETTINGS,
  );

  const timeRange = {
    min: timeBounds.min,
    max: timeBounds.max,
    duration: cycleDuration,
  };

  return (
    <div className={styles.page}>
      <div className={styles.trails}>
        {trailStates.length > 0 && (
          <AnimatedTrails
            trailStates={trailStates}
            timeRange={timeRange}
            showClickRipples={false}
            settings={ANIMATION_SETTINGS}
          />
        )}
        <RisoTexture />
      </div>

      <div className={styles.content}>
        <h1 className={styles.wordmark}>we were online</h1>
        <p className={styles.tagline}>coming soon</p>
        <a
          href="https://forms.gle/iX8Lfgcy3LW79EsRA"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.cta}
        >
          sign up for beta access
        </a>
      </div>
    </div>
  );
}
