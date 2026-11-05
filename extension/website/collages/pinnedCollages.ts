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
// Their cursor colour isn't known yet, so a quiet one stands in.
const JCLAHOOT: CollageMaker = { name: "JCLaHoot", color: "#c9c2b8" };

/**
 * Until collages can be published to the gallery from the studio, the board
 * shows this hand-picked list. Add a share's id here to pin it up; a share
 * that has since been taken down simply drops off the board.
 */
export const PINNED_COLLAGES: readonly PinnedCollage[] = [
  { id: "TpNCMd88MOQVtAeRT9Lvlw", by: SPENCER },
  { id: "iLhZ4UrzUPxNCfM7vICBwA", by: SPENCER },
  // "you can see everything"
  { id: "Nrz8x6uOpGSKdmN2N9gLdA", by: SPENCER },
  // "Internet shrine"
  { id: "TTmQjpbr6KXvePqO7lEwpQ", by: JCLAHOOT },
  // "the way out"
  { id: "6K99LF2Gld4NBGL67CXdTg", by: SPENCER },
  // "construction"
  { id: "aXkOxC_W_o3LSzntBf8MAw", by: SPENCER },
];
