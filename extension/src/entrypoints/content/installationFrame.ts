// ABOUTME: Draws the installation frame around browsing — a live cursor trace, earlier traces, and an info panel.
// ABOUTME: Renders only while installation mode is on, so ordinary browsing stays untouched.

import browser from "webextension-polyfill";
import {
  INSTALLATION_MODE_KEY,
  INSTALLATION_SOUND_KEY,
} from "../../features/installationMode";
import { PLAYER_IDENTITY_STORAGE_KEY } from "../../storage/playerIdentity";
import { injectShadow } from "./inject-ui";
import {
  createInstallationSound,
  type InstallationSound,
} from "./installationSound";
import {
  createTraceField,
  JUMP_SPLIT_FRACTION,
  STROKE_GAP_MS,
  type TracePoint,
  type TraceField,
} from "./installationTrace";

/** Cheapest useful movement resolution — skip points closer than this. */
const MIN_POINT_DISTANCE_PX = 2;

export const INSTALLATION_FRAME_HOST_ID = "wwo-installation-frame";
const PROJECT_URL = "https://wewere.online/";
const PORTRAIT_URL = "https://wewere.online/portrait/";

interface CursorEventLike {
  ts?: number;
  type?: string;
  data?: {
    x?: unknown;
    y?: unknown;
    scrollX?: unknown;
    scrollY?: unknown;
  } | null;
  meta?: { vw?: unknown; vh?: unknown } | null;
}

/**
 * Turns stored cursor events into document-space strokes, splitting wherever
 * browsing paused or the page scrolled out from under a still cursor. Events
 * carry 0-1 coordinates plus the viewport and scroll they were captured at, so
 * a mark lands back on the content it was made over.
 */
export function toPreviousStrokes(
  events: readonly CursorEventLike[],
  size: { width: number; height: number },
): TracePoint[][] {
  const number = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;

  const points = events
    .filter((event) => (event.type ?? "cursor") === "cursor")
    .map((event) => {
      const x = Number(event.data?.x);
      const y = Number(event.data?.y);
      return {
        x: x * number(event.meta?.vw, size.width) +
          number(event.data?.scrollX, 0),
        y: y * number(event.meta?.vh, size.height) +
          number(event.data?.scrollY, 0),
        t: Number(event.ts),
        inRange: x >= 0 && x <= 1 && y >= 0 && y <= 1,
      };
    })
    .filter(
      (point) =>
        point.inRange &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Number.isFinite(point.t),
    )
    .sort((first, second) => first.t - second.t);

  const maxJump = size.height * JUMP_SPLIT_FRACTION;
  const strokes: TracePoint[][] = [];
  let current: TracePoint[] = [];
  for (const point of points) {
    const last = current[current.length - 1];
    if (
      last &&
      (point.t - last.t > STROKE_GAP_MS || Math.abs(point.y - last.y) > maxJump)
    ) {
      if (current.length > 1) strokes.push(current);
      current = [];
    }
    current.push({ x: point.x, y: point.y, t: point.t });
  }
  if (current.length > 1) strokes.push(current);
  return strokes;
}

function frameCss(): string {
  return `
:host { all: initial; }
* { box-sizing: border-box; font-family: "Atkinson Hyperlegible", ui-sans-serif, system-ui, sans-serif; }
canvas { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.edge {
  position: fixed; inset: 10px; border: 1px solid var(--wwo-frame-color);
  opacity: 0.45; border-radius: 2px; pointer-events: none;
}
.caption {
  position: fixed; left: 22px; bottom: 20px; display: flex; align-items: center; gap: 8px;
  padding: 7px 13px 7px 10px; border-radius: 999px; pointer-events: none;
  background: rgba(250, 249, 246, 0.92); border: 1px solid rgba(61, 56, 51, 0.14);
  box-shadow: 0 1px 6px rgba(61, 56, 51, 0.12);
  color: #3d3833; font-size: 13px; line-height: 1.35; letter-spacing: 0.01em;
  max-width: min(64vw, 620px);
}
.caption a { pointer-events: auto; color: inherit; text-decoration-color: rgba(61, 56, 51, 0.35); text-underline-offset: 2px; }
.caption a:hover { text-decoration-color: currentColor; }
.panel h1 a { color: inherit; text-decoration: none; }
.panel h1 a:hover { text-decoration: underline; text-underline-offset: 3px; }
.swatch { width: 11px; height: 11px; border-radius: 50%; background: var(--wwo-frame-color); flex: none; }
.info {
  position: fixed; right: 22px; bottom: 20px; pointer-events: auto;
  width: 34px; height: 34px; padding: 0; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: rgba(250, 249, 246, 0.92); border: 1px solid rgba(61, 56, 51, 0.14);
  box-shadow: 0 1px 6px rgba(61, 56, 51, 0.12); color: #3d3833;
}
.info svg { width: 19px; height: 19px; display: block; }
.info:hover { background: #fff; }
.info[aria-expanded="true"] { background: #fff; border-color: rgba(61, 56, 51, 0.3); }
.panel {
  position: fixed; right: 22px; bottom: 66px; width: min(380px, 84vw); pointer-events: auto;
  padding: 20px 22px 18px; border-radius: 10px;
  background: #faf9f6; border: 1px solid rgba(61, 56, 51, 0.16);
  box-shadow: 0 10px 34px rgba(61, 56, 51, 0.2);
  color: #3d3833; font-size: 14px; line-height: 1.6;
}
.panel[hidden] { display: none; }
.panel h1 {
  margin: 0 0 10px; font-family: "Lora", Georgia, serif; font-weight: 600;
  font-size: 19px; font-style: italic; letter-spacing: 0.01em;
}
.panel p { margin: 0 0 10px; }
.panel .quiet { color: #7c746b; font-size: 12.5px; margin-bottom: 0; }
.panel a { color: #2f7f70; }
.panel .close {
  position: absolute; top: 10px; right: 12px; border: none; background: none;
  color: #8a8279; font-size: 17px; line-height: 1; padding: 4px;
}
`;
}

export function initInstallationFrame(): () => void {
  let disposed = false;
  let revision = 0;
  let mounted: {
    host: HTMLElement;
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;
    edge: HTMLElement;
    color: string;
    sound: InstallationSound;
    trace: TraceField;
  } | null = null;

  let holdStart: { x: number; y: number; t: number } | null = null;
  /** Set when the frame mounts; toggles the live sound and its button label. */
  let applySound: (on: boolean) => void = () => {};

  let previousSource: CursorEventLike[] = [];
  let frameRequest = 0;
  let frameTimer = 0;

  const report = (name: string, value: string) => {
    if (!mounted || mounted.host.getAttribute(name) === value) return;
    mounted.host.setAttribute(name, value);
  };

  const stopDrawing = () => {
    if (frameRequest) cancelAnimationFrame(frameRequest);
    if (frameTimer) clearTimeout(frameTimer);
    frameRequest = 0;
    frameTimer = 0;
  };

  const resize = () => {
    if (!mounted) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const { canvas, context } = mounted;
    mounted.sound.setWidth(window.innerWidth);
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    mounted.trace.setPrevious(
      toPreviousStrokes(previousSource, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
    );
    schedule();
  };

  const draw = () => {
    frameRequest = 0;
    if (!mounted) return;
    const { context, color, trace } = mounted;
    const nextChange = trace.draw(
      context,
      color,
      {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
      },
      Date.now(),
    );

    const drawing = trace.liveCount() > 0;
    if (drawing) mounted.sound.tick();
    else mounted.sound.idle();

    // Reported on the host so operators (and the smoke test) can read what the
    // frame is doing without opening the shadow root.
    report("data-wwo-trace", String(trace.liveCount()));
    report("data-wwo-previous", String(trace.previousCount()));
    report("data-wwo-sound", mounted.sound.state());

    // The ink holds still between fades, so the loop sleeps until the next one.
    if (nextChange === null) return;
    if (nextChange <= 0) {
      schedule();
      return;
    }
    frameTimer = window.setTimeout(() => {
      frameTimer = 0;
      schedule();
    }, nextChange);
  };

  function schedule() {
    if (disposed || !mounted || frameRequest) return;
    if (frameTimer) {
      clearTimeout(frameTimer);
      frameTimer = 0;
    }
    frameRequest = requestAnimationFrame(draw);
  }

  let lastPoint: TracePoint | null = null;
  const move = (event: PointerEvent) => {
    if (!mounted || event.pointerType === "touch") return;
    if (
      lastPoint &&
      Math.abs(lastPoint.x - event.clientX) < MIN_POINT_DISTANCE_PX &&
      Math.abs(lastPoint.y - event.clientY) < MIN_POINT_DISTANCE_PX
    ) {
      return;
    }
    const now = Date.now();
    lastPoint = { x: event.clientX, y: event.clientY, t: now };
    mounted.sound.move(event.clientX, event.clientY, event.target);
    mounted.trace.addPoint(
      event.clientX + window.scrollX,
      event.clientY + window.scrollY,
      now,
      window.innerHeight * JUMP_SPLIT_FRACTION,
    );
    schedule();
  };

  const visibility = () => {
    if (document.hidden) {
      stopDrawing();
      mounted?.sound.idle();
    } else {
      schedule();
    }
  };

  const down = (event: PointerEvent) => {
    if (!mounted || event.pointerType === "touch") return;
    holdStart = { x: event.clientX, y: event.clientY, t: Date.now() };
  };

  const up = (event: PointerEvent) => {
    if (!mounted || event.pointerType === "touch") return;
    const held = holdStart ? Date.now() - holdStart.t : 0;
    holdStart = null;
    const holdDuration = held > 250 ? held : undefined;
    mounted.sound.click(event.clientX, event.clientY, holdDuration);
    mounted.trace.addClick(
      event.clientX + window.scrollX,
      event.clientY + window.scrollY,
      holdDuration,
      Date.now(),
    );
    schedule();
  };

  const unmount = () => {
    stopDrawing();
    mounted?.trace.clear();
    lastPoint = null;
    previousSource = [];
    mounted?.sound.dispose();
    mounted?.host.remove();
    mounted = null;
    holdStart = null;
  };

  const mount = (color: string) => {
    const { host, shadow } = injectShadow({
      hostId: INSTALLATION_FRAME_HOST_ID,
      hostStyle:
        "all:initial;position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483646;",
      css: frameCss(),
      fontUrl:
        "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Lora:ital,wght@1,600&display=swap",
    });
    host.setAttribute("aria-hidden", "true");

    const canvas = document.createElement("canvas");
    const edge = document.createElement("div");
    edge.className = "edge";

    const caption = document.createElement("div");
    caption.className = "caption";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    const captionText = document.createElement("span");
    captionText.innerHTML =
      `<b>participating in <a href="${PROJECT_URL}" target="_blank" rel="noreferrer">we were online</a></b> — browse to contribute to the portrait`;
    caption.append(swatch, captionText);

    const sound = createInstallationSound(color);
    // Sound comes on with installation mode. There is no switch in the frame —
    // a visitor should not have to turn the piece on — but an operator can
    // still silence a machine by setting INSTALLATION_SOUND_KEY to false.
    applySound = (on: boolean) => sound.setEnabled(on);

    const info = document.createElement("button");
    info.type = "button";
    info.className = "info";
    info.setAttribute("aria-label", "About this installation");
    info.setAttribute("aria-expanded", "false");
    info.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
        <circle cx="12" cy="12" r="9.25" />
        <path d="M12 10.9v6.1" stroke-linecap="round" />
        <circle cx="12" cy="7.3" r="1.05" fill="currentColor" stroke="none" />
      </svg>`;

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.hidden = true;
    panel.innerHTML = `
      <button type="button" class="close" aria-label="Close">&times;</button>
      <h1><a href="${PROJECT_URL}" target="_blank" rel="noreferrer">we were online</a></h1>
      <p>This computer contributing its browsing to a collective portrait of the
        internet. Browse anywhere you like to participate.</p>
      <p class="quiet">Recorded as marks: cursor movement, clicks, scrolling,
        pages visited, and typing. Contribute from your home computer at
        <a href="${PROJECT_URL}" target="_blank" rel="noreferrer">wewere.online</a>.</p>
    `;

    const setPanelOpen = (open: boolean) => {
      panel.hidden = !open;
      info.setAttribute("aria-expanded", String(open));
    };
    info.addEventListener("click", () => setPanelOpen(panel.hidden));
    panel
      .querySelector<HTMLButtonElement>(".close")
      ?.addEventListener("click", () => setPanelOpen(false));

    shadow.append(canvas, edge, caption, info, panel);
    host.style.setProperty("--wwo-frame-color", color);
    // Only the panel and its button take pointer input; the host stays inert so
    // the page underneath keeps every click.
    const context = canvas.getContext("2d");
    if (!context) {
      sound.dispose();
      host.remove();
      return;
    }
    mounted = { host, canvas, context, edge, color, sound, trace: createTraceField() };
    resize();
    void browser.storage.local
      .get(INSTALLATION_SOUND_KEY)
      .then((stored) => {
        if (mounted?.sound === sound) {
          applySound(stored[INSTALLATION_SOUND_KEY] !== false);
        }
      })
      .catch(() => applySound(true));
  };

  const loadPrevious = async (currentRevision: number) => {
    try {
      const domain = window.location.hostname.replace(/^www\./, "");
      const response = (await browser.runtime.sendMessage({
        type: "GET_RECENT_EVENTS",
        domain,
      })) as { success?: boolean; events?: CursorEventLike[] } | undefined;
      if (disposed || currentRevision !== revision || !mounted) return;
      if (!response?.success || !Array.isArray(response.events)) return;
      previousSource = response.events;
      mounted.trace.setPrevious(
        toPreviousStrokes(previousSource, {
          width: window.innerWidth,
          height: window.innerHeight,
        }),
      );
      schedule();
    } catch {
      // Earlier traces are decoration; the live trace works without them.
    }
  };

  const refresh = async () => {
    const currentRevision = ++revision;
    try {
      const stored = await browser.storage.local.get(INSTALLATION_MODE_KEY);
      if (disposed || currentRevision !== revision) return;
      if (stored[INSTALLATION_MODE_KEY] !== true) {
        unmount();
        return;
      }
      const identity = (await browser.runtime.sendMessage({
        type: "GET_PUBLIC_PLAYER_IDENTITY",
      })) as { playerStyle?: { colorPalette?: unknown[] } } | undefined;
      if (disposed || currentRevision !== revision) return;
      const candidate = identity?.playerStyle?.colorPalette?.[0];
      const color =
        typeof candidate === "string" && CSS.supports("color", candidate)
          ? candidate
          : "#3d3833";
      if (mounted) {
        if (mounted.color === color) return;
        unmount();
      }
      mount(color);
      void loadPrevious(currentRevision);
    } catch (error) {
      if (disposed || currentRevision !== revision) return;
      unmount();
      console.error(
        "[we-were-online] Could not load installation frame:",
        error,
      );
    }
  };

  const onStorage = (
    changes: Record<string, browser.Storage.StorageChange>,
    area: string,
  ) => {
    if (
      area === "local" &&
      (changes[INSTALLATION_MODE_KEY] || changes[PLAYER_IDENTITY_STORAGE_KEY])
    ) {
      void refresh();
      return;
    }
    if (area === "local" && changes[INSTALLATION_SOUND_KEY] && mounted) {
      applySound(changes[INSTALLATION_SOUND_KEY].newValue !== false);
    }
  };

  browser.storage.onChanged.addListener(onStorage);
  document.addEventListener("pointermove", move, { capture: true, passive: true });
  document.addEventListener("pointerdown", down, { capture: true, passive: true });
  document.addEventListener("pointerup", up, { capture: true, passive: true });
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.addEventListener("resize", resize);
  window.addEventListener("pageshow", refresh);
  void refresh();

  return () => {
    disposed = true;
    revision++;
    unmount();
    browser.storage.onChanged.removeListener(onStorage);
    document.removeEventListener("pointermove", move, true);
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("pointerup", up, true);
    document.removeEventListener("visibilitychange", visibility);
    window.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", resize);
    window.removeEventListener("pageshow", refresh);
  };
}
