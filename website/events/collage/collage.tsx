// ABOUTME: A throwaway event page: one shared collage table made from everyone's recent scraps.
// ABOUTME: The walking-together collage table on its own, offering scraps from anywhere in the last 12 hours.
import ReactDOM from "react-dom";
import React from "react";
import { PlayProvider, usePageData, usePresence } from "@playhtml/react";
import { CollageTable } from "../walking-together/collage/CollageTable";
import type {
  CollageData,
  CollageLive,
} from "../walking-together/collage/pieces";

const COLLAGE_DATA_NAME = "collage-together";
const DRAG_PRESENCE_CHANNEL = "collage-together-drag";
/** The released extension only looks back 12 hours, so ask for all of it. */
const SCRAPS_WINDOW_MS = 12 * 60 * 60_000;

const EMPTY_COLLAGE: CollageData = {
  pieces: {},
  templatePoints: {},
  locked: false,
};

function Collage() {
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

  return (
    <div className="collage-stage">
      <CollageTable
        data={data}
        setData={setData}
        peers={peers}
        setLive={setMyPresence}
        scrapsWindowMs={SCRAPS_WINDOW_MS}
        emptyHints={{
          noExtension:
            "open this page with we were online to bring your scraps",
          withScraps:
            "pick scraps from the last 12 hours on the left to place them here",
        }}
      />
    </div>
  );
}

ReactDOM.render(
  <PlayProvider
    initOptions={{ cursors: { enabled: true, coordinateMode: "relative" } }}
  >
    <Collage />
  </PlayProvider>,
  document.getElementById("react"),
);
