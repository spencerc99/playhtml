// ABOUTME: Entrypoint for the cursor pasture experiment.
// ABOUTME: Renders the PlayProvider and main CursorPasture component.
import "./cursor-pasture.scss";
import React from "react";
import ReactDOM from "react-dom/client";
import { PlayProvider } from "@playhtml/react";

function CursorPasture() {
  return <div id="pasture">cursor pasture — coming soon</div>;
}

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement
).render(
  <PlayProvider
    initOptions={{
      cursors: {
        enabled: true,
      },
    }}
  >
    <CursorPasture />
  </PlayProvider>
);
