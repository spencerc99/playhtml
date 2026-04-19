import React from "react";
import { CanPlayElement } from "@playhtml/react";
import { CanMoveBounds, TagType, TagTypeToElement } from "@playhtml/common";

const MOVE_ARENA_ID = "ph-cap-move-arena";

/** Yankees hat + long cat — draggable inside the arena. */
export function MoveHatCatDemo(): React.ReactElement {
  const hatSrc = "/docs/yankees-hat.png";
  const catSrc = "/docs/long-cat.png";

  return (
    <div id={MOVE_ARENA_ID} className="ph-move-arena" aria-label="Drag the hat and cat">
      <CanPlayElement
        standalone
        tagInfo={[TagType.CanMove]}
        {...TagTypeToElement[TagType.CanMove]}
        id="ph-cap-hat"
        defaultData={{ x: 16, y: 14 }}
      >
        {() => (
          <div
            id="ph-cap-hat"
            className="ph-move-piece ph-move-piece--img"
            {...{ [CanMoveBounds]: MOVE_ARENA_ID }}
          >
            <img src={hatSrc} alt="" className="ph-move-piece__img" draggable={false} />
          </div>
        )}
      </CanPlayElement>
      <CanPlayElement
        standalone
        tagInfo={[TagType.CanMove]}
        {...TagTypeToElement[TagType.CanMove]}
        id="ph-cap-cat"
        defaultData={{ x: 108, y: 44 }}
      >
        {() => (
          <div
            id="ph-cap-cat"
            className="ph-move-piece ph-move-piece--img ph-move-piece--cat"
            {...{ [CanMoveBounds]: MOVE_ARENA_ID }}
          >
            <img src={catSrc} alt="" className="ph-move-piece__img" draggable={false} />
          </div>
        )}
      </CanPlayElement>
    </div>
  );
}
