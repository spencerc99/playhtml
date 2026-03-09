// ABOUTME: Entry point for the wewere.online homepage.
// ABOUTME: Mounts the root React app with PlayProvider for real-time shared state.

import React from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider } from "@playhtml/react";
import App from "./App.tsx";
import "./index.scss";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlayProvider
      initOptions={{ cursors: { enabled: true, enableChat: false } }}
    >
      <App />
    </PlayProvider>
  </React.StrictMode>
);
