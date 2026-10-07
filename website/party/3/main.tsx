// ABOUTME: Mounts the collaborative third-anniversary party page.
// ABOUTME: Configures page-scoped PlayHTML cursors before rendering the room.

import React from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider } from "@playhtml/react";
import { PartyPage } from "./PartyPage";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PlayProvider
      initOptions={{
        cursors: {
          enabled: true,
          enableChat: false,
          coordinateMode: "absolute",
          onCustomCursorRender: (connectionId, element) => {
            element.dataset.partyCursorPid = connectionId;
            return null;
          },
          room: "page",
        },
      }}
    >
      <PartyPage />
    </PlayProvider>
  </React.StrictMode>,
);
