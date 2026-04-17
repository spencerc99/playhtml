import React, { useContext, useEffect, useRef, useState } from "react";
import { PlayContext } from "@playhtml/react";

// A "live reactions" button: click to send an emoji burst; everyone on the
// page right now sees it, nobody who joins later does. This is fundamentally
// an EVENT, not presence or persistent data — no replay, no state to read.
//
// The examples/LiveReactions.tsx in packages/react is implemented with
// withSharedState (rolling-window array in element data). That works but
// mis-teaches: the pattern looks like events, so we build it with the real
// events API here for the docs.

const REACTION_EVENT = "docs-reaction";
const EMOJI_CHOICES = ["❤️", "✨", "🔥", "🎉"];
const BURST_TTL_MS = 5000;

type Burst = { id: string; emoji: string; at: number };

export function LiveReactionsDemo(): React.ReactElement {
  const ctx = useContext(PlayContext);
  const [myEmoji, setMyEmoji] = useState(EMOJI_CHOICES[0]);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      setNow(Date.now());
      rafRef.current = window.requestAnimationFrame(tick);
    };
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ctx) return;
    const id = ctx.registerPlayEventListener(REACTION_EVENT, {
      onEvent: (payload: unknown) => {
        const { emoji } = (payload ?? {}) as { emoji?: string };
        if (!emoji) return;
        const burst: Burst = {
          id: Math.random().toString(36).slice(2, 9),
          emoji,
          at: Date.now(),
        };
        setBursts((prev) => [...prev, burst]);
        window.setTimeout(() => {
          setBursts((prev) => prev.filter((b) => b.id !== burst.id));
        }, BURST_TTL_MS);
      },
    });
    return () => ctx.removePlayEventListener(REACTION_EVENT, id);
  }, [ctx]);

  const fire = () => {
    ctx?.dispatchPlayEvent({
      type: REACTION_EVENT,
      data: { emoji: myEmoji },
    });
  };

  return (
    <div className="ph-live-reactions">
      <div
        className="ph-live-reactions__picker"
        role="radiogroup"
        aria-label="emoji"
      >
        {EMOJI_CHOICES.map((emoji) => (
          <button
            key={emoji}
            type="button"
            role="radio"
            aria-checked={myEmoji === emoji}
            className={`ph-live-reactions__swatch${
              myEmoji === emoji ? " is-active" : ""
            }`}
            onClick={() => setMyEmoji(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="ph-live-reactions__fire"
        onClick={fire}
      >
        react with {myEmoji}
      </button>

      <div className="ph-live-reactions__stage" aria-hidden="true">
        {bursts.map((b) => {
          const t = Math.min(1, (now - b.at) / BURST_TTL_MS);
          const left = 12 + (b.id.charCodeAt(0) % 78);
          return (
            <span
              key={b.id}
              className="ph-live-reactions__burst"
              style={{
                left: `${left}%`,
                opacity: 1 - t,
                transform: `translateY(${-t * 110}px) scale(${
                  0.8 + 0.4 * (1 - t)
                })`,
              }}
            >
              {b.emoji}
            </span>
          );
        })}
      </div>
    </div>
  );
}
