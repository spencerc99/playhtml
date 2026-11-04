// ABOUTME: A dev-build panel for tuning how the collage back is printed, live on the open collage.
// ABOUTME: Sliders for the card, the show-through and the maker's mark, plus a copy of the values.

import { useState } from "react";
import { BACK_LOOK, type BackLook } from "./collageBack";

interface BackLookTunerProps {
  look: BackLook;
  onLook: (look: BackLook) => void;
}

interface Slider {
  key: "bleedOpacity" | "bleedBlur" | "markOpacity" | "markSize";
  label: string;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: Slider[] = [
  { key: "bleedOpacity", label: "collage through", min: 0, max: 1, step: 0.01 },
  { key: "bleedBlur", label: "collage blur", min: 0, max: 12, step: 0.5 },
  { key: "markOpacity", label: "logo strength", min: 0, max: 1, step: 0.01 },
  { key: "markSize", label: "logo size", min: 20, max: 120, step: 1 },
];

const CARD_SWATCHES = ["#faf7f2", "#fffdf9", "#f5f0e8", "#ffffff", "#ece4d6"];

export function BackLookTuner({ look, onLook }: BackLookTunerProps) {
  const [copied, setCopied] = useState(false);
  const set = (patch: Partial<BackLook>) => onLook({ ...look, ...patch });

  return (
    <div
      className="back-look-tuner"
      style={{
        position: "fixed",
        right: 16,
        bottom: 64,
        zIndex: 50,
        width: 260,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "rgba(250, 247, 242, 0.96)",
        border: "1px solid rgba(61, 56, 51, 0.2)",
        borderRadius: 6,
        boxShadow: "0 6px 24px rgba(61, 56, 51, 0.16)",
        font: "11px/1.3 'Martian Mono', ui-monospace, monospace",
        color: "#3d3833",
      }}
    >
      <strong style={{ fontWeight: 600 }}>back look · dev</strong>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span>card {look.cardColor}</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="color"
            value={look.cardColor}
            onChange={(event) => set({ cardColor: event.target.value })}
            style={{ width: 32, height: 22, padding: 0, border: 0 }}
          />
          {CARD_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              title={color}
              onClick={() => set({ cardColor: color })}
              style={{
                width: 18,
                height: 18,
                padding: 0,
                background: color,
                border:
                  color === look.cardColor
                    ? "2px solid #3d3833"
                    : "1px solid rgba(61, 56, 51, 0.3)",
                borderRadius: 3,
                cursor: "pointer",
              }}
            />
          ))}
        </span>
      </label>

      {SLIDERS.map((slider) => (
        <label
          key={slider.key}
          style={{ display: "flex", flexDirection: "column", gap: 2 }}
        >
          <span>
            {slider.label} {look[slider.key]}
          </span>
          <input
            type="range"
            min={slider.min}
            max={slider.max}
            step={slider.step}
            value={look[slider.key]}
            onChange={(event) =>
              set({ [slider.key]: Number(event.target.value) })
            }
          />
        </label>
      ))}

      <span style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(JSON.stringify(look, null, 2))
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              });
          }}
        >
          {copied ? "copied" : "copy values"}
        </button>
        <button type="button" onClick={() => onLook(BACK_LOOK)}>
          reset
        </button>
      </span>
    </div>
  );
}
