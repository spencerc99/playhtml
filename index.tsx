import "./home.scss";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Candle } from "./packages/react/example";

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <React.StrictMode>
    <Candle />
  </React.StrictMode>
);

// TODO: convert the guestbook to react and make the hook to make that possible
