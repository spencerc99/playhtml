// ABOUTME: Boots the unlisted /experiments page: every experiment as a wall of names.
// ABOUTME: Shares the homepage's styles and header; its playhtml room is this page.

import "../homepage.scss";
import "../pages.scss";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { PlayProvider } from "@playhtml/react";
import ExperimentsArchive from "../components/ExperimentsArchive";
import { getLocalPreviewInitOptions } from "../components/home/localPreview";
import { loadLiveCounts } from "../components/home/pageChrome";

loadLiveCounts();

const reactContentElement = document.getElementById("reactContent");
const mount = document.getElementById("experiments-mount");
if (reactContentElement && mount) {
  const { cursorRoom, ...localPreview } = getLocalPreviewInitOptions();
  createRoot(reactContentElement).render(
    <PlayProvider
      initOptions={{
        ...localPreview,
        cursors: {
          enabled: true,
          enableChat: true,
          ...(cursorRoom ? { room: cursorRoom } : {}),
        },
      }}
    >
      {createPortal(<ExperimentsArchive variant="wall" />, mount)}
    </PlayProvider>,
  );
}
