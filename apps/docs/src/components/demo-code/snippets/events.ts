// ABOUTME: Copyable sources for the events demos: summon rain and send live emoji reactions.
// ABOUTME: Events reach everyone on the page right now and are never stored.
import { indent } from "../indent";
import type { DemoSnippet } from "../types";

const rainCss = `.hydrant {
  width: 120px;
  height: 150px;
  border: 0;
  background: url("https://playhtml.fun/docs/fire-hydrant.png") center / contain
    no-repeat;
  cursor: pointer;
}
.rain {
  position: fixed;
  inset: 0;
  z-index: 9999;
  pointer-events: none;
}
.rain::before {
  content: "";
  position: absolute;
  inset: 0;
  background: url("https://media.giphy.com/media/Wmp1EOzVybWd13s5DB/giphy.gif")
    0 0 / 200px;
  animation: rain 6s ease-in-out forwards;
}
.cloud {
  position: absolute;
  top: 10px;
  width: 150px;
  height: 80px;
  background: url("https://playhtml.fun/docs/rain-cloud.webp") center / contain
    no-repeat;
  animation: cloud 5.5s ease-out both;
}
@keyframes rain {
  0%, 15% { opacity: 0; }
  30%, 85% { opacity: 0.7; }
  100% { opacity: 0; }
}
@keyframes cloud {
  0% { opacity: 0; transform: translateY(-120px); }
  20%, 80% { opacity: 0.9; transform: none; }
  100% { opacity: 0; transform: translateY(-120px); }
}`;

const makeItRain = `// Fade in rain under a row of five clouds, then clean up.
function makeItRain() {
  const rain = document.createElement("div");
  rain.className = "rain";
  for (let i = 0; i < 5; i++) {
    const cloud = document.createElement("div");
    cloud.className = "cloud";
    cloud.style.left = \`\${i * 20}%\`;
    cloud.style.animationDelay = \`\${i * 150}ms\`;
    rain.append(cloud);
  }
  document.body.append(rain);
  setTimeout(() => rain.remove(), 6000);
}`;

export const rainSnippet: DemoSnippet = {
  html: `<button id="hydrant" class="hydrant" aria-label="Summon rain"></button>

<style>
${indent(rainCss)}
</style>

<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml@latest";

${indent(makeItRain)}

  playhtml.init({
    events: {
      rain: { type: "rain", onEvent: makeItRain },
    },
  });

  document.getElementById("hydrant").addEventListener("click", () => {
    playhtml.dispatchPlayEvent({ type: "rain" });
  });
</script>`,
  react: `import { useEffect } from "react";
import { usePlayContext } from "@playhtml/react";

${makeItRain}

export function RainHydrant() {
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
}`,
  reactCss: rainCss,
};

const reactionsCss = `.reactions {
  position: relative;
  height: 180px;
  overflow: hidden;
}
.burst {
  position: absolute;
  bottom: 0;
  font-size: 1.65rem;
  pointer-events: none;
  animation: float-up 2.5s ease-out forwards;
}
@keyframes float-up {
  to { opacity: 0; transform: translateY(-140px) scale(0.8); }
}`;

export const liveReactionsSnippet: DemoSnippet = {
  html: `<div id="reactions" class="reactions">
  <button data-emoji="❤️">❤️</button>
  <button data-emoji="✨">✨</button>
  <button data-emoji="🔥">🔥</button>
  <button data-emoji="🎉">🎉</button>
</div>

<style>
${indent(reactionsCss)}
</style>

<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml@latest";

  const stage = document.getElementById("reactions");

  // Float one emoji up from a random spot, then remove it.
  function burst({ emoji }) {
    const el = document.createElement("span");
    el.className = "burst";
    el.textContent = emoji;
    el.style.left = \`\${Math.random() * 90}%\`;
    el.addEventListener("animationend", () => el.remove());
    stage.append(el);
  }

  playhtml.init({
    events: {
      reaction: { type: "reaction", onEvent: burst },
    },
  });

  for (const button of stage.querySelectorAll("button")) {
    button.addEventListener("click", () => {
      playhtml.dispatchPlayEvent({
        type: "reaction",
        eventPayload: { emoji: button.dataset.emoji },
      });
    });
  }
</script>`,
  react: `import { useEffect, useState } from "react";
import { usePlayContext } from "@playhtml/react";

const EMOJIS = ["❤️", "✨", "🔥", "🎉"];

type Burst = { id: string; emoji: string; left: number };

export function LiveReactions() {
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
}`,
  reactCss: reactionsCss,
};
