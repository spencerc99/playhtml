import React from "react";
import { withSharedState } from "@playhtml/react";

type SliderData = { value: number };

interface SharedSliderProps {
  min?: number;
  max?: number;
  step?: number;
  label?: string;
}

export const SharedSlider = withSharedState<SliderData, any, SharedSliderProps>(
  ({ min = 0, max = 100 }) => ({
    defaultData: { value: Math.round((min + max) / 2) },
  }),
  ({ data, setData }, { min = 0, max = 100, step = 1, label }) => {
    return (
      <div
        id="shared-slider"
        style={{ display: "inline-flex", gap: 8, alignItems: "center" }}
      >
        {label && <label>{label}</label>}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={data.value}
          onChange={(e) => setData({ value: Number(e.target.value) })}
        />
        <span style={{ width: 40, textAlign: "right" }}>{data.value}</span>
      </div>
    );
  }
);
