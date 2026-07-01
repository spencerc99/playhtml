// ABOUTME: Persistent visit counter example built with withSharedState.
// ABOUTME: Increments the shared view count after initial playhtml sync.

import { useContext, useEffect } from "react";
import { PlayContext, withSharedState } from "@playhtml/react";

export const ViewCount = withSharedState(
  { defaultData: { count: 0 }, id: "viewCount" },
  ({ data, setData }) => {
    const { hasSynced } = useContext(PlayContext);
    useEffect(() => {
      if (!hasSynced) {
        return;
      }

      setData((draft) => {
        draft.count += 1;
      });
    }, [hasSynced]);
    return <div id="viewCount">{data.count}</div>;
  }
);
