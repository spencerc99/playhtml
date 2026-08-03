// ABOUTME: Rasters completed click ripples onto one slowly fading canvas layer.
// ABOUTME: Keeps dense archive residue smooth without retaining thousands of SVG nodes.
import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import type { ClickEffect } from "../types";
import {
  getRippleTargetRadii,
  type RippleSettings,
} from "./ClickRipple";

const FADE_TICK_MS = 1000;
export const CLICK_RESIDUE_HALF_LIFE_MS = 5 * 60_000;

export function getResidueFadeAlpha(
  elapsedMs: number,
  halfLifeMs = CLICK_RESIDUE_HALF_LIFE_MS,
): number {
  if (elapsedMs <= 0 || halfLifeMs <= 0) return 0;
  return 1 - Math.pow(0.5, elapsedMs / halfLifeMs);
}

export interface ClickResidueCanvasHandle {
  add(effect: ClickEffect, settings: RippleSettings): void;
}

export const ClickResidueCanvas = forwardRef<ClickResidueCanvasHandle>(
  function ClickResidueCanvas(_props, forwardedRef) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useImperativeHandle(
      forwardedRef,
      () => ({
        add(effect, settings) {
          const canvas = canvasRef.current;
          const context = canvas?.getContext("2d");
          if (!canvas || !context) return;

          context.save();
          context.globalCompositeOperation = "multiply";
          context.globalAlpha = Math.max(0, settings.clickOpacity);
          context.strokeStyle = effect.color;
          context.lineWidth = settings.clickStrokeWidth;
          for (const radius of getRippleTargetRadii(effect, settings)) {
            context.beginPath();
            context.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
            context.stroke();
          }
          context.restore();
        },
      }),
      [],
    );

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const resize = () => {
        const ratio = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, Math.round(rect.width * ratio));
        canvas.height = Math.max(1, Math.round(rect.height * ratio));
        canvas.getContext("2d")?.setTransform(ratio, 0, 0, ratio, 0, 0);
      };

      resize();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }, []);

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      let previousFadeAt = performance.now();

      const fade = window.setInterval(() => {
        const context = canvas.getContext("2d");
        if (!context) return;
        const now = performance.now();
        const alpha = getResidueFadeAlpha(now - previousFadeAt);
        previousFadeAt = now;

        context.save();
        context.resetTransform();
        context.globalCompositeOperation = "destination-out";
        context.fillStyle = `rgba(0, 0, 0, ${alpha})`;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.restore();
      }, FADE_TICK_MS);

      return () => window.clearInterval(fade);
    }, []);

    return (
      <canvas
        ref={canvasRef}
        className="settled-clicks-canvas"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          mixBlendMode: "multiply",
        }}
      />
    );
  },
);
