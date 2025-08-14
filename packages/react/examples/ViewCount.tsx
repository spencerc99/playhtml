import React, { useContext, useEffect } from "react";
import { PlayContext, withSharedState } from "@playhtml/react";

interface Props {}

export const ViewCount = withSharedState(
  { defaultData: { count: 0 }, id: "viewCount" },
  ({ data, setData }, props) => {
    const { hasSynced } = useContext(PlayContext);
    useEffect(() => {
      if (!hasSynced) {
        return;
      }

      setData({ count: data.count + 1 });
    }, [hasSynced]);
    return (
      <div
        id="viewCount"
        style={{
          width: "200px",
          border: "1px solid black",
          background: "lightgray",
        }}
      >
        {data.count}
      </div>
    );
  }
);
