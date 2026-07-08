// ABOUTME: Mounts the emote wheel into the page and wires keydown, broadcast, and rendering.
// ABOUTME: Runs only on cursor-enabled sites; returns a cleanup for the custom-site lifecycle.

import { createRoot } from "react-dom/client";
import { createElement } from "react";
import type { PresenceAPI } from "@playhtml/common";
import { injectShadow } from "../../entrypoints/content/inject-ui";
import { EMOTES_CSS } from "./emotes.styles";
import { CURSOR_GESTURE_CSS } from "./cursor-gestures.styles";
import { EmoteWheel } from "./EmoteWheel";
import { EmoteBroadcaster } from "./EmoteBroadcaster";
import { EmoteGhostRenderer } from "./EmoteGhostRenderer";
import { playInteraction } from "./InteractionRenderer";
import { EMOTES, getEmote } from "./emotes";
import {
  nearestPeer,
  detectMutualHighFive,
  DEFAULT_TARGET_RADIUS_PX,
  HIGHFIVE_WINDOW_MS,
} from "./interactions";

const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Martian+Mono:wght@400;600&display=swap";

const CURSOR_GESTURE_STYLE_ID = "wwo-emote-cursor-styles";
const DEFAULT_SELF_COLOR = "#4a9a8a";

interface EmoteCursorClient {
  getCursorPresences(): Map<
    string,
    {
      cursor: { x: number; y: number } | null;
      playerIdentity?: { playerStyle?: { colorPalette?: string[] } };
    }
  >;
  // Animates a peer's real cursor node in place (adds the gesture class to their
  // live cursor svg). Returns false if that peer has no rendered cursor node.
  triggerCursorAnimation(
    stableId: string,
    animationClass: string,
    durationMs?: number,
  ): boolean;
}

function injectCursorGestureStyles(): void {
  if (document.getElementById(CURSOR_GESTURE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = CURSOR_GESTURE_STYLE_ID;
  style.textContent = CURSOR_GESTURE_CSS;
  document.head.appendChild(style);
}

function removeCursorGestureStyles(): void {
  document.getElementById(CURSOR_GESTURE_STYLE_ID)?.remove();
}

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
  cursorClient: EmoteCursorClient;
}): () => void {
  injectCursorGestureStyles();

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

  const selfColor = () => {
    const myPid = deps.presence.getMyIdentity().publicKey;
    const mine = deps.cursorClient.getCursorPresences().get(myPid);
    return mine?.playerIdentity?.playerStyle?.colorPalette?.[0] ?? DEFAULT_SELF_COLOR;
  };
  const peerColor = (pid: string) => {
    const peer = deps.cursorClient.getCursorPresences().get(pid);
    return peer?.playerIdentity?.playerStyle?.colorPalette?.[0] ?? DEFAULT_SELF_COLOR;
  };
  const renderer = new EmoteGhostRenderer(() => lastCursor, selfColor);

  const broadcaster = new EmoteBroadcaster(deps.presence, (pid, e, isMe) => {
    const def = getEmote(e.emoteId);
    if (!def) return;

    if (def.kind === "interact") {
      const myPid = deps.presence.getMyIdentity().publicKey;
      const amITarget = e.targetPid === myPid;
      const senderPos = isMe ? lastCursor : deps.cursorClient.getCursorPresences().get(pid)?.cursor;
      const targetPos = e.targetPid
        ? amITarget
          ? lastCursor
          : deps.cursorClient.getCursorPresences().get(e.targetPid)?.cursor
        : null;

      if (senderPos && targetPos) {
        const mutual =
          e.emoteId === "highfive" &&
          detectMutualHighFive(e.ts, broadcaster.peerHighFiveTs(pid), HIGHFIVE_WINDOW_MS);
        playInteraction(
          e.emoteId,
          {
            senderPos,
            senderColor: isMe ? selfColor() : peerColor(pid),
            targetPos,
            targetColor: amITarget ? selfColor() : peerColor(e.targetPid!),
            mutual,
          },
          def.durationMs,
        );
        return;
      }
      // No target was in range at fire time (or their position is unknown) —
      // fall through to the solo path so the emote still does something.
    }

    if (isMe) {
      // We have no cursor DOM node of our own (playhtml renders ours as the OS
      // cursor), so animate a ghost copy and hide the OS cursor while it plays.
      renderer.play(e.emoteId);
    } else {
      // Animate the peer's single real cursor node in place — no second cursor.
      deps.cursorClient.triggerCursorAnimation(
        pid,
        `cursor-gesture-${e.emoteId}`,
        def.durationMs,
      );
    }
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
      const myPid = deps.presence.getMyIdentity().publicKey;
      const peers = new Map(
        Array.from(deps.cursorClient.getCursorPresences())
          // Exclude ourselves — otherwise we're the nearest "peer" (distance ~0)
          // and the interaction targets our own cursor instead of someone else's.
          .filter(([pid]) => pid !== myPid)
          .map(([pid, v]) => [pid, v.cursor]),
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
    removeCursorGestureStyles();
  };
}
