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

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <React.StrictMode>
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
    <SharedSound soundUrl={"/lamp-on.m4a"} />
  </React.StrictMode>
);
