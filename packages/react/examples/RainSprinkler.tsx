import React from "react";
import { PlayContext } from "@playhtml/react";
import { useContext, useEffect } from "react";

const RainEventType = "rain";

function useRain() {
  const {
    registerPlayEventListener,
    removePlayEventListener,
    dispatchPlayEvent,
  } = useContext(PlayContext);

  useEffect(() => {
    const id = registerPlayEventListener(RainEventType, {
      onEvent: () => {
        // Imperative action: create clouds and rain at body level
        createRainEffect();
      },
    });

    return () => removePlayEventListener(RainEventType, id);
  }, []);

  return {
    triggerRain: () => dispatchPlayEvent({ type: RainEventType }),
  };
}

function createRainEffect() {
  // Remove any existing rain clouds and background
  const existingClouds = document.querySelectorAll(".rain-effect-cloud");
  existingClouds.forEach((cloud) => cloud.remove());
  const existingRainBg = document.querySelector(".rain-background");
  if (existingRainBg) existingRainBg.remove();

  // Create rain background overlay
  const rainBackground = document.createElement("div");
  rainBackground.className = "rain-background";
  rainBackground.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-image: url('https://media2.giphy.com/media/v1.Y2lkPTZjMDliOTUycHM3c2xicTI5eHN5Z2t3bm1jdDR0aHBpbjJyMmhpZ24wd3JmdnNnZiZlcD12MV9zdGlja2Vyc19zZWFyY2gmY3Q9cw/Wmp1EOzVybWd13s5DB/giphy.gif');
    background-size: 200px 200px;
    background-repeat: repeat;
    z-index: 9998;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.5s ease-in-out;
  `;
  document.body.appendChild(rainBackground);

  // Create multiple clouds spread evenly across the top
  const numClouds = 5;
  // Wait for all clouds to be in position before starting rain
  setTimeout(() => {
    rainBackground.style.opacity = "0.7";
  }, numClouds * 150 + 500); // Wait for last cloud + extra 500ms

  const viewportWidth = window.innerWidth;
  const cloudWidth = 150;
  const spacing = (viewportWidth - cloudWidth * numClouds) / (numClouds + 1);

  for (let i = 0; i < numClouds; i++) {
    const cloud = document.createElement("div");
    cloud.className = "rain-effect-cloud";

    // Calculate even distribution across viewport
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

    // Slide clouds in to their positions
    setTimeout(() => {
      cloud.style.opacity = "0.9";
      cloud.style.transform = `translateX(${targetX}px)`;
    }, i * 150);

    // Remove clouds and rain after animation
    setTimeout(() => {
      cloud.style.opacity = "0";
      cloud.style.transform = `translateX(${
        i % 2 === 0 ? viewportWidth + 200 : -200
      }px)`;
      setTimeout(() => cloud.remove(), 1500);
    }, 5000);
  }

  // Remove rain background after total effect
  setTimeout(() => {
    rainBackground.style.opacity = "0";
    setTimeout(() => rainBackground.remove(), 500);
  }, 6000);
}

export function RainSprinkler({ style }: { style?: React.CSSProperties }) {
  const { triggerRain } = useRain();

  return (
    <div
      id="rain-sprinkler"
      style={{
        width: "100%",
      }}
    >
      <div
        className="fire-hydrant"
        onClick={triggerRain}
        style={style}
        title="Click to trigger rain!"
      />
    </div>
  );
}
