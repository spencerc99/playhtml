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
  const [, setOpen] = useState(false);
  const [armed, setArmed] = useState<ArmedTool | null>(inventory.getArmed());
  const nubRef = useRef<HTMLDivElement>(null);
  const kitRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ top: Math.round(window.innerHeight / 2) - 24 });

  useEffect(() => inventory.onArmedChange(setArmed), [inventory]);

  // keyboard / external open signal
  useEffect(() => {
    if (openSignal.seq === 0) return;
    openKit(openSignal.at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal.seq]);

  function openKit(at: { x: number; y: number } | null) {
    const kit = kitRef.current;
    if (!kit) return;
    kit.classList.add("show");
    const kw = 320, kh = 200;
    let x: number, y: number;
    if (at) {
      x = Math.min(at.x, window.innerWidth - kw - 12);
      y = Math.min(at.y, window.innerHeight - kh - 12);
    } else {
      const r = nubRef.current!.getBoundingClientRect();
      x = Math.min(r.left - kw + r.width, window.innerWidth - kw - 12);
      y = Math.min(r.top, window.innerHeight - kh - 12);
    }
    kit.style.left = `${Math.max(12, x)}px`;
    kit.style.top = `${Math.max(12, y)}px`;
    setOpen(true);
  }
  function closeKit() {
    kitRef.current?.classList.remove("show");
    setOpen(false);
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
    nub.classList.toggle("edge-r", toRight);
    nub.classList.toggle("edge-l", !toRight);
    nub.style.left = toRight ? "auto" : "0px";
    nub.style.right = toRight ? "0px" : "auto";
    if (!drag.current.moved) openKit(null); // a click opens at the nub
  }

  const items = inventory.list();

  return (
    <div className="wwo-inv">
      <div
        ref={nubRef}
        className="wwo-nub edge-r"
        style={{ right: 0, top: pos.current.top }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <div className="bp" style={{ backgroundImage: `url("${BACKPACK}")` }} />
      </div>

      <div ref={kitRef} className="wwo-kit">
        <div className="wwo-kit-head">
          <span className="t">your satchel</span>
          <span className="x" onClick={closeKit}>&#9656; collapse</span>
        </div>
        <div className="wwo-grid">
          {items.map((item, i) => {
            const c = inventory.count(item.id);
            const isArmed = armed?.itemId === item.id;
            return (
              <div
                key={item.id}
                className={`wwo-slot${isArmed ? " armed" : ""}`}
                title={item.label}
                onClick={() => { inventory.arm(item.id); closeKit(); }}
              >
                <span className="key">{i + 1}</span>
                <div className="ic" style={{ backgroundImage: `url("${item.icon}")` }} />
                <span className={`q${c === Infinity ? " inf" : ""}`}>{c === Infinity ? "∞" : c}</span>
              </div>
            );
          })}
          {Array.from({ length: Math.max(0, 8 - items.length) }).map((_, i) => (
            <div key={`e${i}`} className="wwo-slot empty">
              <span className="key">{items.length + i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
