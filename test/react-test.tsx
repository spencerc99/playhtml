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

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <React.StrictMode>
    <Candle />
    <ReactionView reaction={{ emoji: "🧡", count: 1 }} />
    <Lamp />
    <OnlineIndicator />
    <SharedSound soundUrl={"/lamp-on.m4a"} />
  </React.StrictMode>
);
