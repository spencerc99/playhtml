// ABOUTME: The collage stage of a walking-together session, shown after the walk.
// ABOUTME: Everyone places their collected scraps onto one shared table collage.
import React from "react";
import { usePageData, usePeople } from "@playhtml/react";
import { CollageTable } from "./collage/CollageTable";
import type { CollageData, CollagePresence } from "./collage/pieces";

// The collage belongs to the whole page, not to one element, so it lives in
// a page data channel. In-progress drags are presence: live, never saved.
const COLLAGE_DATA_NAME = "walking-together-collage";
const DRAG_PRESENCE_KEY = "walking-together-collage-drag";

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
  const { everyone, setMyPresence } = usePeople(DRAG_PRESENCE_KEY);

  const peers = everyone.map((person) => ({
    isMe: person.isMe,
    presence: person.presence[DRAG_PRESENCE_KEY] as
      | Partial<CollagePresence>
      | undefined,
  }));

  if (!active) return null;

  return (
    <div className="collage-stage">
      <CollageTable
        data={data}
        setData={setData}
        peers={peers}
        setMyDraft={(draft) => setMyPresence(DRAG_PRESENCE_KEY, draft)}
      />
    </div>
  );
}
