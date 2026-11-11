// ABOUTME: Boots the playhtml.fun homepage: shared toys, guestbook, and React islands.
// ABOUTME: Element ids and data shapes match the previous homepage so saved state carries over.

import "./homepage.scss";
import { createRoot } from "react-dom/client";
import { PlayProvider } from "@playhtml/react";
import { HomeIslands } from "./components/home/HomeIslands";
import { getLocalPreviewInitOptions } from "./components/home/localPreview";
import {
  guestbookCapability,
  setupGuestbookNameInput,
} from "./components/home/guestbook";
import {
  loadLiveCounts,
  setupCodePeeks,
  setupLazyVideos,
  setupLabels,
  setupMirrorDemo,
  setupSponsorGoal,
  setupToyboxScale,
} from "./components/home/pageChrome";
import {
  setupExperimentsTracesHost,
  setupHereNow,
  setupPersistentNote,
  setupSnippetCopies,
  setupTipJar,
  setupWordmarkColors,
} from "./components/home/sharedElements";

setupToyboxScale();
setupLazyVideos();
setupLabels();
setupCodePeeks();
setupMirrorDemo();
setupSponsorGoal();
loadLiveCounts();
setupGuestbookNameInput();
setupHereNow();
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
