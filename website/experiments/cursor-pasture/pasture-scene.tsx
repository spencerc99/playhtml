// ABOUTME: Renders the meadow scene with sky, clouds, perched cursors, and drifting flocks.
// ABOUTME: Splits cursors between perched (static) and flocking (scrolling) based on capacity.
import React, { useEffect, useRef, useMemo } from "react";
import { composeSvgDataUrl, type CursorDrawing } from "./svg-utils";

const PERCH_CAPACITY = 12;
const FLOCK_SIZE_MIN = 3;
const FLOCK_SIZE_MAX = 5;

interface PastureSceneProps {
  cursors: CursorDrawing[];
  onlineCreatorIds: Set<string>;
  myCreatorId?: string;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

interface PerchedCursor {
  cursor: CursorDrawing;
  xPercent: number;
  yPercent: number;
  animDelay: number;
  bobDuration: number;
  size: number;
}

export function PastureScene({
  cursors,
  onlineCreatorIds,
  myCreatorId,
}: PastureSceneProps) {
  const flightTimerRef = useRef<ReturnType<typeof setInterval>>();

  // Split cursors: oldest ones perch, the rest form flocks
  const { perched, flocks } = useMemo(() => {
    const sorted = [...cursors].sort((a, b) => a.createdAt - b.createdAt);
    const perchedCursors = sorted.slice(0, PERCH_CAPACITY);
    const overflowCursors = sorted.slice(PERCH_CAPACITY);

    // Position perched cursors in the sky
    const perchedPositioned: PerchedCursor[] = perchedCursors.map((cursor) => {
      const rand = seededRandom(cursor.createdAt);
      return {
        cursor,
        xPercent: 5 + rand() * 90,
        yPercent: 8 + rand() * 35,
        animDelay: rand() * 10,
        bobDuration: 4 + rand() * 6,
        size: 40 + rand() * 20,
      };
    });

    // Group overflow cursors into flocks of 3-5
    const flockGroups: CursorDrawing[][] = [];
    let i = 0;
    while (i < overflowCursors.length) {
      const remaining = overflowCursors.length - i;
      const rand = seededRandom(overflowCursors[i].createdAt);
      const size = Math.min(
        FLOCK_SIZE_MIN +
          Math.floor(rand() * (FLOCK_SIZE_MAX - FLOCK_SIZE_MIN + 1)),
        remaining
      );
      flockGroups.push(overflowCursors.slice(i, i + size));
      i += size;
    }

    return { perched: perchedPositioned, flocks: flockGroups };
  }, [cursors]);

  // Trigger random flights for perched cursors
  useEffect(() => {
    const perchedElements = () =>
      document.querySelectorAll<HTMLElement>(
        ".perched-cursor:not(.ghost):not(.flying)"
      );

    flightTimerRef.current = setInterval(
      () => {
        const els = perchedElements();
        if (els.length === 0) return;
        const target = els[Math.floor(Math.random() * els.length)];
        target.classList.add("flying");
        setTimeout(() => target.classList.remove("flying"), 4000);
      },
      8000 + Math.random() * 7000
    );

    return () => clearInterval(flightTimerRef.current);
  }, []);

  return (
    <div className="pasture-scene">
      <div className="pasture-bg" />
      <div className="cloud cloud-1" />
      <div className="cloud cloud-2" />
      <div className="cloud cloud-3" />
      <div className="sky">
        {/* Perched cursors — static positions in the sky */}
        {perched.map(
          ({ cursor, xPercent, yPercent, animDelay, bobDuration, size }) => {
            const isOnline = onlineCreatorIds.has(cursor.creatorId);
            const isMine = cursor.creatorId === myCreatorId;
            const isGhost = isOnline || isMine;
            const svgUrl = composeSvgDataUrl(
              cursor.strokes,
              Math.round(size)
            );

            return (
              <div
                key={cursor.creatorId}
                className={`perched-cursor ${isGhost ? "ghost" : ""}`}
                style={{
                  left: `${xPercent}%`,
                  top: `${yPercent}%`,
                  width: `${size}px`,
                  height: `${size}px`,
                  animationDelay: `${animDelay}s`,
                  animationDuration: `${bobDuration}s`,
                }}
              >
                <img src={svgUrl} alt="cursor" draggable={false} />
              </div>
            );
          }
        )}

        {/* Flocks — groups drifting horizontally across the sky */}
        {flocks.map((flock, flockIndex) => {
          const flockRand = seededRandom(
            flock[0].createdAt + flockIndex * 7919
          );
          const yPercent = 10 + flockRand() * 40;
          const duration = 30 + flockRand() * 30;
          const delay = flockRand() * -duration;

          return (
            <div
              key={`flock-${flockIndex}`}
              className="flock"
              style={{
                top: `${yPercent}%`,
                animationDuration: `${duration}s`,
                animationDelay: `${delay}s`,
              }}
            >
              {flock.map((cursor) => {
                const cRand = seededRandom(cursor.createdAt);
                const offsetX = (cRand() - 0.5) * 60;
                const offsetY = (cRand() - 0.5) * 40;
                const bobDuration = 4 + cRand() * 6;
                const bobDelay = cRand() * 10;
                const size = 36 + cRand() * 16;
                const isOnline = onlineCreatorIds.has(cursor.creatorId);
                const isMine = cursor.creatorId === myCreatorId;
                const isGhost = isOnline || isMine;
                const svgUrl = composeSvgDataUrl(
                  cursor.strokes,
                  Math.round(size)
                );

                return (
                  <div
                    key={cursor.creatorId}
                    className={`flock-cursor ${isGhost ? "ghost" : ""}`}
                    style={{
                      transform: `translate(${offsetX}px, ${offsetY}px)`,
                      width: `${size}px`,
                      height: `${size}px`,
                    }}
                  >
                    <div
                      className="flock-cursor-bob"
                      style={{
                        animationDuration: `${bobDuration}s`,
                        animationDelay: `${bobDelay}s`,
                      }}
                    >
                      <img src={svgUrl} alt="cursor" draggable={false} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
