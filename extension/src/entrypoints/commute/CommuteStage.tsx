// ABOUTME: Fits the authored Internet Commute carriage into the available mobile viewport.
// ABOUTME: Preserves the desktop-size artwork while keeping surrounding status bars readable.

import { type ReactNode, useEffect, useRef } from "react";

interface CommuteStageProps {
  children: ReactNode;
}

export function CommuteStage({ children }: CommuteStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const stage = stageRef.current;
    if (!viewport || !stage) return;

    const fitStage = () => {
      const horizontalBreathingRoom = 20;
      const verticalBreathingRoom = 20;
      const scale = Math.max(
        0,
        Math.min(
          (viewport.clientWidth - horizontalBreathingRoom) / stage.offsetWidth,
          (viewport.clientHeight - verticalBreathingRoom) / stage.offsetHeight,
          1,
        ),
      );
      stage.style.setProperty("--commute-stage-scale", String(scale));
    };

    fitStage();
    window.addEventListener("resize", fitStage);

    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(fitStage);
    resizeObserver?.observe(viewport);
    resizeObserver?.observe(stage);

    return () => {
      window.removeEventListener("resize", fitStage);
      resizeObserver?.disconnect();
    };
  }, []);

  return (
    <div className="commute-stage-viewport" ref={viewportRef}>
      <div className="commute-stage" ref={stageRef}>
        {children}
      </div>
    </div>
  );
}
