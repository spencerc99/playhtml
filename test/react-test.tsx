import "../home.scss";
import React from "react";
import ReactDOM from "react-dom/client";
import {
  Candle,
  Lamp,
  OnlineIndicator,
  ReactionView,
  SharedSound,
} from "../packages/react/example";
import { CanGrowElement, CanHoverElement } from "../packages/react/src";
import { CanResizeElement } from "../packages/react/src/elements";

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <>
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
    <CanResizeElement initialHeight={150} initialWidth={150}>
      <div
        style={{
          background: "orange",
          border: "1px solid black",
        }}
      ></div>
    </CanResizeElement>

    {/* <SharedSound soundUrl={"/lamp-on.m4a"} /> */}
  </>
);
