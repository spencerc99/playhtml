// ABOUTME: Opt-in on-page overlay showing what the scrap collector decided about each image.
// ABOUTME: Load any page with `#wwo-scraps=debug` to outline kept, skipped and pending images with the reason.

import { injectShadow } from "../entrypoints/content/inject-ui";

export type ScrapDebugStatus = "kept" | "skipped" | "pending";

export interface ScrapDebugSink {
  note(element: Element, status: ScrapDebugStatus, reason: string): void;
  destroy(): void;
}

const DEBUG_HASH_PATTERN = /(?:^#|&)wwo-scraps=debug(?:&|$)/;

/** Whether the page address asks for the overlay: `page#wwo-scraps=debug`. */
export function scrapDebugRequested(hash: string = window.location.hash): boolean {
  return DEBUG_HASH_PATTERN.test(hash);
}

const STATUS_COLORS: Record<ScrapDebugStatus, string> = {
  kept: "#1f9d55",
  skipped: "#d64545",
  pending: "#d69e2e",
};

const CSS = `
.box {
  position: fixed;
  box-sizing: border-box;
  border: 2px solid var(--color);
  pointer-events: none;
}
.box[data-status="pending"] { border-style: dashed; }
.label {
  position: absolute;
  left: -2px;
  top: -2px;
  max-width: max(100%, 160px);
  box-sizing: border-box;
  padding: 1px 4px;
  background: var(--color);
  color: #fff;
  font: 11px/1.3 ui-monospace, Menlo, monospace;
  overflow-wrap: anywhere;
}
.legend {
  position: fixed;
  right: 12px;
  bottom: 12px;
  padding: 6px 10px;
  background: rgba(20, 20, 20, 0.85);
  color: #fff;
  font: 12px/1.5 ui-monospace, Menlo, monospace;
  border-radius: 6px;
}
.legend b { color: var(--color); font-weight: 600; }
`;

interface Note {
  status: ScrapDebugStatus;
  reason: string;
  box: HTMLDivElement;
  label: HTMLDivElement;
}

export function createScrapDebugOverlay(): ScrapDebugSink {
  const { host, shadow } = injectShadow({
    hostId: "wwo-scraps-debug",
    hostStyle:
      "position:fixed;inset:0;pointer-events:none;z-index:2147483646;",
    css: CSS,
  });
  const layer = document.createElement("div");
  const legend = document.createElement("div");
  legend.className = "legend";
  shadow.append(layer, legend);

  const notes = new Map<Element, Note>();
  let frame: number | undefined;

  const render = () => {
    frame = undefined;
    const counts: Record<ScrapDebugStatus, number> = {
      kept: 0,
      skipped: 0,
      pending: 0,
    };
    for (const [element, note] of notes) {
      if (!element.isConnected) {
        note.box.remove();
        notes.delete(element);
        continue;
      }
      counts[note.status]++;
      const bounds = element.getBoundingClientRect();
      const onScreen =
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.bottom > 0 &&
        bounds.right > 0 &&
        bounds.top < window.innerHeight &&
        bounds.left < window.innerWidth;
      note.box.style.display = onScreen ? "block" : "none";
      if (!onScreen) continue;
      note.box.style.left = `${bounds.left}px`;
      note.box.style.top = `${bounds.top}px`;
      note.box.style.width = `${bounds.width}px`;
      note.box.style.height = `${bounds.height}px`;
    }
    legend.innerHTML = (Object.keys(counts) as ScrapDebugStatus[])
      .map(
        (status) =>
          `<b style="--color:${STATUS_COLORS[status]}">${status}</b> ${counts[status]}`,
      )
      .join(" &middot; ");
  };
  const schedule = () => {
    if (frame === undefined) frame = requestAnimationFrame(render);
  };

  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window.addEventListener("resize", schedule, { passive: true });
  // Layout shifts move elements without a scroll, so redraw now and then too.
  const interval = window.setInterval(schedule, 1000);

  return {
    note(element, status, reason) {
      let note = notes.get(element);
      if (!note) {
        const box = document.createElement("div");
        box.className = "box";
        const label = document.createElement("div");
        label.className = "label";
        box.appendChild(label);
        layer.appendChild(box);
        note = { status, reason, box, label };
        notes.set(element, note);
      }
      note.status = status;
      note.reason = reason;
      note.box.dataset.status = status;
      note.box.style.setProperty("--color", STATUS_COLORS[status]);
      note.label.textContent = `${status}: ${reason}`;
      schedule();
    },
    destroy() {
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
      clearInterval(interval);
      if (frame !== undefined) cancelAnimationFrame(frame);
      notes.clear();
      host.remove();
    },
  };
}
