// ABOUTME: Mounts the persistent collaborative balloon workshop.
// ABOUTME: Configures page-scoped cursors for the unlinked workshop route.

import React from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider } from "@playhtml/react";
import { BalloonWorkshop } from "./BalloonWorkshop";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlayProvider
      initOptions={{
        cursors: {
          enabled: true,
          enableChat: false,
          coordinateMode: "absolute",
          room: "page",
        },
      }}
    >
      <BalloonWorkshop />
    </PlayProvider>
  </React.StrictMode>,
);
