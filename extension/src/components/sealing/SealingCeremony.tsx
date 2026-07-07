// ABOUTME: Sealing ceremony — drag down to roll the message into a scroll, which becomes the card and
// ABOUTME: plunges into the page slot. Three.js spiral roll + Motion-driven finish; matches the on-page card.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { animate } from "motion";
import {
  CARD_W_PX,
  CARD_H_PX,
  COMMIT_FRAC,
  TEX_W,
  TEX_H,
  attachDragGesture,
  computeCardFit,
  createSlotFissure,
  playFinale,
  setupScene,
  type SealingProps,
} from "./common";

export function SealingCeremony({
  text,
  authorColor,
  slotX,
  slotY,
  onComplete,
}: SealingProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const ctx = setupScene(container, text, authorColor, slotY);
    const { vw, vh, renderer, scene, camera, texture } = ctx;

    // ============================
    // Initial view: paper fits inside the viewport at a reasonable size,
    // centered. Camera dollies out as the paper rolls + shrinks.
    // ============================
    const aspect = TEX_W / TEX_H;
    const paperH = vh * 0.72;
    const paperW = Math.min(vw * 0.55, paperH * aspect);

    const SEG_X = 4;
    const SEG_Y = 80;
    const geometry = new THREE.PlaneGeometry(paperW, paperH, SEG_X, SEG_Y);
    const flatPositions = new Float32Array(geometry.attributes.position.array);

    // Per-vertex color for gentle depth shading (set in the morph each frame).
    const vertexCount = geometry.attributes.position.count;
    const colors = new Float32Array(vertexCount * 3).fill(1);
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Front face: the message texture, multiplied by the vertex-color shading
    // so the curled part picks up subtle depth darkening too.
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.FrontSide,
      transparent: true,
      vertexColors: true,
      clippingPlanes: [],
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    mesh.position.y = 0;

    // Back face: carries the SAME message texture as the front so the wound-up
    // outer wrap shows the faint message + the author-color stripe — matching
    // the on-page capsule's "sticking out" look (text + color visible). A gentle
    // grey tint keeps it reading as the paper's underside; per-frame vertex
    // colors add depth shading as it curls. Shares the morphing geometry and is
    // a CHILD of the front mesh so it inherits every transform.
    const backMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xdedad2,
      side: THREE.BackSide,
      transparent: true,
      vertexColors: true,
      clippingPlanes: [],
    });
    const backMesh = new THREE.Mesh(geometry, backMaterial);
    mesh.add(backMesh);

    // ============================
    // Camera zoom — start at 1.0 (paper in viewport), zoom out as it shrinks
    // ============================
    const zoomOut = 0.65;
    camera.zoom = 1.0;
    camera.updateProjectionMatrix();

    // ============================
    // Shared state — rollAmount is a *single number* both the drag and
    // Motion animate after commit feed into. The morph function reads
    // this on every frame.
    // ============================
    const state = { rollAmount: 0, compressX: 0 };

    // ============================
    // Drag-to-commit
    // ============================
    let committed = false;
    const dragControl = attachDragGesture(
      container,
      vh * COMMIT_FRAC,
      (p) => {
        if (committed) return;
        state.rollAmount = p * 0.25; // drag contributes up to 25% of roll
        hint.style.opacity = p > 0.05 ? "0" : "1";
      },
      () => {
        if (committed) return;
        committed = true;
        autoRoll();
      },
    );

    // Hint banner
    const hint = document.createElement("div");
    hint.textContent = "pull down to seal ⌄";
    hint.style.cssText = [
      "position:fixed",
      "left:50%",
      "top:18px",
      "transform:translateX(-50%)",
      "font:13px/1.4 system-ui, -apple-system, sans-serif",
      "color:rgba(255,255,255,0.85)",
      "text-shadow:0 1px 2px rgba(0,0,0,0.4)",
      "background:rgba(0,0,0,0.3)",
      "padding:6px 14px",
      "border-radius:14px",
      "pointer-events:none",
      "transition:opacity 200ms ease-out",
      "z-index:10",
    ].join(";");
    container.appendChild(hint);

    const fissure = createSlotFissure(container, slotX, slotY);
    let finaleHandle: { dispose: () => void } | null = null;

    // Timers + animations scheduled by autoRoll(); stopped on unmount so an
    // aborted seal (Escape mid-ceremony) can't fire the finale or keep mutating
    // the disposed Three.js scene after teardown.
    let disposed = false;
    const pendingTimers: ReturnType<typeof setTimeout>[] = [];
    const animations: { stop: () => void }[] = [];
    const track = <T extends { stop: () => void }>(a: T): T => {
      animations.push(a);
      return a;
    };

    function autoRoll() {
      hint.style.opacity = "0";

      // 1. Auto-finish the roll with a spring
      track(
        animate(state.rollAmount, 1, {
          duration: 1.2,
          ease: [0.4, 0.0, 0.2, 1],
          onUpdate: (v) => {
            state.rollAmount = v;
          },
        }),
      );

      // 2. Subtle zoom-out as the paper rolls (already in view, so small)
      track(
        animate(camera.zoom, 0.85, {
          duration: 1.2,
          ease: [0.4, 0.0, 0.2, 1],
          onUpdate: (v) => {
            camera.zoom = v;
            camera.updateProjectionMatrix();
          },
        }),
      );

      // 3. After roll completes, measure the (now thick) rolled tube and
      //    fit it to the card: rotate to portrait if landscape, then uniform
      //    scale so the long axis = CARD_H_PX. Proportions preserved.
      pendingTimers.push(setTimeout(() => {
        if (disposed) return;
        const fit = computeCardFit(mesh);
        track(
          animate(mesh.rotation.z, fit.rotateZ, {
            duration: 0.6,
            ease: [0.4, 0.0, 0.2, 1],
            onUpdate: (v) => {
              mesh.rotation.z = v;
            },
          }),
        );
        // Non-uniform fit to the exact card box (32×64) so the landed
        // rectangle matches the on-page tinytextV card proportions.
        const fromX = mesh.scale.x;
        const fromY = mesh.scale.y;
        track(
          animate(0, 1, {
            duration: 0.7,
            ease: [0.4, 0.0, 0.2, 1],
            onUpdate: (t) => {
              mesh.scale.set(
                fromX + (fit.scaleX - fromX) * t,
                fromY + (fit.scaleY - fromY) * t,
                fromX + (fit.scaleX - fromX) * t,
              );
            },
          }),
        );
        track(
          animate(camera.zoom, zoomOut, {
            duration: 0.7,
            ease: [0.4, 0.0, 0.2, 1],
            onUpdate: (v) => {
              camera.zoom = v;
              camera.updateProjectionMatrix();
            },
          }),
        );
      }, 1200));

      // 4. Envelope seal: an author-color band snaps around the middle of the
      //    formed roll (like a wax-seal belt) — a distinct "sealing" beat before
      //    it's tucked away. Fires once the card has formed (~1.9s).
      pendingTimers.push(setTimeout(playSealBand, 1900));

      // 5. Then start the finale (after the seal beat reads).
      pendingTimers.push(setTimeout(startFinale, 2650));
    }

    // The seal band — a thin author-color belt that sweeps across the formed
    // roll's middle. DOM overlay (fixed) aligned by projecting the coil's
    // actual world bounding box to screen (the coil is NOT at the mesh origin —
    // the roll winds around the paper's top edge). Holds while the seal reads,
    // then fades as the finale lifts the bottle.
    let sealBand: HTMLDivElement | null = null;
    function playSealBand() {
      const host = containerRef.current;
      if (disposed || !host) return;
      // Project the coil's world bbox center to screen: with the orthographic
      // camera, screen = viewportCenter + world * camera.zoom (y flipped).
      mesh.updateWorldMatrix(true, true);
      const coilBox = new THREE.Box3().setFromObject(mesh);
      const c = coilBox.getCenter(new THREE.Vector3());
      const size = coilBox.getSize(new THREE.Vector3());
      const z = camera.zoom;
      const screenX = vw / 2 + c.x * z;
      const screenY = vh / 2 - c.y * z;
      const beltW = Math.max(size.x * z * 1.5, 26);
      const beltH = Math.max(size.y * z * 0.2, 7);
      const band = document.createElement("div");
      band.style.cssText = [
        "position:fixed",
        `left:${screenX}px`,
        `top:${screenY}px`,
        `width:${beltW}px`,
        `height:${beltH}px`,
        `background:${authorColor}`,
        "border-radius:1.5px",
        "box-shadow:0 1px 3px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.25)",
        // start collapsed at center, then sweep open across the card
        "transform:translate(-50%,-50%) scaleX(0)",
        "transform-origin:center center",
        "opacity:0",
        "pointer-events:none",
        "z-index:6",
        "transition:transform 280ms cubic-bezier(0.34,1.56,0.64,1), opacity 180ms ease-out",
      ].join(";");
      host.appendChild(band);
      sealBand = band;
      // next frame → animate the belt snapping into place
      requestAnimationFrame(() => {
        band.style.opacity = "1";
        band.style.transform = "translate(-50%,-50%) scaleX(1)";
      });
    }

    function startFinale() {
      if (disposed) return;
      // The seal is set — let the band fade as the bottle lifts to travel.
      if (sealBand) {
        sealBand.style.transition = "opacity 300ms ease-out";
        sealBand.style.opacity = "0";
        const band = sealBand;
        pendingTimers.push(setTimeout(() => band.remove(), 320));
        sealBand = null;
      }
      finaleHandle = playFinale({
        mesh,
        materialsToClip: [material, backMaterial],
        scene: ctx,
        slotX,
        slotY,
        fissure,
        onComplete,
      });
    }

    // ============================
    // Per-frame: re-morph geometry, render
    // ============================
    let frameId = 0;

    function renderTick() {
      if (!finaleHandle) {
        morphAccordion(
          geometry,
          flatPositions,
          state.rollAmount,
          state.compressX,
          paperW,
          paperH,
          CARD_W_PX,
          CARD_H_PX,
          SEG_X,
          SEG_Y,
        );
        // Tilt the mesh forward as it rolls so the orthographic camera can
        // SEE the coil's depth — the roll reads as coming up toward the
        // viewer rather than a flat silhouette. Eased, peaks mid-roll.
        const tilt = Math.sin(Math.min(state.rollAmount, 1) * Math.PI) * 0.5;
        mesh.rotation.x = -tilt; // negative = top tips toward camera
        renderer.render(scene, camera);
      }
      frameId = requestAnimationFrame(renderTick);
    }
    frameId = requestAnimationFrame(renderTick);

    return () => {
      disposed = true;
      for (const t of pendingTimers) clearTimeout(t);
      for (const a of animations) a.stop();
      cancelAnimationFrame(frameId);
      dragControl.dispose();
      fissure.dispose();
      finaleHandle?.dispose();
      ctx.dispose();
      geometry.dispose();
      material.dispose();
      backMaterial.dispose();
      if (hint.parentNode) hint.parentNode.removeChild(hint);
      sealBand?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "auto",
        zIndex: 2147483647,
        cursor: "grab",
        background: "rgba(0, 0, 0, 0.4)",
      }}
    />
  );
}

/**
 * Morph paper plane into accordion-rolled cylinder near the top.
 *
 * - rollAmount: 0 = flat, 1 = fully rolled
 * - compressX: 0 = paper-wide, 1 = card-wide (only matters after roll done)
 *
 * Model: spool axis is a horizontal line at paperTopY. Each row's wrap
 * angle = (paperLength_consumed_by_roll / spoolRadius), capped at 2π.
 * Rows that haven't been "consumed" yet hang flat below the spool.
 */
function morphAccordion(
  geometry: THREE.PlaneGeometry,
  flatPositions: Float32Array,
  rollAmount: number,
  compressX: number,
  paperW: number,
  paperH: number,
  cardW: number,
  cardH: number,
  SEG_X: number,
  SEG_Y: number,
): void {
  const posAttr = geometry.attributes.position;
  const arr = posAttr.array as Float32Array;
  const colAttr = geometry.attributes.color as THREE.BufferAttribute | undefined;
  const col = colAttr?.array as Float32Array | undefined;

  // How much of the paper length has been wound up
  const consumedLen = rollAmount * paperH;
  const paperTopY = paperH / 2;

  // --- Rolled-scroll model (continuous at the coil↔flat boundary) ---
  //
  // The paper hangs flat from the top. As it rolls, the TOP end coils up
  // into a spiral while the rest hangs flat below the coil. The key to no
  // gaps: the coil and the flat part must MEET with the same position AND
  // the same tangent at the boundary (arc length = consumedLen from the top).
  //
  // We build the spiral from the BOUNDARY inward toward the top edge:
  //   u = arc length measured from the boundary into the coil
  //       (u = 0 at boundary, u = consumedLen at the top edge / coil center)
  // The boundary sits at a fixed anchor; the flat paper hangs straight down
  // from it. At u = 0 the spiral is tangent to the (vertical) flat paper, so
  // there's no kink.
  //
  // Archimedean spiral wound from the outside: radius shrinks as u grows
  // (inner wraps are tighter). r(θ) = rOuter - k*θ, with θ accumulating from
  // the boundary. Arc length u ≈ rOuter*θ - k*θ²/2.
  const k = paperW / 220; // how much the coil tightens per radian
  // Outer radius scales with how much is wound (a fuller roll is fatter).
  const rOuter = Math.max(8, (paperW / 10) * Math.min(1, rollAmount * 1.2));

  // Boundary anchor: where the coil's outer edge meets the flat paper.
  // The flat paper hangs straight down from here. We place the anchor so the
  // coil sits just above the top of the flat region. The coil bulges toward
  // the camera (+z).
  const boundaryY = paperTopY - consumedLen * 0 - rOuter; // base of the coil
  const boundaryZ = 0;

  // θ from u (outside-in): u = rOuter*θ - (k/2)θ²  →  solve smaller root
  const thetaFromU = (u: number): number => {
    if (k < 1e-6) return u / rOuter;
    const disc = rOuter * rOuter - 2 * k * u;
    if (disc <= 0) return rOuter / k; // clamp at the tightest wrap
    return (rOuter - Math.sqrt(disc)) / k;
  };

  for (let i = 0; i < arr.length; i += 3) {
    const fx = flatPositions[i];
    const fy = flatPositions[i + 1];

    const distFromTop = paperTopY - fy; // 0 at top edge, paperH at bottom

    const xScale = THREE.MathUtils.lerp(1, cardW / paperW, compressX);
    const xOut = fx * xScale;

    let shade = 1;
    if (distFromTop <= consumedLen) {
      // On the coil. Arc length from the boundary inward:
      const u = consumedLen - distFromTop; // 0 at boundary, grows toward center
      const theta = thetaFromU(u);
      const r = Math.max(1.5, rOuter - k * theta);
      // Spiral wound around an axis along X, in the Y-Z plane, tangent to the
      // vertical flat paper at the boundary (θ=0 → straight up from boundary,
      // bulging toward +z / the camera).
      const yOnSpool = boundaryY + Math.sin(theta) * r;
      const zOnSpool = boundaryZ + (r - Math.cos(theta) * r) + (rOuter - r);
      arr[i] = xOut;
      arr[i + 1] = yOnSpool;
      arr[i + 2] = zOnSpool;
      // Depth shading on the curl underside.
      const facing = Math.cos(theta);
      shade = 0.72 + 0.28 * (facing * 0.5 + 0.5);
    } else {
      // Flat, hanging straight down from the boundary anchor.
      const below = distFromTop - consumedLen; // 0 at boundary, grows downward
      arr[i] = xOut;
      arr[i + 1] = boundaryY - below;
      arr[i + 2] = 0;
      // Soft contact shadow the coil casts on the paper just below it.
      if (consumedLen > 0) {
        const shadowReach = rOuter * 1.4;
        const shadowT = Math.max(0, 1 - below / shadowReach);
        shade = 1 - 0.3 * shadowT * shadowT;
      }
    }

    if (col) {
      col[i] = shade;
      col[i + 1] = shade;
      col[i + 2] = shade;
    }
  }
  if (colAttr) colAttr.needsUpdate = true;

  void cardH;
  void SEG_X;
  void SEG_Y;
  posAttr.needsUpdate = true;
  geometry.computeVertexNormals();
}
