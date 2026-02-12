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

      setData({ count: data.count + 1 });
    }, [hasSynced]);
    return <div id="viewCount">{data.count}</div>;
  }
);
