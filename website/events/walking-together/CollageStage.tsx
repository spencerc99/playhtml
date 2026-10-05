// ABOUTME: The collage stage of a walking-together session, shown after the walk.
// ABOUTME: Everyone places their collected scraps onto one shared table collage.
import React from "react";
import { withSharedState } from "@playhtml/react";
import { CollageTable } from "./collage/CollageTable";
import type { CollageData, CollageLive } from "./collage/pieces";

// Explicit stable element id so every client syncs the same store instead of
// one derived from the rendered markup.
const COLLAGE_ID = "walking-together-collage";

/** Shared collage built from everyone's scraps. The room switches here when
 * the admin moves the session from the walk stage to the collage stage.
 * The shared element stays registered while inactive; only the table (and
 * its page-wide paste listener) is left out until the collage stage. */
export const CollageStage = withSharedState<
  CollageData,
  CollageLive,
  { active: boolean }
>(
  {
    defaultData: { pieces: {}, templatePoints: {}, locked: false },
    live: { drag: null },
  },
  ({ data, setData, users, setLive }, { active }) => (
    <div className="collage-stage" id={COLLAGE_ID} hidden={!active}>
      {active && (
        <CollageTable
          data={data}
          setData={setData}
          users={users}
          setLive={setLive}
        />
      )}
    </div>
  ),
);
