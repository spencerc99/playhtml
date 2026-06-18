// ABOUTME: Direct-play test page for the sealing ceremony.
// ABOUTME: Click play, then pull down to seal. HMR lets us iterate without an extension reload.

import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { SealingCeremony } from "@extension/components/sealing/SealingCeremony";

function App() {
  const [playing, setPlaying] = useState(false);
  const [text, setText] = useState(
    "if you're reading this, the wifi is back up.",
  );
  const [color, setColor] = useState("#4a9a8a");
  const [slot, setSlot] = useState({ x: 0, y: 0 });
  const slotElRef = useRef<HTMLElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    const el = document.getElementById("slot");
    if (!el) return;
    slotElRef.current = el;

    const updateFromMarker = () => {
      const rect = el.getBoundingClientRect();
      setSlot({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    };
    updateFromMarker();
    window.addEventListener("resize", updateFromMarker);

    const onDown = (e: PointerEvent) => {
      draggingRef.current = true;
      (el as Element).setPointerCapture(e.pointerId);
      e.stopPropagation();
    };
    const onMove = (e: PointerEvent) => {
      if (!draggingRef.current) return;
      el.style.left = `${e.clientX - 8}px`;
      el.style.top = `${e.clientY - 8}px`;
      updateFromMarker();
    };
    const onUp = () => {
      draggingRef.current = false;
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("resize", updateFromMarker);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  useEffect(() => {
    const msgEl = document.getElementById("msg") as HTMLTextAreaElement | null;
    const colorEl = document.getElementById("color") as HTMLInputElement | null;
    const playBtn = document.getElementById("play") as HTMLButtonElement | null;
    if (msgEl) {
      msgEl.value = text;
      msgEl.addEventListener("input", () => setText(msgEl.value));
    }
    if (colorEl) {
      colorEl.value = color;
      colorEl.addEventListener("input", () => setColor(colorEl.value));
    }
    if (playBtn) playBtn.addEventListener("click", () => setPlaying(true));
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

const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
