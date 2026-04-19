import React from "react";
import { CanPlayElement } from "@playhtml/react";
import { TagType, TagTypeToElement } from "@playhtml/common";

/** Drag horizontally to spin — shared rotation. */
export function SpinWheelDemo(): React.ReactElement {
  const src = "/docs/bike-wheel.webp";

  return (
    <CanPlayElement
      standalone
      tagInfo={[TagType.CanSpin]}
      {...TagTypeToElement[TagType.CanSpin]}
      id="ph-cap-wheel"
      defaultData={{ rotation: 0 }}
    >
      {() => (
        <div
          id="ph-cap-wheel"
          className="ph-spin-wheel"
          aria-label="Bicycle wheel — drag to spin"
        >
          <img src={src} alt="" className="ph-spin-wheel__img" draggable={false} />
        </div>
      )}
    </CanPlayElement>
  );
}
