// ABOUTME: Live preview of the extension's social mechanics (inventory satchel + bottles + emotes) on the site.
// ABOUTME: Runs the REAL initGlobalFeatures + initEmotes (imported from @extension) so this stays in sync with the extension.

import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { playhtml } from "playhtml";
import { FLAGS } from "@extension/flags";
import {
  initGlobalFeatures,
  anyGlobalFeatureActive,
} from "@extension/features/global";
import { initEmotes } from "@extension/features/emotes";
import browser from "webextension-polyfill";
import { SealingCeremony } from "@extension/components/sealing/SealingCeremony";
import {
  MessageBottle,
  MESSAGE_BOTTLE_CSS,
} from "@extension/components/MessageBottle";
import type { BottleNote } from "@extension/features/BottleManager";

// The bottle's CSS ships as an inline string (the extension injects it into a
// Shadow root). On the site, inject it into the document once so the directly
// rendered MessageBottle is styled.
if (!document.getElementById("message-bottle-css")) {
  const styleEl = document.createElement("style");
  styleEl.id = "message-bottle-css";
  styleEl.textContent = MESSAGE_BOTTLE_CSS;
  document.head.appendChild(styleEl);
}

const PLAYER_COLORS = ["#4a9a8a", "#c4724e", "#5b8db8", "#d4b85c", "#8b6b7f"];
function randomColor() {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}

/**
 * Boot the live social stack exactly as the extension content script does:
 * a playhtml instance → initGlobalFeatures(deps) for the satchel + bottles, and
 * initEmotes(deps) for the emote wheel. Cursors are enabled here (unlike the
 * extension's headless every-page path) so the emote wheel has a cursorClient
 * and peer positions to render on — matching the extension's cursor-site path.
 * The dev override is forced on so flag-off experiments still run here.
 */
async function bootSocial(): Promise<() => void> {
  // Force the internal-dev override on (shim-backed storage), so experiments
  // run on the site even though their committed FLAGS are off.
  await browser.storage.local.set({ internalDevFeaturesEnabled: true });

  await playhtml.init({
    cursors: { enabled: true, coordinateMode: "absolute" },
    room: () => `wwo-playground${window.location.pathname}`,
  });

  const cleanups: Array<() => void> = [];

  if (await anyGlobalFeatureActive()) {
    cleanups.push(
      await initGlobalFeatures({
        createPageData: playhtml.createPageData,
        presence: playhtml.presence,
        playerColor: randomColor(),
        playerPid: "playground-" + Math.random().toString(36).slice(2, 8),
      }),
    );
  } else {
    console.warn("[social-playground] no global social experiment active");
  }

  // The emote wheel rides the cursor layer (Cmd/Ctrl+Shift+E). It lives outside
  // initGlobalFeatures — in the extension it's wired into the cursor-site path.
  if (playhtml.cursorClient) {
    cleanups.push(
      initEmotes({
        presence: playhtml.presence,
        cursorClient: playhtml.cursorClient,
      }),
    );
  }

  return () => cleanups.forEach((c) => c());
}

/**
 * Direct bottle render — no playhtml / realtime. This is the reliable "photo"
 * target: the real MessageBottle component, click to open/read/seal, instantly,
 * regardless of network. Controls (text, color, # notes) drive what's shown.
 */
function BottlePreview() {
  const [color, setColor] = useState("#c4724e");
  const [notes, setNotes] = useState<BottleNote[]>([
    {
      text: "if you're reading this, the wifi is back up.",
      createdAt: Date.now(),
      createdBy: "anon",
      authorColor: "#c4724e",
    },
  ]);
  const [key, setKey] = useState(0); // remount to reset the bottle to its sealed state

  useEffect(() => {
    const colorEl = document.getElementById("bp-color") as HTMLInputElement | null;
    const textEl = document.getElementById("bp-text") as HTMLTextAreaElement | null;
    const emptyEl = document.getElementById("bp-empty") as HTMLInputElement | null;
    const resetBtn = document.getElementById("bp-reset") as HTMLButtonElement | null;
    const sync = () => {
      const c = colorEl?.value || "#c4724e";
      setColor(c);
      if (emptyEl?.checked) {
        setNotes([]);
      } else {
        setNotes([
          {
            text: textEl?.value || "",
            createdAt: Date.now(),
            createdBy: "anon",
            authorColor: c,
          },
        ]);
      }
      setKey((k) => k + 1);
    };
    colorEl?.addEventListener("input", sync);
    textEl?.addEventListener("input", sync);
    emptyEl?.addEventListener("change", sync);
    resetBtn?.addEventListener("click", () => setKey((k) => k + 1));
    return () => {
      colorEl?.removeEventListener("input", sync);
      textEl?.removeEventListener("input", sync);
      emptyEl?.removeEventListener("change", sync);
    };
  }, []);

  return (
    <MessageBottle
      key={key}
      notes={notes}
      authorColor={color}
      pageBg="#faf7f2"
      onSeal={() => {}}
    />
  );
}

function CeremonyTester() {
  const [playing, setPlaying] = useState(false);
  const [text, setText] = useState(
    "if you're reading this, the wifi is back up.",
  );
  const [color, setColor] = useState("#c4724e");
  const [slot, setSlot] = useState({ x: 0, y: 0 });
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = document.getElementById("slot");
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSlot({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    };
    update();
    window.addEventListener("resize", update);
    const onDown = (e: PointerEvent) => {
      draggingRef.current = true;
      (el as Element).setPointerCapture(e.pointerId);
      e.stopPropagation();
    };
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      el.style.left = `${e.clientX - 8}px`;
      el.style.top = `${e.clientY - 8}px`;
      update();
    };
    const onUp = () => (draggingRef.current = false);
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("resize", update);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // wire the HTML controls
  useEffect(() => {
    const msgEl = document.getElementById("msg") as HTMLTextAreaElement | null;
    const colorEl = document.getElementById("color") as HTMLInputElement | null;
    const playBtn = document.getElementById("play") as HTMLButtonElement | null;
    const onMsg = () => msgEl && setText(msgEl.value);
    const onColor = () => colorEl && setColor(colorEl.value);
    const onPlay = () => setPlaying(true);
    if (msgEl) {
      msgEl.value = text;
      msgEl.addEventListener("input", onMsg);
    }
    if (colorEl) {
      colorEl.value = color;
      colorEl.addEventListener("input", onColor);
    }
    playBtn?.addEventListener("click", onPlay);
    return () => {
      msgEl?.removeEventListener("input", onMsg);
      colorEl?.removeEventListener("input", onColor);
      playBtn?.removeEventListener("click", onPlay);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!playing) return null;
  return (
    <SealingCeremony
      text={text}
      authorColor={color}
      slotX={slot.x}
      slotY={slot.y}
      onComplete={() => setPlaying(false)}
    />
  );
}

// --- mount the direct-render testers first (instant, no network) ---
const bottleRoot = document.getElementById("bottle-root");
if (bottleRoot) createRoot(bottleRoot).render(<BottlePreview />);

const ceremonyRoot = document.getElementById("ceremony-root");
if (ceremonyRoot) createRoot(ceremonyRoot).render(<CeremonyTester />);

// --- boot the live synced social stack in the background (non-blocking) ---
// The page is fully usable for previewing/photographing the bottle without this;
// the live satchel + synced bottles are a bonus that needs a PartyKit connection.
const statusEl = document.getElementById("status");
bootSocial()
  .then(() => {
    if (statusEl)
      statusEl.textContent =
        "live — satchel bottom-right; synced bottles on this page; emote wheel on Cmd/Ctrl+Shift+E";
  })
  .catch((err) => {
    console.error("[social-playground] live boot failed:", err);
    if (statusEl)
      statusEl.textContent =
        "live sync unavailable — direct bottle/ceremony below still work";
  });
