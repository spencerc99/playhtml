import "../home.scss";
import React, { PropsWithChildren } from "react";
import ReactDOM from "react-dom/client";
import {
  CanGrowElement,
  CanHoverElement,
  withSharedState,
  PlayProvider,
  CanMoveElement,
  CanSpinElement,
} from "@playhtml/react";
import { ReactionView } from "../../packages/react/examples/Reaction";
import { Lamp } from "../../packages/react/examples/SharedLamp";
import { OnlineIndicator } from "../../packages/react/examples/OnlineIndicator";
import { ConfettiZone } from "../../packages/react/examples/Confetti";
import { LiveVisitorCount } from "../../packages/react/examples/VisitorCount";
import { ViewCount } from "../../packages/react/examples/ViewCount";
import { CanDuplicateElement } from "@playhtml/react";

const Candle = withSharedState(
  { defaultData: { on: false } },
  ({ data, setData }) => {
    return (
      <img
        src={data.on ? "/candle-gif.gif" : "/candle-off.png"}
        selector-id=".candle"
        className="candle"
        onClick={() => {
          setData({ on: !data.on });
        }}
      />
    );
  }
);

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider>
    <Candle />
    <ReactionView reaction={{ emoji: "🧡", count: 1 }} />
    <Lamp />
    <CanMoveElement>
      <div
        style={{
          width: "100px",
          height: "100px",
          background: "blue",
        }}
        className="moveBox"
      ></div>
    </CanMoveElement>
    <CanSpinElement>
      <div
        style={{
          width: "100px",
          height: "100px",
          background: "yellow",
        }}
        className="moveBox"
      ></div>
    </CanSpinElement>
    <OnlineIndicator />
    <CanGrowElement>
      <div id="plant"></div>
    </CanGrowElement>
    <CanHoverElement>
      <div
        style={{
          width: "100px",
          height: "100px",
          background: "red",
        }}
        id="hover"
        className="hoverBox"
      ></div>
    </CanHoverElement>
    {/* <CanResizeElement initialHeight={150} initialWidth={150}>
      <div
        style={{
          background: "orange",
          border: "1px solid black",
        }}
      ></div>
    </CanResizeElement> */}
    <ConfettiZone />
    <LiveVisitorCount />
    <ViewCount />
    {/* <SharedSound soundUrl={"/lamp-on.m4a"} /> */}
    {/* <MirrorableElement></MirrorableElement> */}
  </PlayProvider>
);
