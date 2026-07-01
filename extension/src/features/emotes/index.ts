// ABOUTME: Mounts the emote wheel into the page and wires keydown, broadcast, and rendering.
// ABOUTME: Runs only on cursor-enabled sites; returns a cleanup for the custom-site lifecycle.

import { createRoot } from "react-dom/client";
import { createElement } from "react";
import type { PresenceAPI } from "@playhtml/common";
import { injectShadow } from "../../entrypoints/content/inject-ui";
import { EMOTES_CSS } from "./emotes.styles";
import { EmoteWheel } from "./EmoteWheel";
import { EmoteBroadcaster } from "./EmoteBroadcaster";
import { EmoteRenderer, type CursorSource } from "./EmoteRenderer";
import { EMOTES, getEmote } from "./emotes";
import { nearestPeer, DEFAULT_TARGET_RADIUS_PX } from "./interactions";

const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Martian+Mono:wght@400;600&display=swap";

function isTypingTarget(t: EventTarget | null): boolean {
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

function keyToIndex(key: string): number | null {
  if (key === "0") return 9;
  const n = Number(key);
  return n >= 1 && n <= 9 ? n - 1 : null;
}

export function initEmotes(deps: {
  presence: PresenceAPI;
  cursorClient: CursorSource;
}): () => void {
  const { host, shadow } = injectShadow({
    hostStyle: "position:fixed;inset:0;pointer-events:none;z-index:2147483645;",
    css: EMOTES_CSS,
    fontUrl: FONT_URL,
  });

  const reactContainer = document.createElement("div");
  reactContainer.style.pointerEvents = "auto";
  shadow.appendChild(reactContainer);
  const root = createRoot(reactContainer);

  let lastCursor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const trackCursor = (e: PointerEvent) => {
    lastCursor = { x: e.clientX, y: e.clientY };
  };
  window.addEventListener("pointermove", trackCursor);

  const renderer = new EmoteRenderer(shadow, deps.cursorClient, () => lastCursor);
  const broadcaster = new EmoteBroadcaster(deps.presence, (pid, e, isMe) => {
    renderer.play(pid, e.emoteId, isMe);
  });

  const wheel = { open: false, x: 0, y: 0 };

  function render() {
    root.render(
      wheel.open
        ? createElement(EmoteWheel, {
            x: wheel.x,
            y: wheel.y,
            onSelect: (emoteId: string) => {
              closeWheel();
              fire(emoteId);
            },
            onClose: closeWheel,
          })
        : null,
    );
  }

  function openWheel() {
    wheel.open = true;
    wheel.x = lastCursor.x;
    wheel.y = lastCursor.y;
    render();
  }

  function closeWheel() {
    if (!wheel.open) return;
    wheel.open = false;
    render();
  }

  function fire(emoteId: string) {
    const def = getEmote(emoteId);
    if (!def) return;
    let targetPid: string | undefined;
    if (def.kind === "interact") {
      const peers = new Map(
        Array.from(deps.cursorClient.getCursorPresences()).map(([pid, v]) => [
          pid,
          v.cursor,
        ]),
      );
      targetPid =
        nearestPeer(lastCursor, peers, DEFAULT_TARGET_RADIUS_PX) ?? undefined;
    }
    broadcaster.emote(emoteId, targetPid);
  }

  const isMac = navigator.platform.toUpperCase().includes("MAC");
  function onKeyDown(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    // Cmd/Ctrl+Shift+E toggles the wheel.
    if (mod && e.shiftKey && (e.key === "e" || e.key === "E")) {
      e.preventDefault();
      wheel.open ? closeWheel() : openWheel();
      return;
    }
    if (e.key === "Escape" && wheel.open) {
      closeWheel();
      return;
    }
    // Bare number keys fire directly (no modifier), matching the site.
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const idx = keyToIndex(e.key);
      if (idx !== null && idx < EMOTES.length) {
        closeWheel();
        fire(EMOTES[idx].id);
      }
    }
  }
  window.addEventListener("keydown", onKeyDown);

  render();

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("pointermove", trackCursor);
    broadcaster.destroy();
    renderer.destroy();
    root.unmount();
    host.remove();
  };
}
