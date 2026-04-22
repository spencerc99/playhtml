import React from "react";
import { CanMoveElement } from "@playhtml/react";

const MOVE_ARENA_ID = "ph-cap-move-arena";

/** Yankees hat + long cat — draggable inside the arena. */
export function MoveHatCatDemo(): React.ReactElement {
  const hatSrc = "/docs/yankees-hat.png";
  const catSrc = "/docs/long-cat.png";

  return (
    <div id={MOVE_ARENA_ID} className="ph-move-arena" aria-label="Drag the hat and cat">
      <CanMoveElement standalone bounds={MOVE_ARENA_ID}>
        <div
          id="ph-cap-hat"
          className="ph-move-piece ph-move-piece--img"
        >
          <img src={hatSrc} alt="" className="ph-move-piece__img" draggable={false} />
        </div>
      </CanMoveElement>
      <CanMoveElement standalone bounds={MOVE_ARENA_ID}>
        <div
          id="ph-cap-cat"
          className="ph-move-piece ph-move-piece--img ph-move-piece--cat"
        >
          <img src={catSrc} alt="" className="ph-move-piece__img" draggable={false} />
        </div>
      </CanMoveElement>
    </div>
  );
}
