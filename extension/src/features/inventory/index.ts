// ABOUTME: Mounts the inventory satchel into the host page via Shadow DOM and wires arm/disarm cues.
// ABOUTME: Owns the wielded-cursor follower, the open-signal for keyboard summon, and cleanup.

import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { injectShadow } from "../../entrypoints/content/inject-ui";
import { INVENTORY_CSS } from "./inventory.styles";
import { Satchel } from "./Satchel";
import { WieldCursor } from "./WieldCursor";
import { registerKeyboardSummon } from "./keyboard";
import type { GlobalFeatureDeps } from "../social/types";

const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,wght@1,200&family=Martian+Mono:wght@400;600&family=Atkinson+Hyperlegible:wght@400;700&display=swap";

export function initInventorySurface(deps: GlobalFeatureDeps): () => void {
  const { host, shadow } = injectShadow({
    hostStyle: "position:fixed;inset:0;pointer-events:none;z-index:2147483646;",
    css: INVENTORY_CSS,
    fontUrl: FONT_URL,
  });

  const reactContainer = document.createElement("div");
  shadow.appendChild(reactContainer);
  const root = createRoot(reactContainer);

  const openSignal = { at: null as { x: number; y: number } | null, seq: 0 };
  // Placeholder until the first pointermove; the keyboard summon opens at the real cursor once tracked.
  let lastCursor = { x: window.innerWidth - 60, y: window.innerHeight - 60 };
  const trackCursor = (e: PointerEvent) => { lastCursor = { x: e.clientX, y: e.clientY }; };
  window.addEventListener("pointermove", trackCursor);

  function render() {
    root.render(createElement(Satchel, { inventory: deps.inventory, openSignal: { ...openSignal } }));
  }
  render();

  const offKeyboard = registerKeyboardSummon(() => {
    openSignal.at = { ...lastCursor };
    openSignal.seq += 1;
    render();
  });

  const wield = new WieldCursor(shadow);
  const offArmed = deps.inventory.onArmedChange((armed) => {
    if (armed) {
      // Keep the page's normal cursor visible; the wield icon rides beside it so it
      // reads as the cursor "holding" the tool. Items that draw their own armed
      // cursor (e.g. the bottle's placement ghost) suppress this generic icon.
      const item = deps.inventory.list().find((i) => i.id === armed.itemId);
      if (item && !item.ownsArmedCursor) wield.show(item.icon, lastCursor);
      else wield.hide();
    } else {
      wield.hide();
    }
  });

  const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") deps.inventory.disarm(); };
  window.addEventListener("keydown", onEsc);

  return () => {
    offKeyboard();
    offArmed();
    window.removeEventListener("keydown", onEsc);
    window.removeEventListener("pointermove", trackCursor);
    wield.destroy();
    root.unmount();
    host.remove();
  };
}
