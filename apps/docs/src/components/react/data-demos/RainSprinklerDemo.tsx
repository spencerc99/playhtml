// Docs live demo for events: click the hydrant and clouds bring rain to
// everyone reading the page. The code readers copy lives in
// playground/recipes/events-basics.ts; the .ph-docs-rain styles are in docs-extras.css.
//
// Uses the `playhtml` singleton rather than PlayContext: the docs site calls
// playhtml.init() from HeadOverride.astro and never renders <PlayProvider>,
// so the context default would throw and crash the island.
import React, { useEffect } from "react";
import { playhtml } from "playhtml";

const RAIN_EVENT = "rain";

// Fade in rain under a row of five clouds, then clean up.
function makeItRain(): void {
  const rain = document.createElement("div");
  rain.className = "ph-docs-rain";
  for (let i = 0; i < 5; i++) {
    const cloud = document.createElement("div");
    cloud.className = "ph-docs-rain__cloud";
    cloud.style.left = `${i * 20}%`;
    cloud.style.animationDelay = `${i * 150}ms`;
    rain.append(cloud);
  }
  document.body.append(rain);
  window.setTimeout(() => rain.remove(), 6000);
}

export function RainSprinklerDemo(): React.ReactElement {
  useEffect(() => {
    const id = playhtml.registerPlayEventListener(RAIN_EVENT, {
      onEvent: makeItRain,
    });
    return () => playhtml.removePlayEventListener(RAIN_EVENT, id);
  }, []);

  return (
    <div className="ph-rain-demo">
      <button
        type="button"
        className="ph-rain-demo__hydrant"
        onClick={() => playhtml.dispatchPlayEvent({ type: RAIN_EVENT })}
        title="Click to summon rain for everyone reading right now"
        aria-label="Summon rain"
      />
      <p className="ph-rain-demo__caption">
        Click the hydrant. Everyone on this page sees the clouds drift in.
      </p>
    </div>
  );
}
