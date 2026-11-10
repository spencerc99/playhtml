// ABOUTME: Boots the /events page: shared header counts and live cursors.
// ABOUTME: The event list itself is static HTML in index.html.

import "../homepage.scss";
import "../pages.scss";
import { createRoot } from "react-dom/client";
import { PlayProvider } from "@playhtml/react";
import { getLocalPreviewInitOptions } from "../components/home/localPreview";
import { loadLiveCounts } from "../components/home/pageChrome";

loadLiveCounts();

const reactContentElement = document.getElementById("reactContent");
if (reactContentElement) {
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
      {null}
    </PlayProvider>,
  );
}
