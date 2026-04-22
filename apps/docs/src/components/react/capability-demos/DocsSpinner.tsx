import React, { useEffect, useMemo, useRef, useState } from "react";
import { withSharedState } from "@playhtml/react";

// Prize labels + their destinations. Order is locked because targetIndex is
// persisted in the shared spin payload; reordering would make old spin data
// land on the wrong label.
const SEGMENTS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Toggle a lamp", href: "/docs/capabilities/#can-toggle" },
  { label: "Drag a hat", href: "/docs/capabilities/#can-move" },
  { label: "See cursors", href: "/docs/data/presence/cursors/" },
  { label: "Summon rain", href: "/docs/data/events/" },
  { label: "Shape data", href: "/docs/data/data-essentials/" },
  { label: "Write React", href: "/docs/using-react/" },
];

type SpinnerData = {
  spin: {
    seed: number;
    startTimeMs: number;
    durationMs: number;
    rotations: number;
    targetIndex: number;
  } | null;
};

// Mulberry32 — deterministic, so every visitor resolves the same target from
// the synced seed even if their clock drifts from the originator's.
function seededRandom(seed: number): number {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function polarToCartesian(r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: r * Math.sin(rad), y: -r * Math.cos(rad) };
}

const SIZE = 232;
const RADIUS = SIZE / 2;
const ANGLE_PER = 360 / SEGMENTS.length;
const SPIN_DURATION_MS = 3600;
const SPIN_ROTATIONS = 6;

const DocsSpinnerInner = withSharedState<SpinnerData, unknown, Record<string, never>>(
  { defaultData: { spin: null }, id: "ph-cap-docs-spinner" },
  ({ data, setData }) => {
    const [nowMs, setNowMs] = useState<number>(() => Date.now());
    const rafRef = useRef<number | null>(null);

    const { angleDeg, progress, targetIndex } = useMemo(() => {
      const spin = data.spin;
      if (!spin) {
        return { angleDeg: 0, progress: 0, targetIndex: undefined as number | undefined };
      }
      const elapsed = Math.max(0, nowMs - spin.startTimeMs);
      const t = Math.min(1, spin.durationMs <= 0 ? 1 : elapsed / spin.durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const finalRotation =
        spin.rotations * 360 - (spin.targetIndex + 0.5) * ANGLE_PER;
      return {
        angleDeg: finalRotation * eased,
        progress: t,
        targetIndex: spin.targetIndex,
      };
    }, [data.spin, nowMs]);

    const isSpinning = data.spin != null && progress < 1;

    useEffect(() => {
      if (!isSpinning) {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        return;
      }
      const tick = () => {
        setNowMs(Date.now());
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return () => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      };
    }, [isSpinning]);

    const currentIndex = useMemo<number | undefined>(() => {
      if (!data.spin) return undefined;
      const normalized = ((-angleDeg % 360) + 360) % 360;
      const idx = Math.floor(normalized / ANGLE_PER);
      return Math.min(SEGMENTS.length - 1, Math.max(0, idx));
    }, [angleDeg, data.spin]);

    const landedSegment =
      progress >= 1 && targetIndex !== undefined ? SEGMENTS[targetIndex] : undefined;
    const hoverSegment =
      progress > 0 && progress < 1 && currentIndex !== undefined
        ? SEGMENTS[currentIndex]
        : undefined;

    const handleSpin = () => {
      const seed = Date.now();
      const index = Math.floor(seededRandom(seed) * SEGMENTS.length);
      setData({
        spin: {
          seed,
          startTimeMs: Date.now(),
          durationMs: SPIN_DURATION_MS,
          rotations: SPIN_ROTATIONS,
          targetIndex: index,
        },
      });
    };

    return (
      <div className="ph-docs-spinner">
        <div className="ph-docs-spinner__stage">
          <div className="ph-docs-spinner__pointer" aria-hidden="true" />
          <svg
            className="ph-docs-spinner__svg"
            width={SIZE}
            height={SIZE}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            aria-label="Docs prize wheel — click Spin to pick a page"
            role="img"
          >
            <g transform={`translate(${RADIUS} ${RADIUS}) rotate(${angleDeg})`}>
              {SEGMENTS.map((seg, i) => {
                const startAngle = i * ANGLE_PER;
                const endAngle = (i + 1) * ANGLE_PER;
                const largeArc = endAngle - startAngle > 180 ? 1 : 0;
                const start = polarToCartesian(RADIUS - 1, startAngle);
                const end = polarToCartesian(RADIUS - 1, endAngle);
                const pathData = [
                  `M 0 0`,
                  `L ${start.x} ${start.y}`,
                  `A ${RADIUS - 1} ${RADIUS - 1} 0 ${largeArc} 1 ${end.x} ${end.y}`,
                  `Z`,
                ].join(" ");
                const midAngle = (startAngle + endAngle) / 2;
                const textPos = polarToCartesian(RADIUS * 0.6, midAngle);
                // Orient text radially outward from center. Flip the lower
                // half (where naive rotation would read upside-down) by
                // rotating an extra 180° around the text's own anchor.
                let textRotation = midAngle - 90;
                if (textRotation > 90) textRotation -= 180;
                if (textRotation < -90) textRotation += 180;
                const sliceCls =
                  i % 2 === 0
                    ? "ph-docs-spinner__slice ph-docs-spinner__slice--even"
                    : "ph-docs-spinner__slice ph-docs-spinner__slice--odd";
                return (
                  <g key={`${i}-${seg.label}`}>
                    <path d={pathData} className={sliceCls} />
                    <text
                      x={textPos.x}
                      y={textPos.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      className="ph-docs-spinner__label"
                      transform={`rotate(${textRotation}, ${textPos.x}, ${textPos.y})`}
                    >
                      {seg.label}
                    </text>
                  </g>
                );
              })}
            </g>
            <circle
              cx={RADIUS}
              cy={RADIUS}
              r={RADIUS - 1}
              className="ph-docs-spinner__ring"
            />
            <circle
              cx={RADIUS}
              cy={RADIUS}
              r={10}
              className="ph-docs-spinner__hub"
            />
          </svg>
        </div>

        <div className="ph-docs-spinner__controls">
          <button
            type="button"
            className="ph-docs-spinner__button"
            onClick={handleSpin}
            disabled={isSpinning}
          >
            {isSpinning ? "Spinning…" : landedSegment ? "Spin again" : "Spin"}
          </button>
        </div>

        <div
          className="ph-docs-spinner__result"
          aria-live="polite"
          aria-atomic="true"
        >
          {landedSegment ? (
            <>
              <span className="ph-docs-spinner__result-label">Landed on</span>
              <a
                className="ph-docs-spinner__link"
                href={landedSegment.href}
              >
                {landedSegment.label} →
              </a>
            </>
          ) : hoverSegment ? (
            <>
              <span className="ph-docs-spinner__result-label">Landing on</span>
              <span className="ph-docs-spinner__pending">{hoverSegment.label}</span>
            </>
          ) : (
            <span className="ph-docs-spinner__hint">
              spin to pick a doc page
            </span>
          )}
        </div>
      </div>
    );
  },
  { standalone: true },
);

/** Docs-themed synced prize wheel — every visitor sees the same spin land on the same doc link. */
export function DocsSpinner(): React.ReactElement {
  return <DocsSpinnerInner />;
}
