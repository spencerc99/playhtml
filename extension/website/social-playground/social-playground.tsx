// ABOUTME: Live preview of the extension's social mechanics (inventory satchel + bottles) on the site.
// ABOUTME: Runs the REAL initGlobalFeatures (imported from @extension) so this stays in sync with the extension.

import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { playhtml } from "playhtml";
import { FLAGS } from "@extension/flags";
import {
  initGlobalFeatures,
  anyGlobalFeatureActive,
} from "@extension/features/global";
import browser from "webextension-polyfill";
import { FoldCeremony } from "@extension/components/sealing/FoldCeremony";
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
// Match the fonts the extension injects into its shadow root so the letter
// scroll reads the same on the site.
if (!document.getElementById("message-bottle-fonts")) {
  const fontLink = document.createElement("link");
  fontLink.id = "message-bottle-fonts";
  fontLink.rel = "stylesheet";
  fontLink.href =
    "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Lora:ital,wght@0,500;0,600;1,500&family=Martian+Mono:wght@400;600&display=swap";
  document.head.appendChild(fontLink);
}

const PLAYER_COLORS = ["#4a9a8a", "#c4724e", "#5b8db8", "#d4b85c", "#8b6b7f"];
function randomColor() {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}

/**
 * Boot the live social stack exactly as the extension content script does:
 * a headless playhtml instance (cursors off) → initGlobalFeatures(deps).
 * The dev override is forced on so flag-off experiments still run here.
 */
async function bootSocial(): Promise<() => void> {
  // Force the internal-dev override on (shim-backed storage), so experiments
  // run on the site even though their committed FLAGS are off.
  await browser.storage.local.set({ internalDevFeaturesEnabled: true });

  if (!(await anyGlobalFeatureActive())) {
    console.warn("[social-playground] no social experiment active");
    return () => {};
  }

  await playhtml.init({
    cursors: { enabled: false },
    room: () => `wwo-playground${window.location.pathname}`,
  });

  const cleanup = await initGlobalFeatures({
    createPageData: playhtml.createPageData,
    presence: playhtml.presence,
    playerColor: randomColor(),
    playerPid: "playground-" + Math.random().toString(36).slice(2, 8),
  });
  return cleanup;
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
  const [canReply, setCanReply] = useState(true);
  const [key, setKey] = useState(0); // remount to reset the bottle to its sealed state

  useEffect(() => {
    const colorEl = document.getElementById("bp-color") as HTMLInputElement | null;
    const textEl = document.getElementById("bp-text") as HTMLTextAreaElement | null;
    const emptyEl = document.getElementById("bp-empty") as HTMLInputElement | null;
    const canReplyEl = document.getElementById("bp-canreply") as HTMLInputElement | null;
    const resetBtn = document.getElementById("bp-reset") as HTMLButtonElement | null;
    const sync = () => {
      const c = colorEl?.value || "#c4724e";
      setColor(c);
      if (emptyEl?.checked) {
        setNotes([]);
      } else {
        // "---" on its own line splits the textarea into separate letters, so
        // the multi-letter scroll (tick rail, snap, land-on-latest) is testable.
        const styleIds = ["web1", "stationery", "webnative"];
        const colors = ["#c4724e", "#4a9a8a", "#5b8db8", "#8b6b7f"];
        const parts = (textEl?.value || "")
          .split(/\n---\n/)
          .map((t) => t.trim())
          .filter(Boolean);
        setNotes(
          (parts.length ? parts : [""]).map((text, i) => ({
            text,
            createdAt: Date.now() - (parts.length - 1 - i) * 86400000,
            createdBy: i === parts.length - 1 ? "anon" : `other-${i}`,
            authorColor: i === 0 ? c : colors[i % colors.length],
            ...(i > 0 ? { styleId: styleIds[i % styleIds.length], authorName: `writer ${i + 1}` } : {}),
          })),
        );
      }
      setCanReply(canReplyEl?.checked ?? true);
      setKey((k) => k + 1);
    };
    // Seed a long thread of random-styled letters to preview the scroll at
    // volume, covering all four pickable styles.
    const seedBtn = document.getElementById("bp-seed") as HTMLButtonElement | null;
    const seed = () => {
      const styleIds = ["linen", "web1", "stationery", "webnative"];
      const colors = ["#c4724e", "#4a9a8a", "#5b8db8", "#d4b85c", "#8b6b7f"];
      const lines = [
        "passing through, leaving a pebble on the pile.",
        "found this while looking for something else entirely — staying a minute.",
        "the wind is good today. keep going.",
        "someone told me pages remember. testing that.",
        "hello from a train, somewhere between two tunnels.",
        "i read every letter above this one. you're all very kind.",
        "left my coffee to write this. worth it.",
        "the internet feels small and warm right here.",
        "if you find this, the chain is still alive. add yours.",
        "quiet week. this helped.",
        "drawing a little sun in the margin for you.",
        "we were online at the same time, probably.",
      ];
      const n = 12;
      setNotes(
        Array.from({ length: n }, (_, i) => {
          const styleId = styleIds[Math.floor(Math.random() * styleIds.length)];
          return {
            text: lines[i % lines.length],
            createdAt: Date.now() - (n - 1 - i) * 43200000,
            createdBy: i === n - 1 ? "anon" : `other-${i}`,
            authorColor: colors[Math.floor(Math.random() * colors.length)],
            ...(styleId ? { styleId } : {}),
            ...(Math.random() < 0.7 ? { authorName: `writer ${i + 1}` } : {}),
          };
        }),
      );
      setKey((k) => k + 1);
    };
    colorEl?.addEventListener("input", sync);
    textEl?.addEventListener("input", sync);
    emptyEl?.addEventListener("change", sync);
    canReplyEl?.addEventListener("change", sync);
    resetBtn?.addEventListener("click", () => setKey((k) => k + 1));
    seedBtn?.addEventListener("click", seed);
    return () => {
      colorEl?.removeEventListener("input", sync);
      textEl?.removeEventListener("input", sync);
      emptyEl?.removeEventListener("change", sync);
      canReplyEl?.removeEventListener("change", sync);
      seedBtn?.removeEventListener("click", seed);
    };
  }, []);

  return (
    <MessageBottle
      key={key}
      notes={notes}
      authorColor={color}
      canReply={canReply}
      pageBg="#faf7f2"
      onSeal={(_text, _meta) => {}}
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
    <FoldCeremony
      text={text}
      authorColor={color}
      slotX={slot.x}
      slotY={slot.y}
      newNote={{
        text,
        createdAt: Date.now(),
        createdBy: "",
        authorColor: color,
        authorName: "you",
      }}
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
        "live — satchel bottom-right; synced bottles place on this page";
  })
  .catch((err) => {
    console.error("[social-playground] live boot failed:", err);
    if (statusEl)
      statusEl.textContent =
        "live sync unavailable — direct bottle/ceremony below still work";
  });
