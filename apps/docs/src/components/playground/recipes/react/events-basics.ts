// ABOUTME: Provides the copy-paste React sources for the rain and live reactions recipes.
// ABOUTME: Listeners register on mount and unregister on unmount so remounts never double up.
import { liveReactionsCss, makeItRain, rainCss } from "../demo-shared";
import { appShell } from "./app-shell";

export const rainEventReactSource = `import { useEffect } from "react";
import { PlayProvider, usePlayContext } from "@playhtml/react";

${makeItRain}

function RainHydrant() {
  const {
    registerPlayEventListener,
    removePlayEventListener,
    dispatchPlayEvent,
  } = usePlayContext();

  // Listen while mounted. Without the cleanup, every remount adds a listener.
  useEffect(() => {
    const id = registerPlayEventListener("rain", { onEvent: makeItRain });
    return () => removePlayEventListener("rain", id);
  }, []);

  return (
    <button
      className="hydrant"
      aria-label="Summon rain"
      onClick={() => dispatchPlayEvent({ type: "rain" })}
    />
  );
}

${appShell("RainHydrant", rainCss)}`;

export const liveReactionsReactSource = `import { useEffect, useState } from "react";
import { PlayProvider, usePlayContext } from "@playhtml/react";

const EMOJIS = ["❤️", "✨", "🔥", "🎉"];

type Burst = { id: string; emoji: string; left: number };

function LiveReactions() {
  const {
    registerPlayEventListener,
    removePlayEventListener,
    dispatchPlayEvent,
  } = usePlayContext();
  const [bursts, setBursts] = useState<Burst[]>([]);

  // Each reaction becomes a burst that removes itself once it floats away.
  useEffect(() => {
    const id = registerPlayEventListener("reaction", {
      onEvent: ({ emoji }: { emoji: string }) => {
        const left = Math.random() * 90;
        setBursts((all) => [...all, { id: crypto.randomUUID(), emoji, left }]);
      },
    });
    return () => removePlayEventListener("reaction", id);
  }, []);

  return (
    <div className="reactions">
      {EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() =>
            dispatchPlayEvent({ type: "reaction", eventPayload: { emoji } })
          }
        >
          {emoji}
        </button>
      ))}
      {bursts.map((burst) => (
        <span
          key={burst.id}
          className="burst"
          style={{ left: \`\${burst.left}%\` }}
          onAnimationEnd={() =>
            setBursts((all) => all.filter((b) => b.id !== burst.id))
          }
        >
          {burst.emoji}
        </span>
      ))}
    </div>
  );
}

${appShell("LiveReactions", liveReactionsCss)}`;
