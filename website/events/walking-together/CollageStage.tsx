// ABOUTME: The collage stage of a walking-together session, shown after the walk.
// ABOUTME: Everyone places their collected scraps onto one shared table collage.
import React from "react";
import { usePageData, usePresence } from "@playhtml/react";
import { CollageTable } from "./collage/CollageTable";
import type { CollageData, CollageLive } from "./collage/pieces";

// The collage belongs to the whole page, not to one element, so it lives in
// a page data channel. In-progress drags are presence: live, never persisted.
const COLLAGE_DATA_NAME = "walking-together-collage";
const DRAG_PRESENCE_CHANNEL = "walking-together-collage-drag";

const EMPTY_COLLAGE: CollageData = {
  pieces: {},
  templatePoints: {},
  locked: false,
};

/** Shared collage built from everyone's scraps. The room switches here when
 * the admin moves the session from the walk stage to the collage stage.
 *
 * Mounted from page load (not only once the stage flips) so the collage
 * channel opens while people trickle in. If everyone opened it at the same
 * moment, each client would seed its own copy of the missing data and the
 * clients whose copy lost the merge would stop seeing updates. */
export function CollageStage({ active }: { active: boolean }) {
  const [data, setData] = usePageData<CollageData>(
    COLLAGE_DATA_NAME,
    EMPTY_COLLAGE,
  );
  const { presences, setMyPresence } = usePresence<
    typeof DRAG_PRESENCE_CHANNEL,
    CollageLive
  >(DRAG_PRESENCE_CHANNEL);

  const peers = Array.from(presences.values()).map((view) => ({
    user: { isMe: view.isMe },
    live: view[DRAG_PRESENCE_CHANNEL],
  }));

  if (!active) return null;

  return (
    <div className="collage-stage">
      <CollageTable
        data={data}
        setData={setData}
        peers={peers}
        setLive={setMyPresence}
      />
    </div>
  );
}
