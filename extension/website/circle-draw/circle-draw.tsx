// ABOUTME: Presents large circle guides for deliberate cursor-trail collection.
// ABOUTME: Echoes the visitor's current gesture while the extension records it.

import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import "./circle-draw.scss";

interface Point {
  x: number;
  y: number;
}

const GUIDE_LAYOUT = [
  { left: "4%", top: "8%", width: "34vmin" },
  { left: "34%", top: "5%", width: "45vmin" },
  { right: "3%", top: "13%", width: "31vmin" },
  { left: "12%", bottom: "4%", width: "39vmin" },
  { left: "45%", bottom: "3%", width: "32vmin" },
  { right: "6%", bottom: "7%", width: "43vmin" },
];

function pointsToPath(points: Point[]): string {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`)
    .join(" ");
}

const CircleDraw = () => {
  const trailRef = useRef<SVGPathElement>(null);
  const pointsRef = useRef<Point[]>([]);
  const frameRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const renderTrail = () => {
      frameRef.current = null;
      trailRef.current?.setAttribute("d", pointsToPath(pointsRef.current));
    };

    const handlePointerMove = (event: PointerEvent) => {
      pointsRef.current.push({ x: event.clientX, y: event.clientY });
      if (pointsRef.current.length > 800) {
        pointsRef.current.splice(0, pointsRef.current.length - 800);
      }
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(renderTrail);
      }
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
      clearTimerRef.current = window.setTimeout(() => {
        pointsRef.current = [];
        trailRef.current?.setAttribute("d", "");
      }, 1800);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  return (
    <main className="circle-page">
      <header className="circle-header">
        <div>
          <h1>draw circles with us</h1>
          <p>trace slowly · follow a ring all the way around · loop once or twice</p>
        </div>
        <a href="/redraw/?mode=circles">watch the drawing →</a>
      </header>

      <div className="circle-guides" aria-hidden="true">
        {GUIDE_LAYOUT.map((guide, index) => (
          <div
            className="circle-guide"
            key={index}
            style={guide}
          />
        ))}
      </div>

      <svg className="local-trail" aria-hidden="true">
        <path ref={trailRef} />
      </svg>

      <footer>
        with the <em>we were online</em> extension installed, your cursor trail
        becomes part of the collective drawing
      </footer>
    </main>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<CircleDraw />);
