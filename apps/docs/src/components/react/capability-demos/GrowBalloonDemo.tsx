// Docs live demo for can-grow: click to inflate, Alt-click to deflate.
import React from "react";
import { CanGrowElement } from "@playhtml/react";

export function GrowBalloonDemo(): React.ReactElement {
  return (
    <div className="ph-grow-balloon-wrap">
      <p className="ph-grow-balloon__hint">click · alt+click to shrink</p>
      {/* Only the balloon scales; the hint above stays put. */}
      <CanGrowElement standalone>
        <div
          id="ph-cap-balloon"
          className="ph-grow-balloon"
          role="img"
          aria-label="Water balloon"
        >
          <img
            src="/docs/water-balloon.png"
            alt=""
            className="ph-grow-balloon__img"
            draggable={false}
          />
        </div>
      </CanGrowElement>
    </div>
  );
}
