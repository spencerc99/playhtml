import React from "react";
import { withSharedState } from "@playhtml/react";

export const OnlineIndicator = withSharedState(
  { defaultData: {}, myDefaultAwareness: "#008000", id: "online-indicator" },
  ({ myAwareness, setMyAwareness, awareness }, props) => {
    const myAwarenessIdx = myAwareness ? awareness.indexOf(myAwareness) : -1;
    return (
      <>
        {awareness.map((val, idx) => (
          <div
            key={idx}
            style={{
              width: "50px",
              height: "50px",
              borderRadius: "50%",
              background: val,
              boxShadow:
                idx === myAwarenessIdx
                  ? "0px 0px 30px 10px rgb(245, 169, 15)"
                  : undefined,
            }}
          ></div>
        ))}
        <input
          type="color"
          onChange={(e) => setMyAwareness(e.target.value)}
          value={myAwareness}
        />
      </>
    );
  }
);
