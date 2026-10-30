// ABOUTME: The shared collages pinned to the public gallery at /collages/, picked by hand for now.
// ABOUTME: Each entry is a share id from a viewer link (wewere.online/collage/?id=<id>) and who made it.

/** Who made a pinned collage: their name, and the cursor colour they browse with. */
export interface CollageMaker {
  name: string;
  color: string;
}

export interface PinnedCollage {
  id: string;
  by: CollageMaker;
}

const SPENCER: CollageMaker = { name: "spencer", color: "#ffae00" };

/**
 * Until collages can be published to the gallery from the studio, the board
 * shows this hand-picked list. Add a share's id here to pin it up; a share
 * that has since been taken down simply drops off the board.
 */
export const PINNED_COLLAGES: readonly PinnedCollage[] = [
  { id: "TpNCMd88MOQVtAeRT9Lvlw", by: SPENCER },
  { id: "iLhZ4UrzUPxNCfM7vICBwA", by: SPENCER },
];
