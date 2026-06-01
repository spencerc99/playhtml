// ABOUTME: Live cursor-trail animator. Renders the current trail set directly
// ABOUTME: (id-keyed, React owns add/remove/grow); the rAF loop draws each trail
// ABOUTME: by its own progress since first seen. No snapshot/eviction state.

import React, { useEffect, useRef, useState, memo } from "react";
import { TrailState } from "../types";
import { getTrailRenderer } from "../styles/trailRenderers";
import {
  TrailPath,
  TrailCursor,
  COMPLETED_OPACITY,
  type ImperativeTrailHandle,
  type ImperativeTrailCursorHandle,
} from "./trailPrimitives";

const HIDDEN_TAB_TICK_MS = 100;

// A trail draws over its own real duration (endTime - startTime), clamped so a
// flick is still perceptible and a long idle span doesn't take minutes.
const MIN_DRAW_MS = 800;
const MAX_DRAW_MS = 8000;

// When a trail leaves the live event window (its events aged off the cap, or a
// transient re-derivation gap), keep drawing it locally and fade it out over
// this long instead of popping it. This decouples a trail's on-screen lifetime
// from the raw event window — the websocket stream churns events faster than
// trails should visibly come and go.
const KEEP_AFTER_DEPART_MS = 1500;

/** Tiny deterministic hash of a string to a small int, for per-trail variation. */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** Per-trail draw duration: its real span, clamped to a perceptible range. */
function drawDurationFor(durationMs: number, speed: number): number {
  return Math.min(MAX_DRAW_MS, Math.max(MIN_DRAW_MS, durationMs / (speed || 1)));
}

/** A trail LiveTrails is keeping on screen. `departedAt` is null while the trail
 * is still in the live window; once it leaves, it's the wall-clock time the fade
 * started. */
interface KeptTrail {
  trail: TrailState;
  departedAt: number | null;
}

interface LiveTrailsProps {
  trailStates: TrailState[];
  frozen?: boolean;
  settings: {
    strokeWidth: number;
    trailOpacity: number;
    animationSpeed: number;
    trailVisualStyle?: string;
  };
}

export const LiveTrails: React.FC<LiveTrailsProps> = memo(
  ({ trailStates, frozen = false, settings }) => {
    const svgRef = useRef<SVGSVGElement>(null);
    const pathLayerRef = useRef<SVGGElement>(null);
    const animationRef = useRef<number | undefined>(undefined);
    const timeoutRef = useRef<number | undefined>(undefined);

    const renderer = getTrailRenderer(settings.trailVisualStyle ?? "color");

    // Settings via refs so the loop reads latest without restarting.
    const strokeWidthRef = useRef(settings.strokeWidth);
    const trailOpacityRef = useRef(settings.trailOpacity);
    const animationSpeedRef = useRef(settings.animationSpeed);
    useEffect(() => {
      strokeWidthRef.current = settings.strokeWidth;
      trailOpacityRef.current = settings.trailOpacity;
      animationSpeedRef.current = settings.animationSpeed;
    }, [settings.strokeWidth, settings.trailOpacity, settings.animationSpeed]);

    const frozenRef = useRef(frozen);
    useEffect(() => {
      frozenRef.current = frozen;
    }, [frozen]);

    // Trails LiveTrails keeps on screen — the current live trails plus recently
    // departed ones still fading out. Owned here (not just `trailStates`) so a
    // trail's lifetime is decoupled from the churning event window. Each entry
    // tracks `departedAt` (null while still live). Updated ONLY in the effect
    // below (never during render) so the rendered keys are always unique.
    const [kept, setKept] = useState<KeptTrail[]>(() =>
      trailStates.map((trail) => ({ trail, departedAt: null })),
    );
    const keptRef = useRef<KeptTrail[]>(kept);
    useEffect(() => {
      keptRef.current = kept;
    }, [kept]);

    // Reconcile `kept` with the latest live trails. Runs on every trailStates
    // change (live data changes frequently, so this also drives depart expiry).
    useEffect(() => {
      const now = performance.now();
      const liveById = new Map(trailStates.map((t) => [t.trail.id, t]));

      setKept((prev) => {
        const next: KeptTrail[] = [];
        const handled = new Set<string>();

        for (const entry of prev) {
          const id = entry.trail.trail.id;
          handled.add(id);
          const live = liveById.get(id);
          if (live) {
            // Still live — refresh geometry, clear any departed mark.
            next.push({ trail: live, departedAt: null });
          } else if (entry.departedAt === null) {
            // Just left — start its fade.
            next.push({ trail: entry.trail, departedAt: now });
          } else if (now - entry.departedAt < KEEP_AFTER_DEPART_MS) {
            // Still fading — keep.
            next.push(entry);
          }
          // else: fully faded — drop.
        }
        // Brand-new live trails not already in `kept`.
        for (const t of trailStates) {
          if (!handled.has(t.trail.id)) {
            next.push({ trail: t, departedAt: null });
          }
        }
        return next;
      });
    }, [trailStates]);

    // Per-trail imperative handles, keyed by stable trail id.
    const trailHandles = useRef<Map<string, ImperativeTrailHandle>>(new Map());
    const cursorHandles = useRef<Map<string, ImperativeTrailCursorHandle>>(
      new Map(),
    );

    // Wall-clock time each trail (by id) was first seen — the basis for its draw
    // progress. Set once, pruned when the trail leaves the window.
    const firstSeenRef = useRef<Map<string, number>>(new Map());

    // Accumulated paused wall-clock, subtracted from the clock so trails don't
    // leap when resumed.
    const pausedAccumMsRef = useRef(0);
    const pauseStartedAtRef = useRef<number | null>(null);

    useEffect(() => {
      const clearScheduled = () => {
        if (animationRef.current !== undefined) {
          cancelAnimationFrame(animationRef.current);
          animationRef.current = undefined;
        }
        if (timeoutRef.current !== undefined) {
          window.clearTimeout(timeoutRef.current);
          timeoutRef.current = undefined;
        }
      };

      const scheduleNext = () => {
        clearScheduled();
        if (document.visibilityState === "hidden") {
          timeoutRef.current = window.setTimeout(
            () => tick(performance.now()),
            HIDDEN_TAB_TICK_MS,
          );
          return;
        }
        animationRef.current = requestAnimationFrame(tick);
      };

      const tick = (perfNow: number) => {
        try {
          runFrame(perfNow);
        } catch (err) {
          console.warn("[LiveTrails] frame error:", err);
        }
        scheduleNext();
      };

      const runFrame = (perfNow: number) => {
        if (frozenRef.current) {
          if (pauseStartedAtRef.current === null) {
            pauseStartedAtRef.current = perfNow;
          }
          return;
        }
        if (pauseStartedAtRef.current !== null) {
          pausedAccumMsRef.current += perfNow - pauseStartedAtRef.current;
          pauseStartedAtRef.current = null;
        }

        const entries = keptRef.current;
        const clockMs = perfNow - pausedAccumMsRef.current;
        const speed = animationSpeedRef.current;
        const trailOpacity = trailOpacityRef.current;
        const strokeWidth = strokeWidthRef.current;
        const firstSeen = firstSeenRef.current;

        const present = new Set<string>();

        for (const entry of entries) {
          const ts = entry.trail;
          const key = ts.trail.id;
          present.add(key);
          const handle = trailHandles.current.get(key);
          if (!handle) continue;

          // First time we draw this trail: anchor its draw clock to now.
          let seenAt = firstSeen.get(key);
          if (seenAt === undefined) {
            seenAt = clockMs;
            firstSeen.set(key, seenAt);
          }

          const drawDuration = drawDurationFor(ts.durationMs, speed);
          const progress = Math.min(1, (clockMs - seenAt) / drawDuration);
          const isFinished = progress >= 1;

          // Departed trails fade from their current opacity to 0 over the keep
          // window, then the reconcile effect drops them.
          let departFade = 1;
          if (entry.departedAt !== null) {
            departFade = Math.max(
              0,
              1 - (perfNow - entry.departedAt) / KEEP_AFTER_DEPART_MS,
            );
          }

          // Finished trails dim to COMPLETED_OPACITY and persist while live.
          // Drawing trails are full opacity. Depart fade multiplies on top.
          const groupFade = (isFinished ? COMPLETED_OPACITY : 1) * departFade;

          const result = handle.update(
            0,
            trailOpacity,
            strokeWidth,
            groupFade,
            progress,
          );

          const cursorHandle = cursorHandles.current.get(key);
          if (
            cursorHandle &&
            result &&
            result.cursorPosition &&
            !isFinished &&
            entry.departedAt === null
          ) {
            const cpIdx = Math.min(
              Math.floor((ts.trail.points.length - 1) * result.trailProgress),
              ts.trail.points.length - 1,
            );
            cursorHandle.update(
              result.cursorPosition,
              ts.trail.points[cpIdx]?.cursor,
              result.trailProgress >= 1,
              result.trailProgress,
              groupFade,
            );
          } else {
            cursorHandle?.hide();
          }
        }

        // Prune firstSeen for trails that left the window so the map can't grow.
        if (firstSeen.size > present.size) {
          for (const key of firstSeen.keys()) {
            if (!present.has(key)) firstSeen.delete(key);
          }
        }
      };

      const onVisibility = () => scheduleNext();
      document.addEventListener("visibilitychange", onVisibility);
      scheduleNext();

      return () => {
        document.removeEventListener("visibilitychange", onVisibility);
        clearScheduled();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
      <svg
        ref={svgRef}
        className="trails-svg"
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      >
        <g ref={pathLayerRef}>
          {kept.map((entry) => {
            const ts = entry.trail;
            const key = ts.trail.id;
            return (
              <TrailPath
                key={`live-path-${key}`}
                ref={(handle) => {
                  if (handle) trailHandles.current.set(key, handle);
                  else trailHandles.current.delete(key);
                }}
                trailState={ts}
                fixedMonoStrokeWidth={1 + (hashKey(key) % 5)}
                renderer={renderer}
              />
            );
          })}
        </g>
        {kept.map((entry) => {
          const ts = entry.trail;
          const key = ts.trail.id;
          return (
            <TrailCursor
              key={`live-cursor-${key}`}
              ref={(handle) => {
                if (handle) cursorHandles.current.set(key, handle);
                else cursorHandles.current.delete(key);
              }}
              trailState={ts}
              renderer={renderer}
            />
          );
        })}
      </svg>
    );
  },
);
