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
import { newCollageId } from "./togetherPieces";

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
  const params = new URLSearchParams(window.location.search);
  const named = params.get("c");
  if (isCollageId(named)) {
    return { id: named, startedByMe: readStarted().includes(named) };
  }
  const id = newCollageId();
  markStarted(id);
  const url = new URL(window.location.href);
  url.search = `?c=${id}`;
  window.history.replaceState(null, "", url);
  return { id, startedByMe: true };
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
