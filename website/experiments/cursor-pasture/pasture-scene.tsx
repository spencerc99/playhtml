// ABOUTME: Renders the pasture background and perched/ghost cursors floating in the sky.
// ABOUTME: Handles idle bobbing animations and occasional flight arcs.
import React, { useEffect, useRef, useMemo } from "react";
import { composeSvgDataUrl, type CursorDrawing } from "./svg-utils";

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

export function PastureScene({
  cursors,
  onlineCreatorIds,
  myCreatorId,
}: PastureSceneProps) {
  const flightTimerRef = useRef<ReturnType<typeof setInterval>>();

  // Position each cursor in the sky with deterministic randomness
  const positioned = useMemo(() => {
    return cursors.map((cursor) => {
      const rand = seededRandom(cursor.createdAt);
      const xPercent = 5 + rand() * 90; // 5% to 95% of viewport width
      const yPercent = 8 + rand() * 35; // 8% to 43% from top (upper portion)
      const animDelay = rand() * 10; // 0-10s animation delay
      const bobDuration = 4 + rand() * 6; // 4-10s bob cycle
      const size = 40 + rand() * 20; // 40-60px
      return { cursor, xPercent, yPercent, animDelay, bobDuration, size };
    });
  }, [cursors]);

  // Trigger random flights
  useEffect(() => {
    const perchedElements = () =>
      document.querySelectorAll<HTMLElement>(
        ".perched-cursor:not(.ghost):not(.flying)"
      );

    flightTimerRef.current = setInterval(
      () => {
        const perched = perchedElements();
        if (perched.length === 0) return;
        const target = perched[Math.floor(Math.random() * perched.length)];
        target.classList.add("flying");
        setTimeout(() => target.classList.remove("flying"), 4000);
      },
      15000 + Math.random() * 15000
    );

    return () => clearInterval(flightTimerRef.current);
  }, []);

  return (
    <div className="pasture-scene">
      <div className="pasture-bg" />
      <div className="sky">
        {positioned.map(
          ({ cursor, xPercent, yPercent, animDelay, bobDuration, size }) => {
            const isOnline = onlineCreatorIds.has(cursor.creatorId);
            const isMine = cursor.creatorId === myCreatorId;
            const isGhost = isOnline || isMine;
            const svgUrl = composeSvgDataUrl(cursor.strokes, Math.round(size));

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
      </div>
    </div>
  );
}
