// ABOUTME: CSS for the injected inventory satchel — collapsed nub, open cozy kit, wielded cursor item.
// ABOUTME: One const string injected into the Shadow root (see extension/CLAUDE.md "Injecting UI").

export const INVENTORY_CSS = `
:host { all: initial; }
.wwo-inv { font-family: 'Atkinson Hyperlegible', system-ui, sans-serif; }

/* collapsed edge nub — anchored past the viewport edge so the visible tab
   never sits flush against it (avoids scrollbar clipping) and hover growth
   never pulls the tab away from the page edge (the offscreen overhang
   absorbs the hover translate, so the far end always reads as attached) */
.wwo-nub { position: fixed; z-index: 2147483646; width: 42px; height: 48px;
  background: linear-gradient(165deg,#fbf2df,#f0e2c6); border: 2px solid #b98a4e;
  border-radius: 12px; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px rgba(120,85,40,.32), inset 0 1px 0 rgba(255,255,255,.6);
  cursor: grab; transition: width .12s, transform .12s; pointer-events: auto; }
.wwo-nub:hover { width: 48px; }
.wwo-nub.edge-r { right: -8px; border-radius: 12px 0 0 12px; border-right: none; }
.wwo-nub.edge-r:hover { transform: translateX(-3px); }
.wwo-nub.edge-r .bp { transform: translateX(-4px); }
.wwo-nub.edge-l { left: -8px; border-radius: 0 12px 12px 0; border-left: none; }
.wwo-nub.edge-l:hover { transform: translateX(3px); }
.wwo-nub.edge-l .bp { transform: translateX(4px); }
.wwo-nub .bp { width: 24px; height: 24px; background-size: contain; background-repeat: no-repeat;
  background-position: center; filter: drop-shadow(0 1px 1px rgba(90,60,20,.3)); }

/* the cozy kit (open) — carved warm frame + worn texture */
.wwo-kit { position: fixed; z-index: 2147483647; width: 216px; border-radius: 18px; padding: 14px;
  background:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='w'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0.43 0 0 0 0 0.31 0 0 0 0 0.14 0 0 0 0.5 0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23w)'/%3E%3C/svg%3E"),
    repeating-linear-gradient(48deg,rgba(120,85,40,.035) 0 1px,transparent 1px 4px),
    linear-gradient(165deg,#fbf2df,#f0e2c6);
  background-blend-mode: multiply, normal, normal;
  border: 3px solid #b98a4e;
  box-shadow: 0 0 0 2px #e8cd97, 0 10px 0 -2px rgba(150,110,55,.35), 0 16px 26px rgba(120,85,40,.3), inset 0 2px 0 rgba(255,255,255,.7);
  pointer-events: auto; display: none; }
.wwo-kit.show { display: block; }
.wwo-kit-head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 2px 10px; }
.wwo-kit-head .t { font-family: 'Source Serif 4', serif; font-style: italic; font-weight: 200; font-size: 15px; color: #7a5a2e; }
.wwo-kit-actions { display: flex; align-items: center; gap: 8px; }
.wwo-kit-actions button { appearance: none; border: 0; padding: 2px 0; background: none; cursor: pointer;
  font-family: 'Martian Mono', monospace; font-size: 9px; color: #a98d5c; }
.wwo-kit-actions button:hover, .wwo-kit-actions button:focus-visible { color: #7a5a2e; text-decoration: underline; text-underline-offset: 3px; }
.wwo-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; padding: 10px; border-radius: 12px;
  background: radial-gradient(circle at 6px 6px, rgba(150,110,55,.10) 1.3px, transparent 1.4px) 0 0/15px 15px,
    linear-gradient(180deg, rgba(120,85,40,.10), rgba(120,85,40,.04));
  box-shadow: inset 0 2px 6px rgba(110,80,40,.28); }
.wwo-slot { aspect-ratio: 1; border-radius: 12px; position: relative; display: flex; align-items: flex-end;
  justify-content: center; cursor: pointer; overflow: visible;
  background: radial-gradient(circle at 50% 38%, #fffaf0, #f2e6cf);
  box-shadow: inset 0 -3px 5px rgba(150,110,55,.22), inset 0 2px 3px rgba(255,255,255,.9);
  transition: transform .18s cubic-bezier(.34,1.56,.64,1); }
.wwo-slot:hover { transform: translateY(-3px); }
.wwo-slot .ic { position: absolute; bottom: 9%; left: 50%; width: 118%; height: 120%; transform: translateX(-50%);
  background-size: contain; background-repeat: no-repeat; background-position: center bottom;
  filter: saturate(.9) drop-shadow(2px 4px 3px rgba(90,68,40,.32)); transition: transform .2s cubic-bezier(.34,1.56,.64,1); }
.wwo-slot:hover .ic { transform: translateX(-50%) translateY(-5px) scale(1.06); }
.wwo-slot .key { position: absolute; top: 5px; left: 7px; font-family: 'Martian Mono', monospace; font-size: 9px; color: #b59a68; }
.wwo-slot .q { position: absolute; bottom: 5px; right: 7px; font-family: 'Martian Mono', monospace; font-size: 9px; font-weight: 700; color: #b0832e; }
.wwo-slot .q.inf { color: #3f998a; }
.wwo-slot.armed { box-shadow: inset 0 -3px 5px rgba(63,153,138,.25), 0 0 0 3px #4a9a8a, 0 0 12px rgba(74,154,138,.5); }
.wwo-slot.empty { cursor: default; background: radial-gradient(circle at 50% 40%, #efe5d0, #e6d8bd); box-shadow: inset 0 2px 6px rgba(120,85,40,.3); }

/* wielded item next to cursor */
.wwo-wield { position: fixed; left: 0; top: 0; width: 30px; height: 30px; pointer-events: none; z-index: 2147483647;
  display: none; filter: drop-shadow(1px 2px 2px rgba(60,40,15,.4)); }
.wwo-wield.show { display: block; }
.wwo-wield .ic { width: 100%; height: 100%; background-size: contain; background-repeat: no-repeat; background-position: center; }
`;
