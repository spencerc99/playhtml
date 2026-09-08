// ABOUTME: Hosts the click drawing surface and follows its display size.
// ABOUTME: Keeps ripple completion ticking while hidden without drawing hidden frames.
import { memo, useEffect, useRef } from "react";
import type { RippleSettings } from "./ClickRipple";
import type { VisibleClickEffect } from "./clickResidue";
import { ClickCanvasRenderer } from "./clickCanvasRenderer";

export const ClickCanvas = memo(function ClickCanvas({
  effects,
  settings,
  onComplete,
}: {
  effects: VisibleClickEffect[];
  settings: RippleSettings;
  onComplete: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ClickCanvasRenderer>();
  const tickRef = useRef<() => void>();
  const completeRef = useRef(onComplete);
  useEffect(() => {
    completeRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new ClickCanvasRenderer(canvas, (id) =>
      completeRef.current(id),
    );
    rendererRef.current = renderer;
    let frame: number | undefined;
    let timeout: number | undefined;
    const cancel = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (timeout !== undefined) window.clearTimeout(timeout);
      frame = timeout = undefined;
    };
    const tick = () => {
      cancel();
      const visible = document.visibilityState !== "hidden";
      renderer.tick(Date.now(), visible);
      if (!renderer.needsFrame) return;
      if (visible) frame = requestAnimationFrame(tick);
      else timeout = window.setTimeout(tick, 100);
    };
    const resize = () => {
      renderer.resize(
        canvas.clientWidth,
        canvas.clientHeight,
        window.devicePixelRatio,
      );
      tick();
    };
    tickRef.current = tick;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", tick);
    resize();
    tick();
    return () => {
      cancel();
      observer.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", tick);
      renderer.destroy();
      rendererRef.current = undefined;
      tickRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.update(effects, settings, Date.now());
    tickRef.current?.();
  }, [effects, settings]);

  return (
    <canvas
      ref={canvasRef}
      className="animated-clicks-canvas"
      aria-hidden="true"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    />
  );
});
