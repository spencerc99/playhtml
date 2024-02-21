import { PlayContext, withPlay } from "@playhtml/react";
import { useContext, useEffect } from "react";

interface Props {}

export const ViewCount = withPlay<Props>()(
  { defaultData: { count: 0 }, id: "viewCount" },
  ({ data, setData }) => {
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
