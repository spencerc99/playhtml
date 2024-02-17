import { withPlay } from "@playhtml/react";

interface Props {}

export const ToggleSquare = withPlay<Props>()(
  { defaultData: { on: false } },
  ({ data, setData, myAwareness, props }) => {
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
