// Docs live demo for events: emoji bursts that only people here right now see.
// The code readers copy lives in demo-code/snippets/events.ts.
//
// Uses the `playhtml` singleton rather than PlayContext because the docs site
// never renders <PlayProvider> (see RainSprinklerDemo).
import React, { useEffect, useState } from "react";
import { playhtml } from "playhtml";

const REACTION_EVENT = "docs-live-reaction";
const EMOJIS = ["❤️", "✨", "🔥", "🎉"];

type Burst = { id: string; emoji: string; left: number };

export function LiveReactionsDemo(): React.ReactElement {
  const [bursts, setBursts] = useState<Burst[]>([]);

  // Each reaction becomes a burst that removes itself when its animation ends.
  useEffect(() => {
    const id = playhtml.registerPlayEventListener(REACTION_EVENT, {
      // onEvent receives the dispatched eventPayload itself, although
      // PlayEvent types it as { eventPayload }.
      onEvent: (payload) => {
        const { emoji } = payload as unknown as { emoji: string };
        const burst = {
          id: crypto.randomUUID(),
          emoji,
          left: Math.random() * 90,
        };
        setBursts((current) => [...current, burst]);
      },
    });
    return () => playhtml.removePlayEventListener(REACTION_EVENT, id);
  }, []);

  return (
    <div className="ph-live-reactions">
      <div className="ph-live-reactions__picker">
        {EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="ph-live-reactions__swatch"
            aria-label={`Send ${emoji}`}
            onClick={() =>
              playhtml.dispatchPlayEvent({
                type: REACTION_EVENT,
                eventPayload: { emoji },
              })
            }
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="ph-live-reactions__stage" aria-hidden="true">
        {bursts.map((burst) => (
          <span
            key={burst.id}
            className="ph-live-reactions__burst"
            style={{ left: `${burst.left}%` }}
            onAnimationEnd={() =>
              setBursts((current) => current.filter((b) => b.id !== burst.id))
            }
          >
            {burst.emoji}
          </span>
        ))}
      </div>
    </div>
  );
}
