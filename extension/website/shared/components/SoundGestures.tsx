// ABOUTME: The gathering specks and navigation knots, drawn as SVG inside the trail layer
// ABOUTME: Structure is rendered once; the parent rAF loop moves the elements imperatively

import React, { useCallback, useRef } from "react";
import {
  GATHERING_TUNING,
  KNOT_TUNING,
  SoundVisuals,
  type VisualConfig,
} from "../sound/soundVisuals";

/**
 * The most gathering specks and knot beads the layer can show at once.
 *
 * The elements are allocated once and reused rather than created and destroyed
 * as gestures come and go: an SVG layer that adds and removes nodes sixty
 * times a second spends its whole frame in layout. Anything past the cap is
 * simply not drawn, which is the same ceiling the gesture state itself keeps.
 */
const SPECK_POOL_SIZE =
  GATHERING_TUNING.maxConcurrent * GATHERING_TUNING.maxNotesPerGathering;
const KNOT_POOL_SIZE = 240;

export interface ImperativeSoundGesturesHandle {
  /**
   * Redraw every gesture for this frame.
   *
   * `nowMs` is the same playback clock the gestures were stamped with, and
   * `strokeWidth` is the trail line's current width, which the knot bead is
   * sized against so a mark on a trail always reads as part of that trail.
   * `colorOf` answers what colour a trail is drawn in, which the visuals do
   * not store — a bead outlives the trail that laid it, so the trails to draw
   * come from the visuals and only their colour is looked up. A trail no
   * longer in the scene answers null and its beads are skipped.
   */
  update(
    nowMs: number,
    strokeWidth: number,
    colorOf: (trailIndex: number) => string | null,
  ): void;
  hide(): void;
}

interface SoundGesturesProps {
  visuals: SoundVisuals;
  config: VisualConfig;
}

/**
 * The visible half of the sound, as SVG siblings of the trails themselves.
 *
 * Drawing here rather than on a canvas of its own is what lets a knot sit on
 * the real trail: it shares the layer's coordinate space and its viewBox, so a
 * cinematic camera move or a document-space scroll carries the beads with the
 * paths instead of leaving them behind.
 */
export const SoundGestures = React.forwardRef<
  ImperativeSoundGesturesHandle,
  SoundGesturesProps
>(({ visuals, config }, ref) => {
  const speckRefs = useRef<Array<SVGCircleElement | null>>([]);
  const knotBeadRefs = useRef<Array<SVGCircleElement | null>>([]);
  const knotRingRefs = useRef<Array<SVGCircleElement | null>>([]);
  const groupRef = useRef<SVGGElement>(null);

  const hide = useCallback(() => {
    for (const el of speckRefs.current) if (el) el.style.display = "none";
    for (const el of knotBeadRefs.current) if (el) el.style.display = "none";
    for (const el of knotRingRefs.current) if (el) el.style.display = "none";
  }, []);

  React.useImperativeHandle(
    ref,
    () => ({
      hide,
      update(nowMs, strokeWidth, colorOf) {
        const travelMs = GATHERING_TUNING.travelSeconds * 1000;

        let speckSlot = 0;
        if (config.gathering) {
          for (const gathering of visuals.getGatherings()) {
            for (const speck of gathering.specks) {
              if (speckSlot >= SPECK_POOL_SIZE) break;
              const progress = (nowMs - speck.startMs) / travelMs;
              if (progress < 0 || progress >= 1) continue;
              const el = speckRefs.current[speckSlot];
              if (!el) continue;
              // An arrival closes on the point; a departure opens away from it.
              const distance = gathering.rising ? 1 - progress : progress;
              el.style.display = "";
              el.setAttribute(
                "cx",
                String(gathering.x + speck.offsetX * distance),
              );
              el.setAttribute(
                "cy",
                String(gathering.y + speck.offsetY * distance),
              );
              el.setAttribute("fill", gathering.color);
              // Brightest mid-flight either way, so nothing pops in or out at
              // an edge.
              el.setAttribute(
                "opacity",
                String(
                  GATHERING_TUNING.peakAlpha * Math.sin(progress * Math.PI),
                ),
              );
              speckSlot++;
            }
          }
        }
        for (let i = speckSlot; i < SPECK_POOL_SIZE; i++) {
          const el = speckRefs.current[i];
          if (el && el.style.display !== "none") el.style.display = "none";
        }

        let knotSlot = 0;
        if (config.knot) {
          // The bead is sized off the trail's real stroke width rather than a
          // fixed pixel radius, so it stays proportionate however heavy the
          // line is drawn.
          const radius = strokeWidth * KNOT_TUNING.radiusStrokeMultiple;
          const ringMs = KNOT_TUNING.ringSeconds * 1000;
          for (const trailIndex of visuals.getKnottedTrails()) {
            const color = colorOf(trailIndex);
            if (color === null) continue;
            for (const knot of visuals.getKnots(trailIndex)) {
              if (knotSlot >= KNOT_POOL_SIZE) break;
              const bead = knotBeadRefs.current[knotSlot];
              const ring = knotRingRefs.current[knotSlot];
              if (!bead || !ring) continue;

              bead.style.display = "";
              bead.setAttribute("cx", String(knot.x));
              bead.setAttribute("cy", String(knot.y));
              bead.setAttribute("r", String(radius));
              bead.setAttribute("fill", color);
              bead.setAttribute("opacity", String(KNOT_TUNING.alpha));

              // The ring opens once as the bead forms — the one moment a knot
              // announces itself. The bead itself then persists silently.
              const ringProgress = (nowMs - knot.formedMs) / ringMs;
              if (ringProgress >= 0 && ringProgress < 1) {
                ring.style.display = "";
                ring.setAttribute("cx", String(knot.x));
                ring.setAttribute("cy", String(knot.y));
                ring.setAttribute(
                  "r",
                  String(
                    radius *
                      (1 +
                        ringProgress * (KNOT_TUNING.ringRadiusMultiple - 1)),
                  ),
                );
                ring.setAttribute("stroke", color);
                ring.setAttribute(
                  "opacity",
                  String(KNOT_TUNING.ringPeakAlpha * (1 - ringProgress)),
                );
              } else if (ring.style.display !== "none") {
                ring.style.display = "none";
              }
              knotSlot++;
            }
          }
        }
        for (let i = knotSlot; i < KNOT_POOL_SIZE; i++) {
          const bead = knotBeadRefs.current[i];
          const ring = knotRingRefs.current[i];
          if (bead && bead.style.display !== "none") bead.style.display = "none";
          if (ring && ring.style.display !== "none") ring.style.display = "none";
        }
      },
    }),
    [config.gathering, config.knot, hide, visuals],
  );

  return (
    <g ref={groupRef} style={{ pointerEvents: "none" }}>
      {Array.from({ length: KNOT_POOL_SIZE }, (_, i) => (
        <circle
          key={`knot-bead-${i}`}
          ref={(el) => {
            knotBeadRefs.current[i] = el;
          }}
          style={{ display: "none" }}
        />
      ))}
      {Array.from({ length: KNOT_POOL_SIZE }, (_, i) => (
        <circle
          key={`knot-ring-${i}`}
          ref={(el) => {
            knotRingRefs.current[i] = el;
          }}
          fill="none"
          strokeWidth={1}
          style={{ display: "none" }}
        />
      ))}
      {Array.from({ length: SPECK_POOL_SIZE }, (_, i) => (
        <circle
          key={`speck-${i}`}
          ref={(el) => {
            speckRefs.current[i] = el;
          }}
          r={GATHERING_TUNING.speckRadiusPx}
          style={{ display: "none" }}
        />
      ))}
    </g>
  );
});
