import "../home.scss";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  CanGrowElement,
  CanHoverElement,
  withPlay,
  PlayProvider,
} from "@playhtml/react";
import { playhtml } from "../../packages/playhtml/src/main";
import { ReactionView } from "../../packages/react/examples/Reaction";
import { Lamp } from "../../packages/react/examples/SharedLamp";
import { OnlineIndicator } from "../../packages/react/examples/OnlineIndicator";
import { ConfettiZone } from "../../packages/react/examples/Confetti";
import { LiveVisitorCount } from "../../packages/react/examples/VisitorCount";
import { ViewCount } from "../../packages/react/examples/ViewCount";

const Candle = withPlay()(
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
