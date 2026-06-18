// ABOUTME: Shared bits across all sealing-ceremony variants — texture drawing, Three.js scene setup,
// ABOUTME: drag-to-commit gesture, slot fissure DOM, and the post-fold finale (travel arc, plunge, fissure close).

import * as THREE from "three";

export interface SealingProps {
  text: string;
  authorColor: string;
  slotX: number;
  slotY: number;
  onComplete: () => void;
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

export function drawTextareaToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  authorColor: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  // Paper grain
  ctx.fillStyle = "rgba(0,0,0,0.012)";
  for (let i = 0; i < 800; i++) {
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }

  // Border
  ctx.strokeStyle = "#767676";
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, w - 6, h - 6);

  // Top inset
  ctx.fillStyle = "rgba(0,0,0,0.06)";
  ctx.fillRect(6, 6, w - 12, 6);

  // Author stripe
  ctx.fillStyle = authorColor;
  ctx.fillRect(0, 0, 12, h);

  // Text
  ctx.fillStyle = "#111";
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
  clipPlane: THREE.Plane;
  dispose: () => void;
}

export function setupScene(
  container: HTMLElement,
  text: string,
  authorColor: string,
  slotY: number,
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
  drawTextareaToCanvas(texCanvas, text, authorColor);
  const texture = new THREE.CanvasTexture(texCanvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

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
    clipPlane,
    dispose() {
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

  const slotSceneX = slotX - vw / 2;
  const slotSceneY = vh / 2 - slotY;
  const startTime = performance.now();
  let phase: "travel" | "plunge" | "done" = "travel";
  let plungeStart = 0;
  let frameId = 0;
  let fissureOpened = false;
  let completed = false;
  let completeTimer: ReturnType<typeof setTimeout> | null = null;

  // Travel ends with the bottle's BOTTOM edge sitting at the slot line, so
  // the whole bottle hovers visibly above the fissure right before plunge.
  const travelEndY = slotSceneY + CARD_H_PX / 2;

  // Preserve the mesh's existing rotation (computeCardFit may have rotated it
  // to portrait). The travel wobble is ADDED to this base, never overwrites it.
  const baseRotZ = mesh.rotation.z;

  const tick = () => {
    const now = performance.now();
    if (phase === "travel") {
      const t = clamp((now - startTime) / T_TRAVEL, 0, 1);
      const e = easeInOutCubic(t);
      const baseTx = THREE.MathUtils.lerp(0, slotSceneX, e);
      const baseTy = THREE.MathUtils.lerp(0, travelEndY, e);
      const arc = Math.sin(e * Math.PI) * Math.min(160, vh * 0.18);
      mesh.position.set(baseTx, baseTy + arc, 0);
      // Gentle wobble added on top of the portrait base rotation
      mesh.rotation.z = baseRotZ + Math.sin(e * Math.PI) * 0.1 * Math.sign(slotSceneX);
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
      // Descend so the bottle's bottom (currently at slot) sinks to
      // CARD_H_PX + 20 below the slot — fully under the page.
      const plungeDy = e * (CARD_H_PX + 20);
      mesh.position.set(slotSceneX, travelEndY - plungeDy, 0);
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
