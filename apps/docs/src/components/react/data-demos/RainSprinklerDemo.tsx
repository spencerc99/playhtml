import React, { useEffect } from "react";
import { playhtml } from "playhtml";

// Thin docs wrapper around the homepage's fire-hydrant/rain effect.
// The marketing site's version lives in packages/react/examples/RainSprinkler
// and imports asset URLs that only resolve on the root domain; we recreate
// the event wiring here and point at assets we've copied into
// apps/docs/public/.
//
// Why not import the original? It references a specific .fire-hydrant CSS
// class that lives in website/components/FeaturesGrid.scss (with a hover
// scale) which we don't ship. Copying the 20 lines of wiring is clearer
// than trying to re-use the marketing-site styling.
//
// Why `playhtml` singleton instead of `useContext(PlayContext)`? The docs
// site calls `playhtml.init()` globally from HeadOverride.astro and never
// wraps its React islands in <PlayProvider>. Reading the context here would
// hit the default value whose methods throw, crashing the island — hence
// the "hydrant flashes on screen, then disappears" symptom that kept
// regressing. The singleton is the same instance HeadOverride initialized,
// so we just use it directly.

const RAIN_EVENT = "rain";

function createRainEffect(): void {
  document.querySelectorAll(".ph-docs-rain-cloud").forEach((n) => n.remove());
  document.querySelector(".ph-docs-rain-bg")?.remove();

  const bg = document.createElement("div");
  bg.className = "ph-docs-rain-bg";
  bg.style.cssText = `
    position: fixed;
    inset: 0;
    background-image: url('https://media2.giphy.com/media/v1.Y2lkPTZjMDliOTUycHM3c2xicTI5eHN5Z2t3bm1jdDR0aHBpbjJyMmhpZ24wd3JmdnNnZiZlcD12MV9zdGlja2Vyc19zZWFyY2gmY3Q9cw/Wmp1EOzVybWd13s5DB/giphy.gif');
    background-size: 200px 200px;
    background-repeat: repeat;
    z-index: 9998;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.5s ease-in-out;
  `;
  document.body.appendChild(bg);

  const numClouds = 5;
  const cloudWidth = 150;
  const viewportWidth = window.innerWidth;
  const spacing = (viewportWidth - cloudWidth * numClouds) / (numClouds + 1);

  window.setTimeout(() => {
    bg.style.opacity = "0.7";
  }, numClouds * 150 + 500);

  for (let i = 0; i < numClouds; i++) {
    const cloud = document.createElement("div");
    cloud.className = "ph-docs-rain-cloud";

    const targetX = spacing + i * (cloudWidth + spacing);
    const startX = i % 2 === 0 ? -200 : viewportWidth + 200;

    cloud.style.cssText = `
      position: fixed;
      top: ${10 + (i % 3) * 20}px;
      width: ${cloudWidth}px;
      height: 80px;
      background: url('/rain-cloud.webp') no-repeat center;
      background-size: contain;
      z-index: 9999;
      pointer-events: none;
      opacity: 0;
      transform: translateX(${startX}px);
      transition: all 1.5s ease-out;
    `;
    document.body.appendChild(cloud);

    window.setTimeout(() => {
      cloud.style.opacity = "0.9";
      cloud.style.transform = `translateX(${targetX}px)`;
    }, i * 150);

    window.setTimeout(() => {
      cloud.style.opacity = "0";
      cloud.style.transform = `translateX(${
        i % 2 === 0 ? viewportWidth + 200 : -200
      }px)`;
      window.setTimeout(() => cloud.remove(), 1500);
    }, 5000);
  }

  window.setTimeout(() => {
    bg.style.opacity = "0";
    window.setTimeout(() => bg.remove(), 500);
  }, 6000);
}

export function RainSprinklerDemo(): React.ReactElement {
  useEffect(() => {
    const id = playhtml.registerPlayEventListener(RAIN_EVENT, {
      onEvent: () => createRainEffect(),
    });
    return () => playhtml.removePlayEventListener(RAIN_EVENT, id);
  }, []);

  const trigger = () => playhtml.dispatchPlayEvent({ type: RAIN_EVENT });

  return (
    <div className="ph-rain-demo">
      <button
        type="button"
        className="ph-rain-demo__hydrant"
        onClick={trigger}
        title="Click to summon rain for everyone reading right now"
        aria-label="Summon rain"
      />
      <p className="ph-rain-demo__caption">
        Click the hydrant. Everyone on this page sees the clouds drift in.
      </p>
    </div>
  );
}
