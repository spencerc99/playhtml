// ABOUTME: Entry for the shared collage page: finds or starts the collage named in the address, then opens its room.
// ABOUTME: Each collage is its own playhtml room, so everyone with the link edits the same pieces.

import { createRoot } from "react-dom/client";
import "@fontsource/martian-mono/latin-400.css";
import "@fontsource/martian-mono/latin-500.css";
import "@fontsource/martian-mono/latin-600.css";
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/lora/latin-400-italic.css";
import "@fontsource/lora/latin-600.css";
import "@fontsource/lora/latin-700.css";
import { PlayProvider } from "@playhtml/react";
import { TogetherStudio } from "./TogetherStudio";
import { isCollageId } from "@extension/features/sharedCollages/sharedCollageEntry";
import {
  collageIdFromAddress,
  collagePath,
  newCollageId,
} from "./togetherPieces";

const STARTED_KEY = "wwo-together-started";

function readStarted(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(STARTED_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((id) => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function markStarted(id: string) {
  try {
    localStorage.setItem(
      STARTED_KEY,
      JSON.stringify([...readStarted(), id].slice(-200)),
    );
  } catch {
    // Without storage the collage still works; it just isn't marked as yours.
  }
}

/**
 * The collage this address names. Without one, starts a fresh collage and
 * rewrites the address to it, so the address bar is already the invite link.
 */
function collageFromAddress(): { id: string; startedByMe: boolean } {
  const { pathname, search } = window.location;
  const named = collageIdFromAddress(pathname, isCollageId);
  const id = named ?? newCollageId();
  if (!named) markStarted(id);
  if (pathname !== collagePath(id) || search) {
    window.history.replaceState(null, "", collagePath(id));
  }
  return { id, startedByMe: !named || readStarted().includes(id) };
}

const { id, startedByMe } = collageFromAddress();

createRoot(document.getElementById("reactContent")!).render(
  <PlayProvider
    initOptions={{
      room: `together-${id}`,
      cursors: { enabled: true, enableChat: false, coordinateMode: "relative" },
    }}
  >
    <TogetherStudio collageId={id} startedByMe={startedByMe} />
  </PlayProvider>,
);
