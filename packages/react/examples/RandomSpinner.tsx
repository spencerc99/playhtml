import React, { useEffect, useMemo, useRef, useState } from "react";
import { withSharedState } from "@playhtml/react";

type PickerData = {
  spin: {
    seed: number;
    startTimeMs: number;
    durationMs: number;
    rotations: number;
    targetIndex: number;
  } | null;
};

interface RandomSpinnerProps {
  options: string[];
  colors?: string[]; // Optional array of colors for each option
}

function seededRandom(seed: number): number {
  // Mulberry32
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const RandomSpinner = withSharedState<
  PickerData,
  any,
  RandomSpinnerProps
>({ defaultData: { spin: null } }, ({ data, setData }, { options, colors }) => {
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const rafRef = useRef<number | null>(null);

  const anglePer = options.length > 0 ? 360 / options.length : 0;

  const { angleDeg, progress, winnerIndex } = useMemo(() => {
    const spin = data.spin;
    if (!spin || options.length === 0) {
      return {
        angleDeg: 0,
        progress: 0,
        winnerIndex: undefined as number | undefined,
      };
    }
    const { startTimeMs, durationMs, rotations, targetIndex } = spin;
    const elapsed = Math.max(0, nowMs - startTimeMs);
    const t = Math.min(1, durationMs <= 0 ? 1 : elapsed / durationMs);
    const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
    const eased = easeOutCubic(t);
    const finalRotation = rotations * 360 - (targetIndex + 0.5) * anglePer;
    const angle = 0 + finalRotation * eased;
    return { angleDeg: angle, progress: t, winnerIndex: targetIndex };
  }, [data.spin, nowMs, options.length, anglePer]);

  useEffect(() => {
    if (!data.spin) return;
    const tick = () => {
      setNowMs(Date.now());
      rafRef.current = requestAnimationFrame(tick);
    };
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [data.spin]);

  const spin = () => {
    if (options.length === 0) return;
    const seed = Date.now();
    const r = seededRandom(seed);
    const index = Math.floor(r * options.length);
    const durationMs = 3500;
    const rotations = 6; // full turns before landing
    const startTimeMs = Date.now();
    setData({
      spin: { seed, startTimeMs, durationMs, rotations, targetIndex: index },
    });
  };

  const currentIndex = useMemo(() => {
    if (options.length === 0) return undefined as number | undefined;
    // Convert current angle to a pointer index; pointer at 0deg (top)
    const normalized = ((-angleDeg % 360) + 360) % 360;
    const idx = Math.floor(normalized / anglePer);
    return Math.min(options.length - 1, Math.max(0, idx));
  }, [angleDeg, anglePer, options.length]);

  const winnerLabel =
    progress >= 1 && winnerIndex !== undefined
      ? options[winnerIndex]
      : undefined;
  const changingLabel =
    progress > 0 && progress < 1 && currentIndex !== undefined
      ? options[currentIndex]
      : undefined;

  const size = 260;
  const radius = size / 2;

  return (
    <div style={{ maxWidth: size, marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <button
          onClick={spin}
          disabled={options.length === 0 || (data.spin != null && progress < 1)}
        >
          {progress > 0 && progress < 1 ? "Spinning..." : "Spin 🎡"}
        </button>
        {winnerLabel ? (
          <div>
            Winner: <b>{winnerLabel}</b>
          </div>
        ) : changingLabel ? (
          <div>
            Landing on: <b>{changingLabel}</b>
          </div>
        ) : (
          <div>—</div>
        )}
      </div>

      <div style={{ position: "relative", width: size, height: size }}>
        {/* Pointer - pointing towards center */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: radius - 8,
            width: 0,
            height: 0,
            borderLeft: "8px solid transparent",
            borderRight: "8px solid transparent",
            borderTop: "12px solid #333",
            zIndex: 2,
          }}
        />
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <g transform={`translate(${radius} ${radius}) rotate(${angleDeg})`}>
            {options.map((label, i) => {
              const startAngle = (i * 360) / options.length;
              const endAngle = ((i + 1) * 360) / options.length;
              const largeArc = endAngle - startAngle > 180 ? 1 : 0;
              const start = polarToCartesian(radius, startAngle);
              const end = polarToCartesian(radius, endAngle);
              const pathData = [
                `M 0 0`,
                `L ${start.x} ${start.y}`,
                `A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`,
                `Z`,
              ].join(" ");
              // Use custom colors if provided, otherwise default colors
              const fill =
                colors && colors[i]
                  ? colors[i]
                  : i % 2 === 0
                  ? "#fbd38d"
                  : "#f6ad55";
              const midAngle = (startAngle + endAngle) / 2;
              const textPos = polarToCartesian(radius * 0.65, midAngle);
              return (
                <g key={`${i}-${label}`}>
                  <path
                    d={pathData}
                    fill={fill}
                    stroke="#fff"
                    strokeWidth={1}
                  />
                  <text
                    x={textPos.x}
                    y={textPos.y}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    style={{ fontSize: 20, fill: "#333" }}
                    transform={`rotate(${midAngle}, ${textPos.x}, ${textPos.y})`}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
          <circle
            cx={radius}
            cy={radius}
            r={radius}
            fill="none"
            stroke="#333"
            strokeWidth={2}
          />
        </svg>
      </div>
    </div>
  );
});

function polarToCartesian(
  r: number,
  angleDeg: number
): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: r * Math.sin(rad), y: -r * Math.cos(rad) };
}
