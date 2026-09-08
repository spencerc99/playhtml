// ABOUTME: The browse-to-participate page for we were online installation machines.
// ABOUTME: Explains the piece, traces the visitor's cursor as a demonstration, and offers places to start.

import "./participate.scss";
import React, { useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";

/** Matches the installation frame's trail: solid at the cursor, gone after this. */
const TRAIL_MS = 9000;

const STARTING_POINTS: { label: string; detail: string; href: string }[] = [
  {
    label: "a random article",
    detail: "wikipedia",
    href: "https://en.wikipedia.org/wiki/Special:Random",
  },
  {
    label: "are.na",
    detail: "collections of things people found",
    href: "https://www.are.na",
  },
  {
    label: "the live portrait",
    detail: "everyone browsing right now",
    href: "/portrait/",
  },
  {
    label: "wewere.online",
    detail: "the project this room belongs to",
    href: "/",
  },
];

/** Draws the visitor's own cursor path, the same way the frame does while browsing. */
function useCursorTrace() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    let points: { x: number; y: number; t: number }[] = [];
    let frame = 0;

    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(window.innerWidth * ratio);
      canvas.height = Math.round(window.innerHeight * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const draw = () => {
      frame = 0;
      const now = Date.now();
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      points = points.filter((point) => now - point.t < TRAIL_MS);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.strokeStyle = "#c2410c";
      for (let index = 1; index < points.length; index += 1) {
        // Capped so the demonstration line never fights the copy underneath.
        const alpha = 0.55 * (1 - (now - points[index].t) / TRAIL_MS);
        if (alpha <= 0.01) continue;
        context.globalAlpha = alpha;
        context.lineWidth = 1.5 + alpha * 2.5;
        context.beginPath();
        context.moveTo(points[index - 1].x, points[index - 1].y);
        context.lineTo(points[index].x, points[index].y);
        context.stroke();
      }
      context.globalAlpha = 1;
      if (points.length > 0) schedule();
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(draw);
    };

    const move = (event: PointerEvent) => {
      points.push({ x: event.clientX, y: event.clientY, t: Date.now() });
      if (points.length > 1200) points = points.slice(-1200);
      schedule();
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", move);
    };
  }, []);

  return canvasRef;
}

const Participate = () => {
  const canvasRef = useCursorTrace();

  return (
    <>
      <canvas ref={canvasRef} className="trace" aria-hidden="true" />
      <main>
        <p className="wordmark">we were online</p>
        <h1>browse to participate</h1>
        <p className="lead">
          This computer is part of the piece. Browse anywhere you like — your
          cursor draws itself as it moves, and the marks you make join the
          portraits on the screens around you.
        </p>
        <p className="hint">
          Move the mouse: that line following you is what the screens see.
        </p>

        <ol className="steps">
          <li>
            <span className="step-number">1</span>
            <span>
              <b>Go somewhere.</b> Anywhere you'd actually go — an article, a
              shop, a video, your own corner of the internet.
            </span>
          </li>
          <li>
            <span className="step-number">2</span>
            <span>
              <b>Browse like you normally would.</b> Scroll, click, wander,
              double back. The wandering is the drawing.
            </span>
          </li>
          <li>
            <span className="step-number">3</span>
            <span>
              <b>Look up.</b> Your line is out there with everyone else's, in
              the color of the cursor on this machine.
            </span>
          </li>
        </ol>

        <section className="starts">
          <h2>start somewhere</h2>
          <ul>
            {STARTING_POINTS.map((point) => (
              <li key={point.href}>
                <a href={point.href}>
                  <span className="start-label">{point.label}</span>
                  <span className="start-detail">{point.detail}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <footer>
          <p>
            Recorded as marks: cursor movement, clicks, scrolling, the pages
            visited, and typing rhythm in text boxes — characters are masked.
            Nothing identifies you. <a href="/privacy.html">Full details</a>.
          </p>
          <p>
            <em>we were online</em> is a project by{" "}
            <a href="https://spencer.place">Spencer Chang</a>. Take it home:{" "}
            <a href="/">wewere.online</a>.
          </p>
        </footer>
      </main>
    </>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<Participate />);
