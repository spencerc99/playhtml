// ABOUTME: Renders the pasture background and perched/ghost cursors along the horizon.
// ABOUTME: Handles idle twitching animations and occasional flight arcs.
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

  // Position each cursor along the horizon with deterministic randomness
  const positioned = useMemo(() => {
    return cursors.map((cursor) => {
      const rand = seededRandom(cursor.createdAt);
      const xPercent = 5 + rand() * 90; // 5% to 95% of viewport width
      const yOffset = (rand() - 0.5) * 20; // ±10px from horizon
      const animDelay = rand() * 8; // 0-8s animation delay
      const twitchDuration = 3 + rand() * 4; // 3-7s twitch cycle
      return { cursor, xPercent, yOffset, animDelay, twitchDuration };
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
        setTimeout(() => target.classList.remove("flying"), 3000);
      },
      15000 + Math.random() * 15000
    );

    return () => clearInterval(flightTimerRef.current);
  }, []);

  return (
    <div className="pasture-scene">
      <div className="pasture-bg" />
      <div className="horizon">
        {positioned.map(
          ({ cursor, xPercent, yOffset, animDelay, twitchDuration }) => {
            const isOnline = onlineCreatorIds.has(cursor.creatorId);
            const isMine = cursor.creatorId === myCreatorId;
            const isGhost = isOnline || isMine;
            const svgUrl = composeSvgDataUrl(cursor.strokes, 28);

            return (
              <div
                key={cursor.creatorId}
                className={`perched-cursor ${isGhost ? "ghost" : ""}`}
                style={{
                  left: `${xPercent}%`,
                  bottom: `${33 + (yOffset / window.innerHeight) * 100}%`,
                  animationDelay: `${animDelay}s`,
                  animationDuration: `${twitchDuration}s`,
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
