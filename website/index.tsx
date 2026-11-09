// ABOUTME: Boots the playhtml.fun homepage: shared toys, guestbook, and React islands.
// ABOUTME: Element ids and data shapes match the previous homepage so saved state carries over.

import "./homepage.scss";
import { createRoot } from "react-dom/client";
import { PlayProvider } from "@playhtml/react";
import { HomeIslands } from "./components/home/HomeIslands";
import {
  guestbookCapability,
  setupGuestbookNameInput,
} from "./components/home/guestbook";
import {
  loadLiveCounts,
  setupCodePeeks,
  setupLabels,
  setupMirrorDemo,
  setupSponsorGoal,
  setupToyboxScale,
} from "./components/home/pageChrome";
import {
  setupExperimentsTracesHost,
  setupHereNow,
  setupHoverCat,
  setupPersistentNote,
  setupSnippetCopies,
  setupTipJar,
  setupWordmarkColors,
} from "./components/home/sharedElements";

const isCursorRoom = (
  value: string | null,
): value is "page" | "domain" | "section" =>
  value === "page" || value === "domain" || value === "section";

// Lets local previews and smoke tests point the page at a local server/room.
function getLocalPreviewInitOptions() {
  const localHostnames = new Set(["localhost", "127.0.0.1"]);
  if (!localHostnames.has(window.location.hostname)) return {};

  const params = new URLSearchParams(window.location.search);
  const host = params.get("playhtmlHost");
  const room = params.get("playhtmlRoom");
  const cursorRoom = params.get("playhtmlCursorRoom");

  return {
    ...(host ? { host } : {}),
    ...(room ? { room } : {}),
    ...(isCursorRoom(cursorRoom) ? { cursorRoom } : {}),
  };
}

setupToyboxScale();
setupLabels();
setupCodePeeks();
setupMirrorDemo();
setupSponsorGoal();
loadLiveCounts();
setupGuestbookNameInput();
setupHereNow();
setupHoverCat();
setupSnippetCopies();
setupPersistentNote();
setupWordmarkColors();
setupTipJar();
setupExperimentsTracesHost();

const reactContentElement = document.getElementById("reactContent");
if (reactContentElement) {
  const { cursorRoom, ...localPreviewOptions } = getLocalPreviewInitOptions();
  createRoot(reactContentElement).render(
    <PlayProvider
      initOptions={{
        ...localPreviewOptions,
        cursors: {
          enableChat: true,
          enabled: true,
          ...(cursorRoom ? { room: cursorRoom } : {}),
        },
        extraCapabilities: {
          "can-post": guestbookCapability,
        },
      }}
    >
      <HomeIslands />
    </PlayProvider>,
  );
}
