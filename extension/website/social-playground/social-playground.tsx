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
import { SealingCeremony } from "@extension/components/sealing/SealingCeremony";

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
  const browser = (await import("webextension-polyfill")).default;
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

// --- boot the live social stack, then mount the ceremony tester ---
const statusEl = document.getElementById("status");
bootSocial()
  .then(() => {
    if (statusEl) statusEl.textContent = "live — satchel is bottom-right; bottles place on this page";
  })
  .catch((err) => {
    console.error("[social-playground] boot failed:", err);
    if (statusEl) statusEl.textContent = "boot failed — see console";
  });

const root = document.getElementById("ceremony-root");
if (root) createRoot(root).render(<CeremonyTester />);
