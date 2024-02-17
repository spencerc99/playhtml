import { withPlay } from "@playhtml/react";
import { useEffect } from "react";

interface Props {}

export const ViewCount = withPlay<Props>()(
  { defaultData: { count: 0 }, id: "viewCount" },
  ({ data, setData }) => {
    useEffect(() => {
      console.log("hello", data.count);
      setData({ count: data.count + 1 });
    }, []);
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
