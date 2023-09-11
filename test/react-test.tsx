import "../home.scss";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Candle, ReactionView } from "../packages/react/example";

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <React.StrictMode>
    <Candle />
    <ReactionView reaction={{ emoji: "🧡", count: 1 }} />
  </React.StrictMode>
);
