// ABOUTME: Shared bits across all sealing-ceremony variants — texture drawing, Three.js scene setup,
// ABOUTME: drag-to-commit gesture, slot fissure DOM, and the post-fold finale (travel arc, plunge, fissure close).

import * as THREE from "three";
import { segmentStyle } from "../bottle/segmentStyles";
import type { BottleNote } from "../../features/BottleManager";
import { rasterizeStrip } from "./rasterizeStrip";

export interface SealingProps {
  text: string;
  authorColor: string;
  slotX: number;
  slotY: number;
  /** Segment style preset id — selects the ceremony paper's painter. */
  styleId?: string;
  /** The bottle's existing notes (oldest first). When present alongside
   * `newNote`, the ceremony rasterizes the real letter-scroll DOM onto the
   * rolled paper instead of the painter-approximated look. */
  notes?: BottleNote[];
  /** The newly stamped letter as a note. Rendered at the bottom of the raster
   * strip so the seal beat shows the letter you just wrote, complete. */
  newNote?: BottleNote;
  /** The container the overlay + ceremony portal into. The ceremony measures
   * the on-screen letter-scroll strip within this container so its WebGL paper
   * mounts pixel-aligned over the strip the reader was just looking at. */
  portalContainer?: Element | null;
  /** Fires once the ceremony has measured, built, and rendered its first
   * aligned frame. The parent hides the DOM scroll on this signal so the WebGL
   * paper takes over in place with no jump. */
  onFirstFrame?: () => void;
  onComplete: () => void;
}

// ============================
// On-screen rect of the letter-scroll strip we're taking over from.
// Measured in CSS pixels, scoped to the portal container so the ceremony can
// mount its WebGL paper exactly over the strip the reader was looking at.
// ============================
export interface StripHandoffRect {
  /** The whole strip's on-screen bounding rect (may extend above the viewport
   * — content above the landed letter scrolls up offscreen, as it does on the
   * real scroll). */
  stripLeft: number;
  stripWidth: number;
  /** The landed (new) letter's on-screen segment rect — the raster's bottom
   * anchors here so the letter you just wrote stays put at handoff. */
  writeLeft: number;
  writeWidth: number;
  writeTop: number;
  writeBottom: number;
}

// Measures the visible letter-scroll strip and the landed letter's write
// segment within the portal container. Returns null if either isn't present
// (the ceremony then falls back to viewport-centered sizing).
export function measureStripHandoff(
  container: Element | null | undefined,
): StripHandoffRect | null {
  const root = container ?? document;
  const strip = root.querySelector<HTMLElement>(".mbs-strip");
  const write = root.querySelector<HTMLElement>('[data-seg="write"]');
  if (!strip || !write) return null;
  const s = strip.getBoundingClientRect();
  const w = write.getBoundingClientRect();
  if (s.width <= 0 || w.height <= 0) return null;
  return {
    stripLeft: s.left,
    stripWidth: s.width,
    writeLeft: w.left,
    writeWidth: w.width,
    writeTop: w.top,
    writeBottom: w.bottom,
  };
}

// Card target dimensions (matches the on-page mb-capsule visible portion)
export const CARD_W_PX = 32;
export const CARD_H_PX = 64;

// Drag-to-commit gesture
export const COMMIT_FRAC = 0.2; // pull down 20% of viewport to commit

// Finale timing (post-fold)
export const T_TRAVEL = 1400;
export const T_PLUNGE = 1100;
export const T_FISSURE_CLOSE = 700;

// ============================
// Fit a folded/rolled mesh to the on-page card.
// Measures the mesh's current bounding box (in its local space, accounting
// for child transforms via updateWorldMatrix) and returns the uniform scale
// + z-rotation that lands it as a CARD_W_PX × CARD_H_PX portrait rectangle.
// ============================
export function computeCardFit(mesh: THREE.Object3D): {
  scaleX: number;
  scaleY: number;
  scale: number; // uniform fallback (long axis → card height)
  rotateZ: number;
} {
  mesh.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  box.getSize(size);
  const w = Math.max(size.x, 0.001);
  const h = Math.max(size.y, 0.001);

  // Land the object as the on-page card's exact proportions: CARD_W_PX wide
  // × CARD_H_PX tall (1:2 portrait). The object's LONG axis becomes the card
  // height; its SHORT axis becomes the card width. If currently landscape
  // (w > h) we rotate 90° so the long axis goes vertical first.
  const isLandscape = w > h;
  const longAxis = Math.max(w, h);
  const shortAxis = Math.min(w, h);

  // After a 90° rotation (when landscape), the object's local x maps to
  // screen-y and vice versa. We compute scales in the object's LOCAL frame:
  //   - the axis that ends up vertical (longAxis) → CARD_H_PX
  //   - the axis that ends up horizontal (shortAxis) → CARD_W_PX
  const longScale = CARD_H_PX / longAxis;
  const shortScale = CARD_W_PX / shortAxis;

  // Map back to local x/y. If landscape: local x is the long axis (w),
  // so scaleX uses longScale; local y (h, short) uses shortScale.
  // If portrait: local y is the long axis.
  const scaleX = isLandscape ? longScale : shortScale;
  const scaleY = isLandscape ? shortScale : longScale;

  return {
    scaleX,
    scaleY,
    scale: longScale,
    rotateZ: isLandscape ? Math.PI / 2 : 0,
  };
}

// ============================
// Texture: draw the textarea visually onto a 2D canvas
// ============================
export const TEX_W = 1024;
export const TEX_H = 1280;

export interface DrawTextareaOptions {
  // The seal beat marks the moment the card is bound — the trim and tiny
  // letter overlay only appear once that's happened, not on the paper before.
  sealed?: boolean;
  /** Segment style preset id — selects the ceremony paper's painter. */
  styleId?: string;
}

// Lorem-ipsum-derived filler for the "tiny writing" overlay, matching the
// on-page filled bottle's TinyTextVerticalArt columns (see MessageBottle.tsx).
const TINY_TEXT_COLUMNS = [
  "loremipsumdolorsitametconsec",
  "teturadipiscingelitseddoeius",
  "modtemporincididuntutlabore",
  "etdoloremagnaaliquautenima",
  "dminimveniamquisnostrudexer",
];

// The visible face of the fully-rolled card is a fixed band measured from the
// paper's BOTTOM edge — because the coil's radius depends only on paper WIDTH
// (rOuter = paperW/10 in morphAccordion), the outer wrap that ends up facing
// the camera sits a fixed distance from the bottom in WIDTH units, independent
// of how tall the paper is. These fractions-of-width were derived from the
// original 0.8-aspect tuning (band y 0.64–0.86 and trim 0.822–0.858 of a canvas
// whose H = 1.25·W): distance-from-bottom d = (1 − yFrac)·1.25 in width units.
const TINY_BAND_TOP_D = 0.45; // (1 − 0.64)·1.25 — farthest wrap still visible
const TINY_BAND_BOTTOM_D = 0.175; // (1 − 0.86)·1.25 — nearest wrap
const TRIM_TOP_D = 0.2225; // (1 − 0.822)·1.25
const TRIM_BOTTOM_D = 0.1775; // (1 − 0.858)·1.25

// Draws faint tiny apparent-letters into the canvas band that ends up as the
// landed card's visible face (see drawSealedMarks). The band is positioned by
// distance from the canvas BOTTOM in WIDTH units so it lands correctly at any
// paper aspect. Glyphs are drawn large so they land at the on-page art's ~3px
// scale after the card compresses the canvas.
function drawTinyTextColumns(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const bandTop = h - TINY_BAND_TOP_D * w;
  const bandBottom = h - TINY_BAND_BOTTOM_D * w;
  const fontPx = 42;
  const rowStep = 48;
  const charStep = 56;
  ctx.font = `${fontPx}px ui-monospace, "SFMono-Regular", Menlo, monospace`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(42,42,42,0.55)";
  let row = 0;
  for (let y = Math.max(0, bandTop); y + fontPx <= bandBottom; y += rowStep, row++) {
    const src = TINY_TEXT_COLUMNS[row % TINY_TEXT_COLUMNS.length];
    let i = 0;
    for (let x = 20; x < w - 20; x += charStep, i++) {
      ctx.fillText(src[i % src.length], x, y);
    }
  }
}

// Draws the sealed marks — the tiny apparent-letters band and the author-color
// trim slice — onto whatever ground the canvas already holds. Split out from
// drawTextareaToCanvas so the seal beat can composite these ON TOP of a cached
// ground (painter OR raster) rather than re-running the painter path.
//
// The marks land on the card's visible outer-wrap face, positioned by distance
// from the canvas BOTTOM in WIDTH units so they stay correct at any paper aspect
// (the raster strip is much taller than the old fixed 0.8 texture). The landed
// card then reads like the on-page filled bottle (.mb-authorStripe +
// TinyTextVerticalArt in MessageBottle).
export function drawSealedMarks(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  authorColor: string,
): void {
  drawTinyTextColumns(ctx, w, h);
  const trimTop = h - TRIM_TOP_D * w;
  const trimH = (TRIM_TOP_D - TRIM_BOTTOM_D) * w;
  ctx.fillStyle = authorColor;
  ctx.fillRect(0, trimTop, w, trimH);
}

// Copies a rasterized letter-strip canvas onto the ground canvas, which has
// already been resized to the raster's exact dimensions (see the raster-landing
// block in setupScene). The raster IS the ground now — a 1:1 blit — so the
// ceremony paper is as tall as the real scroll it shows, no crop, no letterbox.
export function drawRasterToCanvas(
  canvas: HTMLCanvasElement,
  raster: HTMLCanvasElement,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(raster, 0, 0, canvas.width, canvas.height);
}

// Paints the full ceremony texture (ground + optional seal trim + message
// text) onto the canvas. The ground painter may need an async asset (e.g. the
// web1 broider border), in which case it returns a Promise; the returned
// Promise resolves once that late ground art has been drawn, so callers know
// to flag the Three.js texture for re-upload. Returns undefined for the common
// synchronous case.
export function drawTextareaToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  authorColor: string,
  opts: DrawTextareaOptions = {},
): Promise<void> | void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  const style = segmentStyle(opts.styleId);
  const groundPromise = style.ceremony.paintGround(ctx, w, h);

  if (opts.sealed) {
    drawSealedMarks(ctx, w, h, authorColor);
  }

  // Text
  ctx.fillStyle = style.ceremony.ink;
  const padX = 60;
  const padY = 60;
  const fontPx = 42;
  ctx.font = `${fontPx}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = "top";

  const maxWidth = w - padX * 2;
  const lineHeight = fontPx * 1.45;
  const words = text.split(/\s+/);
  let line = "";
  let y = padY;
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth) {
      ctx.fillText(line, padX, y);
      y += lineHeight;
      line = word;
      if (y + lineHeight > h - padY) break;
    } else {
      line = test;
    }
  }
  if (y + lineHeight <= h - padY) ctx.fillText(line, padX, y);

  return groundPromise ?? undefined;
}

// ============================
// Scene setup
// ============================
export interface SceneContext {
  vw: number;
  vh: number;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  texture: THREE.CanvasTexture;
  texCanvas: HTMLCanvasElement;
  clipPlane: THREE.Plane;
  /** Composites the sealed marks (author trim + tiny-text band) over the
   * CURRENT ground — painter or raster, whichever the canvas holds — and flags
   * the texture. The ground is cached so this can be called after the raster
   * has replaced the painted content. */
  redrawSealed: () => void;
  /** Registers a callback fired when the rasterized real strip lands and the
   * texture canvas is resized to its aspect. The ceremony rebuilds the flat
   * paper plane to this aspect so the roll winds up the whole visible scroll,
   * not just the fixed-box crop. Called at most once, with height/width. */
  onRasterAspect: (cb: (aspect: number) => void) => void;
  dispose: () => void;
}

// Options carrying the raster inputs — when both notes and newNote are present,
// the scene rasterizes the real letter-scroll DOM and swaps it onto the texture
// once ready, replacing the painter ground.
export interface SetupSceneRasterOptions {
  notes?: BottleNote[];
  newNote?: BottleNote;
}

export function setupScene(
  container: HTMLElement,
  text: string,
  authorColor: string,
  slotY: number,
  styleId?: string,
  rasterOpts: SetupSceneRasterOptions = {},
): SceneContext {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(
    -vw / 2,
    vw / 2,
    vh / 2,
    -vh / 2,
    -1000,
    1000,
  );
  camera.position.z = 500;

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
  });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(vw, vh);
  renderer.setClearColor(0x000000, 0);
  renderer.localClippingEnabled = true;
  container.appendChild(renderer.domElement);

  const texCanvas = document.createElement("canvas");
  texCanvas.width = TEX_W;
  texCanvas.height = TEX_H;
  // Guards the async ground repaint: if the scene is torn down (Escape mid-
  // ceremony) before a late border image resolves, we must not touch the
  // disposed texture.
  let disposed = false;
  // No stripe yet — the trim only appears once the seal band beat fires
  // (see playSealBand in SealingCeremony.tsx), so the plain paper and roll
  // carry no color trim. The ground may finish asynchronously (web1's broider
  // border); when it does, flag the texture so the late art pops onto the roll.
  const groundPromise = drawTextareaToCanvas(texCanvas, text, authorColor, { styleId });
  const texture = new THREE.CanvasTexture(texCanvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  // Offscreen mirror of the current GROUND (painter output or, once ready, the
  // rasterized strip) with no sealed marks. The seal beat composites its marks
  // over a fresh copy of this, so redrawing sealed doesn't have to re-run the
  // painter path — which would erase the raster.
  const groundCanvas = document.createElement("canvas");
  groundCanvas.width = TEX_W;
  groundCanvas.height = TEX_H;
  const groundCtx = groundCanvas.getContext("2d");
  const texCtx = texCanvas.getContext("2d");
  // Seed the ground mirror from the painter output already on the texture.
  groundCtx?.drawImage(texCanvas, 0, 0);

  // Track whether the seal beat has fired so a late ground/raster swap can
  // re-apply the sealed marks (the belt may snap before the raster resolves).
  let sealed = false;
  // Blits the current GROUND onto the texture (matching its current size), then
  // composites the sealed marks if the seal beat has fired. The ground never
  // carries marks, so this is idempotent and safe to call after the raster has
  // replaced the painter art or resized the canvas.
  const paintTextureFromGround = () => {
    if (texCtx && groundCtx) {
      const cw = texCanvas.width;
      const ch = texCanvas.height;
      texCtx.clearRect(0, 0, cw, ch);
      texCtx.drawImage(groundCanvas, 0, 0);
      if (sealed) drawSealedMarks(texCtx, cw, ch, authorColor);
    }
    if (!disposed) texture.needsUpdate = true;
  };
  const redrawSealed = () => {
    sealed = true;
    paintTextureFromGround();
  };

  // Once the rasterized real strip lands it owns the ground; a late painter
  // repaint (web1 border) must not clobber it.
  let rasterLanded = false;

  // The ceremony rebuilds its plane to the raster's aspect when it lands; hold
  // the callback (fired at most once, after resize).
  let rasterAspectCb: ((aspect: number) => void) | null = null;
  let pendingRasterAspect: number | null = null;
  const onRasterAspect = (cb: (aspect: number) => void) => {
    rasterAspectCb = cb;
    // If the raster already landed before the ceremony registered, replay it.
    if (pendingRasterAspect !== null) cb(pendingRasterAspect);
  };

  if (groundPromise) {
    void groundPromise.then(() => {
      if (disposed) return;
      // The late painter art (web1 border) is only the ground when the raster
      // hasn't already replaced it. If the raster landed first, its ground wins
      // — don't overwrite it with the stale painter art.
      if (!rasterLanded) {
        groundCtx?.clearRect(0, 0, texCanvas.width, texCanvas.height);
        groundCtx?.drawImage(texCanvas, 0, 0);
        paintTextureFromGround();
      }
    });
  }

  // Kick off rasterizing the real letter-scroll DOM. When it resolves, the
  // raster IS the ground: resize the texture + ground canvases to the raster's
  // own dimensions (its full height, so the ceremony paper is as tall as the
  // real scroll), blit the raster in, and tell the ceremony the new aspect so
  // it rebuilds the flat plane. Then repaint, re-applying sealed marks if the
  // seal beat already fired.
  if (rasterOpts.notes && rasterOpts.newNote) {
    void rasterizeStrip(rasterOpts.notes, rasterOpts.newNote, TEX_W).then(
      (raster) => {
        if (disposed || !raster || !groundCtx || !texCtx) return;
        rasterLanded = true;
        texCanvas.width = raster.width;
        texCanvas.height = raster.height;
        groundCanvas.width = raster.width;
        groundCanvas.height = raster.height;
        drawRasterToCanvas(groundCanvas, raster);
        paintTextureFromGround();
        const aspect = raster.width / raster.height;
        pendingRasterAspect = aspect;
        rasterAspectCb?.(aspect);
      },
    );
  }

  // Slot clipping plane (used during plunge to cut off below the slot line)
  const slotSceneY = vh / 2 - slotY;
  const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -slotSceneY);

  return {
    vw,
    vh,
    renderer,
    scene,
    camera,
    texture,
    texCanvas,
    clipPlane,
    redrawSealed,
    onRasterAspect,
    dispose() {
      disposed = true;
      renderer.dispose();
      texture.dispose();
      if (renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    },
  };
}

// ============================
// Drag-to-commit gesture
// ============================
export interface DragGesture {
  /** 0..1 — how far past the commit threshold the user has dragged. */
  progress: number;
  /** True once the user has crossed the commit threshold. */
  committed: boolean;
  dispose: () => void;
}

export function attachDragGesture(
  container: HTMLElement,
  threshold: number,
  onProgress: (progress: number) => void,
  onCommit: () => void,
): { dispose: () => void } {
  let dragging = false;
  let startY = 0;
  let committed = false;

  const onPointerDown = (e: PointerEvent) => {
    if (committed) return;
    dragging = true;
    startY = e.clientY;
    try {
      (e.target as Element).setPointerCapture?.(e.pointerId);
    } catch {
      // ignore
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!dragging || committed) return;
    const dy = Math.max(0, e.clientY - startY);
    const progress = Math.min(1, dy / threshold);
    onProgress(progress);
    if (progress >= 1) {
      committed = true;
      dragging = false;
      onCommit();
    }
  };
  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    if (!committed) onProgress(0); // snap back
  };

  container.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  return {
    dispose() {
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    },
  };
}

// ============================
// Slot fissure (CSS — structural, no color)
// ============================
export function createSlotFissure(
  container: HTMLElement,
  slotX: number,
  slotY: number,
): {
  open: () => void;
  close: () => void;
  dispose: () => void;
} {
  const fissureBaseW = Math.max(CARD_W_PX * 2.4, 80);
  const fissure = document.createElement("div");
  fissure.style.cssText = [
    "position:fixed",
    `left:${slotX}px`,
    `top:${slotY}px`,
    "transform:translate(-50%, -50%) scaleY(0)",
    `width:${fissureBaseW}px`,
    "height:3px",
    "background:linear-gradient(to right,transparent 0%,rgba(20,15,10,0.06) 12%,rgba(20,15,10,0.62) 38%,rgba(20,15,10,0.78) 50%,rgba(20,15,10,0.62) 62%,rgba(20,15,10,0.06) 88%,transparent 100%)",
    "filter:blur(0.4px)",
    "opacity:0",
    "pointer-events:none",
    "z-index:5",
    "transform-origin:center center",
    "transition:transform 350ms cubic-bezier(0.4,0,0.6,1), opacity 350ms ease-out",
  ].join(";");
  container.appendChild(fissure);

  return {
    open() {
      fissure.style.opacity = "1";
      fissure.style.transform = "translate(-50%, -50%) scaleY(1.6)";
    },
    close() {
      fissure.style.transition = `transform ${T_FISSURE_CLOSE}ms cubic-bezier(0.6,0,0.4,1), opacity ${T_FISSURE_CLOSE}ms ease-in`;
      fissure.style.transform = "translate(-50%, -50%) scaleY(0)";
      fissure.style.opacity = "0";
    },
    dispose() {
      if (fissure.parentNode) fissure.parentNode.removeChild(fissure);
    },
  };
}

// ============================
// Finale: travel arc + plunge into slot. Identical across variants.
// Each variant supplies the rolled "card mesh" (a Three.js Object3D),
// already positioned at scene origin and sized to the final card.
// ============================
export interface FinaleHandles {
  mesh: THREE.Object3D;
  materialsToClip: THREE.Material[];
  scene: SceneContext;
  slotX: number;
  slotY: number;
  fissure: ReturnType<typeof createSlotFissure>;
  onComplete: () => void;
}

export function playFinale(handles: FinaleHandles): { dispose: () => void } {
  const { mesh, materialsToClip, scene, slotX, slotY, fissure, onComplete } =
    handles;
  const { vw, vh, renderer, scene: threeScene, camera, clipPlane } = scene;

  // Slot position in WORLD units. The orthographic camera maps world → screen
  // as screen = viewportCenter + world * camera.zoom, so converting the slot's
  // CSS-pixel position into world space must divide by the CURRENT zoom (the
  // camera has dollied out to ~0.65 by finale time — ignoring it made the card
  // travel only 65% of the way to the fissure).
  const zoom = camera.zoom;
  const slotWorldX = (slotX - vw / 2) / zoom;
  const slotWorldY = (vh / 2 - slotY) / zoom;

  // The visible coil is NOT centered on the mesh origin (the roll winds around
  // the paper's top edge, and the card-fit scale/rotation preserves that
  // offset). Measure the coil's world bounding box and correct every target by
  // the offset so the BOTTLE — not the mesh origin — lands on the slot.
  mesh.updateWorldMatrix(true, true);
  mesh.traverse((o) => {
    (o as THREE.Mesh).geometry?.computeBoundingBox?.();
  });
  const coilBox = new THREE.Box3().setFromObject(mesh);
  const coilCenter = coilBox.getCenter(new THREE.Vector3());
  const coilH = Math.max(coilBox.max.y - coilBox.min.y, 1);
  const corrX = coilCenter.x - mesh.position.x;
  const corrY = coilCenter.y - mesh.position.y;

  const targetX = slotWorldX - corrX;
  // Travel ends with the coil's BOTTOM edge sitting at the slot line, so the
  // whole bottle hovers visibly above the fissure right before plunge.
  const travelEndY = slotWorldY + coilH / 2 - corrY;

  // The card may have formed away from the scene origin — the in-place handoff
  // starts the paper over the on-screen strip, not centered. Travel lerps from
  // wherever the card currently sits so it doesn't snap to origin first.
  const startX = mesh.position.x;
  const startY = mesh.position.y;

  // Keep the slot clipping plane on the zoom-corrected slot line (it was set
  // at scene setup assuming zoom = 1).
  clipPlane.constant = -slotWorldY;

  const startTime = performance.now();
  let phase: "travel" | "plunge" | "done" = "travel";
  let plungeStart = 0;
  let frameId = 0;
  let fissureOpened = false;
  let completed = false;
  let completeTimer: ReturnType<typeof setTimeout> | null = null;

  // Preserve the mesh's existing rotation (computeCardFit may have rotated it
  // to portrait). The travel wobble is ADDED to this base, never overwrites it.
  const baseRotZ = mesh.rotation.z;

  const tick = () => {
    const now = performance.now();
    if (phase === "travel") {
      const t = clamp((now - startTime) / T_TRAVEL, 0, 1);
      const e = easeInOutCubic(t);
      const baseTx = THREE.MathUtils.lerp(startX, targetX, e);
      const baseTy = THREE.MathUtils.lerp(startY, travelEndY, e);
      const arc = Math.sin(e * Math.PI) * Math.min(160, vh * 0.18);
      mesh.position.set(baseTx, baseTy + arc, 0);
      // Gentle wobble added on top of the portrait base rotation
      mesh.rotation.z = baseRotZ + Math.sin(e * Math.PI) * 0.1 * Math.sign(targetX);
      if (t >= 1) {
        phase = "plunge";
        plungeStart = now;
        // Activate clipping on materials (cuts off anything below the slot line)
        for (const m of materialsToClip) {
          (m as THREE.Material & { clippingPlanes: THREE.Plane[] }).clippingPlanes = [clipPlane];
          m.needsUpdate = true;
        }
        if (!fissureOpened) {
          fissureOpened = true;
          fissure.open();
        }
      }
    } else if (phase === "plunge") {
      const t = clamp((now - plungeStart) / T_PLUNGE, 0, 1);
      const e = easeInQuad(t);
      // Descend so the bottle's bottom (currently at slot) sinks fully under
      // the page (coil height + a screen-space margin, converted to world).
      const plungeDy = e * (coilH + 24 / zoom);
      mesh.position.set(targetX, travelEndY - plungeDy, 0);
      if (t >= 1) {
        phase = "done";
        fissure.close();
        if (!completed) {
          completed = true;
          completeTimer = setTimeout(onComplete, T_FISSURE_CLOSE + 100);
        }
      }
    }
    renderer.render(threeScene, camera);
    if (phase !== "done") frameId = requestAnimationFrame(tick);
  };
  frameId = requestAnimationFrame(tick);

  return {
    dispose() {
      cancelAnimationFrame(frameId);
      // Cancel the deferred onComplete so teardown during the fissure-close
      // window doesn't call back into an unmounted React tree.
      if (completeTimer !== null) clearTimeout(completeTimer);
    },
  };
}

// ============================
// Eases
// ============================
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
export function easeInQuad(t: number): number {
  return t * t;
}
export function easeOutQuart(t: number): number {
  return 1 - Math.pow(1 - t, 4);
}
