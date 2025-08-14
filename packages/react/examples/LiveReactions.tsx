import React, { useEffect, useMemo, useRef, useState } from "react";
import { withSharedState } from "@playhtml/react";

type ReactionBurst = {
  id: string;
  emoji: string;
  at: number; // timestamp ms
};

type ReactionsData = {
  bursts: ReactionBurst[]; // rolling window
};

interface LiveReactionsProps {
  emoji?: string;
  windowMs?: number;
}

export const LiveReactions = withSharedState<
  ReactionsData,
  any,
  LiveReactionsProps
>(
  { defaultData: { bursts: [] } },
  ({ data, setData }, { emoji = "💖", windowMs = 5000 }) => {
    const [now, setNow] = useState(Date.now());
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
      const tick = () => {
        setNow(Date.now());
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => {
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      };
    }, []);

    const bursts = useMemo(() => {
      const cutoff = now - windowMs;
      return data.bursts.filter((b) => b.at >= cutoff);
    }, [data.bursts, now, windowMs]);

    const fire = () => {
      const id = Math.random().toString(36).slice(2, 9);
      const at = Date.now();
      setData({ bursts: [...bursts, { id, emoji, at }] });
    };

    return (
      <div
        id="live-reactions"
        style={{ position: "relative", width: 240, height: 160 }}
      >
        <button onClick={fire}>React {emoji}</button>
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          {bursts.map((b) => {
            const t = Math.min(1, (now - b.at) / windowMs);
            const y = 140 - t * 140;
            const scale = 0.8 + 0.4 * (1 - t);
            const opacity = 1 - t;
            const left = 20 + (b.id.charCodeAt(0) % 180);
            return (
              <div
                key={b.id}
                style={{
                  position: "absolute",
                  left,
                  top: y,
                  transform: `scale(${scale})`,
                  opacity,
                  pointerEvents: "none",
                }}
              >
                {b.emoji}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);
