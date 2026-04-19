import React from "react";
import { CanPlayElement } from "@playhtml/react";
import { TagType, TagTypeToElement } from "@playhtml/common";

/** Click to inflate, Alt-click to deflate — only the balloon scales; hint stays fixed. */
export function GrowBalloonDemo(): React.ReactElement {
  const src = "/docs/water-balloon.png";

  return (
    <div className="ph-grow-balloon-wrap">
      <p className="ph-grow-balloon__hint">click · alt+click to shrink</p>
      <CanPlayElement
        standalone
        tagInfo={[TagType.CanGrow]}
        {...TagTypeToElement[TagType.CanGrow]}
        id="ph-cap-balloon"
        defaultData={{ scale: 1 }}
      >
        {() => (
          <div id="ph-cap-balloon" className="ph-grow-balloon" role="img" aria-label="Water balloon">
            <img src={src} alt="" className="ph-grow-balloon__img" draggable={false} />
          </div>
        )}
      </CanPlayElement>
    </div>
  );
}
