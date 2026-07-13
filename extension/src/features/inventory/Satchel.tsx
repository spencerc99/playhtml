// ABOUTME: The inventory satchel UI — a draggable edge-nub that opens into the cozy kit.
// ABOUTME: Reads items + armed state from the InventoryAPI; arming routes through api.arm().

import { useEffect, useRef, useState } from "react";
import browser from "webextension-polyfill";
import type { InventoryAPI, ArmedTool } from "./types";

const BACKPACK = browser.runtime.getURL("inventory/backpack.png");

interface Props {
  inventory: InventoryAPI;
  /** Called when the kit should open at a point (cursor summon); undefined = open at nub. */
  openSignal: { at: { x: number; y: number } | null; seq: number };
}

export function Satchel({ inventory, openSignal }: Props) {
  const [armed, setArmed] = useState<ArmedTool | null>(inventory.getArmed());
  const [hidden, setHidden] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const nubRef = useRef<HTMLDivElement>(null);
  const kitRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ top: Math.round(window.innerHeight / 2) - 24 });
  const edge = useRef<"edge-r" | "edge-l">("edge-l");

  useEffect(() => inventory.onArmedChange(setArmed), [inventory]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const index = Number(event.key) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= 6) return;
      const item = inventory.list()[index];
      if (!item) return;
      event.preventDefault();
      if (armed?.itemId === item.id) inventory.disarm();
      else inventory.arm(item.id);
      closeKit();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [armed, inventory, isOpen]);

  // keyboard / external open signal
  useEffect(() => {
    if (openSignal.seq === 0) return;
    openKit(openSignal.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal.seq]);

  function openKit(at: { x: number; y: number } | null) {
    const kit = kitRef.current;
    if (!kit) return;
    setHidden(false);
    setIsOpen(true);
    kit.classList.add("show");
    // Measure the rendered kit so cursor summons stay inside the viewport.
    // Fall back to sensible dimensions if layout has not produced a box yet.
    const kitRect = kit.getBoundingClientRect();
    const kw = kitRect.width || 320;
    const kh = kitRect.height || 200;
    const maxX = window.innerWidth - kw - 12;
    const maxY = window.innerHeight - kh - 12;
    let x: number, y: number;
    if (at) {
      x = Math.min(at.x, maxX);
      y = Math.min(at.y, maxY);
    } else {
      const r = nubRef.current!.getBoundingClientRect();
      x = edge.current === "edge-l" ? r.left : r.left - kw + r.width;
      x = Math.min(x, maxX);
      y = Math.min(r.top, maxY);
    }
    kit.style.left = `${Math.max(12, x)}px`;
    kit.style.top = `${Math.max(12, y)}px`;
  }
  function closeKit() {
    setIsOpen(false);
  }
  function hideInventory() {
    setIsOpen(false);
    setHidden(true);
  }

  // drag the nub (snap to nearest edge on release)
  const drag = useRef({ active: false, moved: false, dx: 0, dy: 0 });
  function onPointerDown(e: React.PointerEvent) {
    drag.current = { active: true, moved: false, dx: e.clientX, dy: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current.active) return;
    if (Math.abs(e.clientX - drag.current.dx) + Math.abs(e.clientY - drag.current.dy) > 4) drag.current.moved = true;
    const nub = nubRef.current!;
    nub.style.top = `${Math.max(8, Math.min(e.clientY - 24, window.innerHeight - 56))}px`;
    nub.style.right = "auto";
    nub.style.left = `${e.clientX - 17}px`;
  }
  function onPointerUp(e: React.PointerEvent) {
    if (!drag.current.active) return;
    drag.current.active = false;
    const nub = nubRef.current!;
    const toRight = e.clientX > window.innerWidth / 2;
    edge.current = toRight ? "edge-r" : "edge-l";
    nub.classList.toggle("edge-r", toRight);
    nub.classList.toggle("edge-l", !toRight);
    // -8px docks the nub's outer edge past the viewport edge (see .wwo-nub in
    // inventory.styles.ts) so the visible tab never sits flush against it.
    nub.style.left = toRight ? "auto" : "-8px";
    nub.style.right = toRight ? "-8px" : "auto";
    pos.current.top = parseFloat(nub.style.top);
    if (!drag.current.moved) openKit(null); // a click opens at the nub
  }

  const items = inventory.list().slice(0, 6);

  return (
    <div className="wwo-inv">
      {!hidden && !isOpen && (
        <div
          ref={nubRef}
          className="wwo-nub edge-l"
          style={{ left: -8, top: pos.current.top }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div className="bp" style={{ backgroundImage: `url("${BACKPACK}")` }} />
        </div>
      )}

      <div ref={kitRef} className={`wwo-kit${isOpen ? " show" : ""}`}>
        <div className="wwo-kit-head">
          <span className="t">your satchel</span>
          <div className="wwo-kit-actions">
            <button type="button" onClick={hideInventory}>hide</button>
            <button type="button" onClick={closeKit}>&#9666; close</button>
          </div>
        </div>
        <div className="wwo-grid">
          {items.map((item, i) => {
            const c = inventory.count(item.id);
            const isArmed = armed?.itemId === item.id;
            return (
              <div
                key={item.id}
                className={`wwo-slot${isArmed ? " armed" : ""}`}
                title={isArmed ? `${item.label} — click to put away` : item.label}
                onClick={() => { isArmed ? inventory.disarm() : inventory.arm(item.id); closeKit(); }}
              >
                <span className="key">{i + 1}</span>
                <div className="ic" style={{ backgroundImage: `url("${item.icon}")` }} />
                <span className={`q${c === Infinity ? " inf" : ""}`}>{c === Infinity ? "∞" : c}</span>
              </div>
            );
          })}
          {Array.from({ length: Math.max(0, 6 - items.length) }).map((_, i) => (
            <div key={`e${i}`} className="wwo-slot empty">
              <span className="key">{items.length + i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
