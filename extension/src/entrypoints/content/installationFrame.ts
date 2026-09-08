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

/** How long a live stroke stays on screen before it finishes fading out. */
const TRAIL_MS = 9000;
/** Cap on retained live points; older points drop first. */
const MAX_LIVE_POINTS = 1200;
/** Gap that separates one earlier stroke from the next. */
const STROKE_GAP_MS = 1200;
/** Cheapest useful movement resolution — skip points closer than this. */
const MIN_POINT_DISTANCE_PX = 2;

export const INSTALLATION_FRAME_HOST_ID = "wwo-installation-frame";
const PROJECT_URL = "https://wewere.online/";
const PORTRAIT_URL = "https://wewere.online/portrait/";

export interface TracePoint {
  x: number;
  y: number;
  t: number;
}

interface CursorEventLike {
  ts?: number;
  type?: string;
  data?: { x?: unknown; y?: unknown; event?: unknown } | null;
}

/**
 * Turns stored cursor events into viewport-space strokes, splitting wherever
 * browsing paused. Events carry 0-1 normalized coordinates, so they rescale to
 * whatever viewport the installation machine is running at.
 */
export function toPreviousStrokes(
  events: readonly CursorEventLike[],
  size: { width: number; height: number },
): TracePoint[][] {
  const points = events
    .filter((event) => (event.type ?? "cursor") === "cursor")
    .map((event) => ({
      x: Number(event.data?.x),
      y: Number(event.data?.y),
      t: Number(event.ts),
    }))
    .filter(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        Number.isFinite(point.t) &&
        point.x >= 0 &&
        point.x <= 1 &&
        point.y >= 0 &&
        point.y <= 1,
    )
    .sort((first, second) => first.t - second.t);

  const strokes: TracePoint[][] = [];
  let current: TracePoint[] = [];
  let previousTime = 0;
  for (const point of points) {
    if (current.length > 0 && point.t - previousTime > STROKE_GAP_MS) {
      if (current.length > 1) strokes.push(current);
      current = [];
    }
    current.push({
      x: point.x * size.width,
      y: point.y * size.height,
      t: point.t,
    });
    previousTime = point.t;
  }
  if (current.length > 1) strokes.push(current);
  return strokes;
}

/** Opacity of a live point, from solid at capture to zero at TRAIL_MS. */
export function liveAlpha(age: number): number {
  if (age <= 0) return 1;
  if (age >= TRAIL_MS) return 0;
  return 1 - age / TRAIL_MS;
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
.swatch { width: 11px; height: 11px; border-radius: 50%; background: var(--wwo-frame-color); flex: none; }
.info {
  position: fixed; right: 22px; bottom: 20px; pointer-events: auto;
  padding: 7px 15px; border-radius: 999px;
  background: rgba(250, 249, 246, 0.92); border: 1px solid rgba(61, 56, 51, 0.14);
  box-shadow: 0 1px 6px rgba(61, 56, 51, 0.12);
  color: #3d3833; font-size: 13px; font-family: inherit;
}
.info:hover { background: #fff; }
.info.sound { right: 122px; }
.panel {
  position: fixed; right: 22px; bottom: 64px; width: min(380px, 84vw); pointer-events: auto;
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
  } | null = null;

  let holdStart: { x: number; y: number; t: number } | null = null;
  /** Set when the frame mounts; toggles the live sound and its button label. */
  let applySound: (on: boolean) => void = () => {};

  let livePoints: TracePoint[] = [];
  let previousStrokes: TracePoint[][] = [];
  let previousSource: CursorEventLike[] = [];
  let frameRequest = 0;

  const report = (name: string, value: string) => {
    if (!mounted || mounted.host.getAttribute(name) === value) return;
    mounted.host.setAttribute(name, value);
  };

  const stopDrawing = () => {
    if (!frameRequest) return;
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
  };

  const resize = () => {
    if (!mounted) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const { canvas, context } = mounted;
    mounted.sound.setWidth(window.innerWidth);
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    previousStrokes = toPreviousStrokes(previousSource, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    schedule();
  };

  const draw = () => {
    frameRequest = 0;
    if (!mounted) return;
    const { context, color } = mounted;
    const now = Date.now();
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // Earlier browsing on this site, held faintly under the live stroke.
    context.save();
    context.globalAlpha = 0.16;
    context.strokeStyle = color;
    context.lineWidth = 1.25;
    context.lineJoin = "round";
    context.lineCap = "round";
    for (const stroke of previousStrokes) {
      context.beginPath();
      context.moveTo(stroke[0].x, stroke[0].y);
      for (let index = 1; index < stroke.length; index += 1) {
        context.lineTo(stroke[index].x, stroke[index].y);
      }
      context.stroke();
    }
    context.restore();

    // Live trace: one fading segment per movement step.
    livePoints = livePoints.filter((point) => now - point.t < TRAIL_MS);
    context.save();
    context.strokeStyle = color;
    context.lineJoin = "round";
    context.lineCap = "round";
    for (let index = 1; index < livePoints.length; index += 1) {
      const from = livePoints[index - 1];
      const to = livePoints[index];
      const alpha = liveAlpha(now - to.t);
      if (alpha <= 0.01) continue;
      context.globalAlpha = alpha;
      context.lineWidth = 1.5 + alpha * 2.5;
      context.beginPath();
      context.moveTo(from.x, from.y);
      context.lineTo(to.x, to.y);
      context.stroke();
    }
    context.restore();

    mounted.sound.tick();
    // Reported on the host so operators (and the smoke test) can read what the
    // frame is doing without opening the shadow root.
    report("data-wwo-trace", String(livePoints.length));
    report("data-wwo-previous", String(previousStrokes.length));
    report("data-wwo-sound", mounted.sound.state());
    if (livePoints.length > 0) schedule();
    else mounted.sound.idle();
  };

  function schedule() {
    if (disposed || !mounted || frameRequest) return;
    frameRequest = requestAnimationFrame(draw);
  }

  const move = (event: PointerEvent) => {
    if (!mounted || event.pointerType === "touch") return;
    const last = livePoints[livePoints.length - 1];
    if (
      last &&
      Math.abs(last.x - event.clientX) < MIN_POINT_DISTANCE_PX &&
      Math.abs(last.y - event.clientY) < MIN_POINT_DISTANCE_PX
    ) {
      return;
    }
    mounted.sound.move(event.clientX, event.clientY, event.target);
    livePoints.push({ x: event.clientX, y: event.clientY, t: Date.now() });
    if (livePoints.length > MAX_LIVE_POINTS) {
      livePoints = livePoints.slice(-MAX_LIVE_POINTS);
    }
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
    mounted.sound.click(
      event.clientX,
      event.clientY,
      held > 250 ? held : undefined,
    );
  };

  const unmount = () => {
    stopDrawing();
    livePoints = [];
    previousStrokes = [];
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
      "<b>participating in we were online</b> — browse to draw in the portrait";
    caption.append(swatch, captionText);

    const sound = createInstallationSound(color);
    const soundButton = document.createElement("button");
    soundButton.type = "button";
    soundButton.className = "info sound";
    applySound = (on: boolean) => {
      sound.setEnabled(on);
      soundButton.textContent = on ? "sound on" : "sound off";
    };
    soundButton.addEventListener("click", () => {
      const next = soundButton.textContent !== "sound on";
      applySound(next);
      void browser.storage.local
        .set({ [INSTALLATION_SOUND_KEY]: next })
        .catch(() => undefined);
    });

    const info = document.createElement("button");
    info.type = "button";
    info.className = "info";
    info.textContent = "about this";

    const panel = document.createElement("div");
    panel.className = "panel";
    panel.hidden = true;
    panel.innerHTML = `
      <button type="button" class="close" aria-label="Close">&times;</button>
      <h1>we were online</h1>
      <p>This computer is part of an installation by Spencer Chang. Browse
        anywhere you like — your cursor draws itself as you go, and the marks
        you make join the portraits on the screens around you.</p>
      <p>The faint lines underneath are earlier traces left on this site, and
        the tones you hear are your own movement, played the way the screens
        play it.</p>
      <p class="quiet">Recorded as marks: cursor movement, clicks, scrolling,
        the pages visited, and typing rhythm in text boxes (characters are
        masked). The live portrait is at <a href="${PORTRAIT_URL}"
        target="_blank" rel="noreferrer">wewere.online/portrait</a>, and you can
        take the whole thing home from <a href="${PROJECT_URL}" target="_blank"
        rel="noreferrer">wewere.online</a>.</p>
    `;

    const setPanelOpen = (open: boolean) => {
      panel.hidden = !open;
      info.textContent = open ? "hide" : "about this";
    };
    info.addEventListener("click", () => setPanelOpen(panel.hidden));
    panel
      .querySelector<HTMLButtonElement>(".close")
      ?.addEventListener("click", () => setPanelOpen(false));

    shadow.append(canvas, edge, caption, soundButton, info, panel);
    host.style.setProperty("--wwo-frame-color", color);
    // Only the panel and its button take pointer input; the host stays inert so
    // the page underneath keeps every click.
    const context = canvas.getContext("2d");
    if (!context) {
      sound.dispose();
      host.remove();
      return;
    }
    mounted = { host, canvas, context, edge, color, sound };
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
      previousStrokes = toPreviousStrokes(previousSource, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
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
    window.removeEventListener("resize", resize);
    window.removeEventListener("pageshow", refresh);
  };
}
