// Docs live demo for can-spin: drag sideways to turn the wheel for everyone.
import React from "react";
import { CanSpinElement } from "@playhtml/react";

export function SpinWheelDemo(): React.ReactElement {
  return (
    <CanSpinElement standalone>
      <div
        id="ph-cap-wheel"
        className="ph-spin-wheel"
        aria-label="Bicycle wheel — drag to spin"
      >
        <img
          src="/docs/bike-wheel.webp"
          alt=""
          className="ph-spin-wheel__img"
          draggable={false}
        />
      </div>
    </CanSpinElement>
  );
}
