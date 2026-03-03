// ABOUTME: Entry point for the wewere.online homepage.
// ABOUTME: Mounts the root React app into the DOM.

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.scss";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
