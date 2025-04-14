import React from "react";
import { withSharedState } from "@playhtml/react";

interface Props {}

export const ToggleSquare = withSharedState(
  { defaultData: { on: false } },
  ({ data, setData }, props) => {
    return (
      <div
        style={{
          width: "200px",
          height: "200px",
          ...(data.on ? { background: "green" } : { background: "red" }),
        }}
        onClick={() => setData({ on: !data.on })}
      />
    );
  }
);
