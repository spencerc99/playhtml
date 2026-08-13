// ABOUTME: Runs the cinder-block experiment with Matter.js physics and PlayHTML state.
// ABOUTME: Publishes locally controlled blocks at a throttled rate while interpolating remote motion.
// ABOUTME: Captures shared site-diary snapshots with a cooldown so the gallery stays sparse.

import Matter from "matter-js";
import { playhtml } from "playhtml";
import "./cinderblock.css";
import {
  BLOCK_HEIGHT,
  BLOCK_WIDTH,
  SNAPSHOT_CAPTURE_SCALE,
  SNAPSHOT_JPEG_QUALITY,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  applySnapshotToDraft,
  canSaveSnapshot,
  createBlock,
  createDefaultYard,
  createSnapshotRecord,
  formatCooldown,
  getChangedTransforms,
  getSnapshotCooldownRemainingMs,
  interpolateTransform,
  listSnapshotsNewestFirst,
  roundTransform,
} from "./model";

const {
  Bodies,
  Body,
  Composite,
  Engine,
  Sleeping,
  Vector,
} = Matter;

const FIXED_TIMESTEP_MS = 1000 / 60;
const SYNC_INTERVAL_MS = 80;
const STILLNESS_WINDOW_MS = 500;
const MOVING_SPEED = 0.05;
const MOVING_ANGULAR_SPEED = 0.002;
const MAX_LINEAR_SPEED = 12;
const MAX_ANGULAR_SPEED = 0.12;
const REMOTE_INTERPOLATION_SPEED = 36;
const REMOTE_POSITION_SNAP_DISTANCE = 0.1;
const REMOTE_ANGLE_SNAP_DISTANCE = 0.001;

function requireElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required #${id} element`);
  return element;
}

function validateYardData(data) {
  if (!data || typeof data !== "object" || !data.blocks) {
    throw new Error("Cinderblock Yard requires a keyed blocks object");
  }
}

class CinderblockYard {
  constructor({ board, layer, frame, status, gallery, saveButton, saveStatus }) {
    this.board = board;
    this.layer = layer;
    this.frame = frame;
    this.status = status;
    this.gallery = gallery;
    this.saveButton = saveButton;
    this.saveStatus = saveStatus;
    this.engine = Engine.create({ enableSleeping: true });
    this.engine.gravity.y = 1.08;
    this.bodies = new Map();
    this.elements = new Map();
    this.remoteTargets = new Map();
    this.selectedId = null;
    this.pendingSelectionId = null;
    this.draggedBody = null;
    this.dragOffset = null;
    this.dragPointerId = null;
    this.getData = null;
    this.setData = null;
    this.lastPublished = {};
    this.locallyControlledIds = new Set();
    this.lastMotionAt = 0;
    this.lastSyncAt = 0;
    this.previousFrameAt = 0;
    this.accumulator = 0;
    this.animationFrame = null;
    this.resizeObserver = null;
    this.isSavingSnapshot = false;
    this.cooldownTimer = null;
    this.lightbox = null;
    this.renderedSnapshotSignature = "";

    this.addBoundaries();
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.animate = this.animate.bind(this);
    this.refreshSaveControls = this.refreshSaveControls.bind(this);
  }

  addBoundaries() {
    const options = { isStatic: true, friction: 1, restitution: 0 };
    const ground = Bodies.rectangle(
      WORLD_WIDTH / 2,
      WORLD_HEIGHT + 10,
      WORLD_WIDTH + 80,
      80,
      options,
    );
    const leftWall = Bodies.rectangle(-30, WORLD_HEIGHT / 2, 60, WORLD_HEIGHT * 2, options);
    const rightWall = Bodies.rectangle(
      WORLD_WIDTH + 30,
      WORLD_HEIGHT / 2,
      60,
      WORLD_HEIGHT * 2,
      options,
    );
    const ceiling = Bodies.rectangle(WORLD_WIDTH / 2, -30, WORLD_WIDTH + 80, 60, options);
    Composite.add(this.engine.world, [ground, leftWall, rightWall, ceiling]);
  }

  mount({ getData, setData }) {
    this.getData = getData;
    this.setData = setData;
    this.board.addEventListener("pointerdown", this.handlePointerDown);
    this.board.addEventListener("pointermove", this.handlePointerMove);
    this.board.addEventListener("pointerup", this.handlePointerUp);
    this.board.addEventListener("pointercancel", this.handlePointerUp);
    window.addEventListener("keydown", this.handleKeyDown);

    document.querySelector('[data-action="add-block"]').addEventListener("click", () => {
      this.addSharedBlock();
    });
    document.querySelector('[data-action="rotate"]').addEventListener("click", () => {
      this.rotateSelected();
    });
    document.querySelector('[data-action="remove"]').addEventListener("click", () => {
      this.removeSelected();
    });
    document.querySelector('[data-action="reset-all"]').addEventListener("click", () => {
      this.resetAllBlocks();
    });
    this.saveButton.addEventListener("click", () => {
      void this.saveSnapshot();
    });

    this.ensureLightbox();
    this.resizeObserver = new ResizeObserver(() => this.scaleToFrame());
    this.resizeObserver.observe(this.frame);
    this.scaleToFrame();
    this.status.textContent = "yard is live";
    this.refreshSaveControls();
    this.cooldownTimer = window.setInterval(this.refreshSaveControls, 1000);
    this.animationFrame = requestAnimationFrame(this.animate);

    return () => this.destroy();
  }

  destroy() {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    if (this.cooldownTimer !== null) window.clearInterval(this.cooldownTimer);
    this.resizeObserver?.disconnect();
    this.board.removeEventListener("pointerdown", this.handlePointerDown);
    this.board.removeEventListener("pointermove", this.handlePointerMove);
    this.board.removeEventListener("pointerup", this.handlePointerUp);
    this.board.removeEventListener("pointercancel", this.handlePointerUp);
    window.removeEventListener("keydown", this.handleKeyDown);
    this.lightbox?.remove();
  }

  scaleToFrame() {
    this.board.style.setProperty("--yard-scale", this.frame.clientWidth / WORLD_WIDTH);
  }

  applySharedState(data) {
    validateYardData(data);
    const sharedIds = new Set(Object.keys(data.blocks));

    for (const id of this.bodies.keys()) {
      if (!sharedIds.has(id)) this.removeLocalBlock(id);
    }

    for (const [id, block] of Object.entries(data.blocks)) {
      if (!this.bodies.has(id)) this.addLocalBlock(id, block);
      this.remoteTargets.set(id, {
        x: block.x,
        y: block.y,
        angle: block.angle,
      });

      if (!this.locallyControlledIds.has(id)) {
        const body = this.bodies.get(id);
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, 0);
        Sleeping.set(body, true);
      }
    }

    if (this.pendingSelectionId && this.bodies.has(this.pendingSelectionId)) {
      this.selectBlock(this.pendingSelectionId);
      this.pendingSelectionId = null;
    }

    document.querySelector('[data-action="reset-all"]').disabled = sharedIds.size === 0;
    this.renderGallery(data);
    this.refreshSaveControls();
    this.render();
  }

  ensureLightbox() {
    if (this.lightbox) return;
    const lightbox = document.createElement("div");
    lightbox.className = "lightbox";
    lightbox.hidden = true;
    lightbox.innerHTML = `
      <div class="lightbox-dialog" role="dialog" aria-modal="true" aria-label="Yard snapshot">
        <img alt="Saved yard snapshot" />
        <div class="lightbox-bar">
          <span data-lightbox-meta></span>
          <button type="button" data-lightbox-close>CLOSE</button>
        </div>
      </div>
    `;
    lightbox.addEventListener("click", (event) => {
      if (event.target === lightbox || event.target.closest("[data-lightbox-close]")) {
        this.closeLightbox();
      }
    });
    document.body.appendChild(lightbox);
    this.lightbox = lightbox;
  }

  openLightbox(snapshot) {
    if (!this.lightbox || !snapshot?.imageDataUrl) return;
    const image = this.lightbox.querySelector("img");
    const meta = this.lightbox.querySelector("[data-lightbox-meta]");
    image.src = snapshot.imageDataUrl;
    meta.textContent = this.formatSnapshotLabel(snapshot);
    this.lightbox.hidden = false;
  }

  closeLightbox() {
    if (!this.lightbox) return;
    this.lightbox.hidden = true;
  }

  formatSnapshotLabel(snapshot) {
    const when = new Date(snapshot.createdAt);
    const stamp = Number.isNaN(when.getTime())
      ? "unknown time"
      : when.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
    const count = Number(snapshot.blockCount) || 0;
    return `${stamp} · ${count} block${count === 1 ? "" : "s"}`;
  }

  renderGallery(data) {
    const snapshots = listSnapshotsNewestFirst(data);
    const signature = snapshots
      .map((snapshot) => `${snapshot.id}:${snapshot.createdAt}`)
      .join("|");
    if (signature === this.renderedSnapshotSignature) return;
    this.renderedSnapshotSignature = signature;

    this.gallery.replaceChildren();
    if (snapshots.length === 0) {
      const empty = document.createElement("p");
      empty.className = "gallery-empty";
      empty.textContent = "No frames yet — build something, then SAVE.";
      this.gallery.appendChild(empty);
      return;
    }

    for (const snapshot of snapshots) {
      if (!snapshot?.imageDataUrl) continue;
      const figure = document.createElement("figure");
      figure.className = "snapshot-card";

      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute(
        "aria-label",
        `Open snapshot from ${this.formatSnapshotLabel(snapshot)}`,
      );
      button.addEventListener("click", () => this.openLightbox(snapshot));

      const image = document.createElement("img");
      image.src = snapshot.imageDataUrl;
      image.alt = "";
      image.loading = "lazy";
      button.appendChild(image);

      const meta = document.createElement("figcaption");
      meta.className = "snapshot-meta";
      const when = document.createElement("span");
      when.textContent = this.formatSnapshotLabel(snapshot).split(" · ")[0];
      const count = document.createElement("span");
      const blockCount = Number(snapshot.blockCount) || 0;
      count.textContent = `${blockCount} blk`;
      meta.append(when, count);

      figure.append(button, meta);
      this.gallery.appendChild(figure);
    }
  }

  refreshSaveControls() {
    if (!this.getData || this.isSavingSnapshot) return;
    const data = this.getData();
    const remaining = getSnapshotCooldownRemainingMs(data);
    const ready = remaining === 0;

    this.saveButton.disabled = !ready;
    this.saveButton.textContent = ready ? "SAVE" : "WAIT";
    this.saveStatus.textContent = ready
      ? "ready to save a frame"
      : `next save in ${formatCooldown(remaining)}`;
  }

  async saveSnapshot() {
    if (!this.getData || !this.setData || this.isSavingSnapshot) return;
    const data = this.getData();
    if (!canSaveSnapshot(data)) {
      this.refreshSaveControls();
      return;
    }

    this.isSavingSnapshot = true;
    this.saveButton.disabled = true;
    this.saveButton.classList.add("is-saving");
    this.saveButton.textContent = "SAVING…";
    this.saveStatus.textContent = "capturing the yard";
    this.board.classList.add("is-capturing");

    try {
      // Wait one paint so selection outlines hide before html2canvas runs.
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const previousScale = this.board.style.getPropertyValue("--yard-scale");
      // Temporarily unscale so the capture matches the fixed 1200×720 physics surface
      // instead of the viewport-fitted stage.
      this.board.style.setProperty("--yard-scale", "1");
      const { default: html2canvas } = await import("html2canvas");
      let canvas;
      try {
        canvas = await html2canvas(this.board, {
          backgroundColor: "#b7b7b1",
          useCORS: true,
          allowTaint: true,
          logging: false,
          scale: SNAPSHOT_CAPTURE_SCALE,
          width: WORLD_WIDTH,
          height: WORLD_HEIGHT,
          windowWidth: WORLD_WIDTH,
          windowHeight: WORLD_HEIGHT,
        });
      } finally {
        if (previousScale) {
          this.board.style.setProperty("--yard-scale", previousScale);
        } else {
          this.scaleToFrame();
        }
      }
      const imageDataUrl = canvas.toDataURL("image/jpeg", SNAPSHOT_JPEG_QUALITY);
      const id = `snap-${crypto.randomUUID()}`;
      const record = createSnapshotRecord({
        id,
        imageDataUrl,
        createdAt: Date.now(),
        blockCount: Object.keys(data.blocks || {}).length,
      });

      this.setData((draft) => {
        if (!draft.snapshots || typeof draft.snapshots !== "object") {
          draft.snapshots = {};
        }
        applySnapshotToDraft(draft.snapshots, record);
      });
      this.saveStatus.textContent = "saved to the site diary";
    } catch (error) {
      console.error("Failed to save yard snapshot", error);
      this.saveStatus.textContent = "save failed — try again";
    } finally {
      this.board.classList.remove("is-capturing");
      this.saveButton.classList.remove("is-saving");
      this.isSavingSnapshot = false;
      this.refreshSaveControls();
    }
  }

  addLocalBlock(id, block) {
    const body = Bodies.rectangle(block.x, block.y, BLOCK_WIDTH, BLOCK_HEIGHT, {
      angle: block.angle,
      density: 0.0024,
      friction: 0.95,
      frictionAir: 0.035,
      frictionStatic: 1.4,
      restitution: 0.01,
      sleepThreshold: 30,
      label: id,
    });
    Body.setInertia(body, body.inertia * 1.4);
    const element = document.createElement("button");
    element.type = "button";
    element.id = `yard-${id}`;
    element.className = "cinderblock real-block";
    element.dataset.blockId = id;
    element.setAttribute("aria-label", "cinder block");
    element.setAttribute("aria-pressed", "false");
    element.innerHTML = '<img src="/cinderblock-realistic.png" alt="" draggable="false" />';

    this.bodies.set(id, body);
    this.elements.set(id, element);
    this.layer.appendChild(element);
    Composite.add(this.engine.world, body);
  }

  removeLocalBlock(id) {
    const body = this.bodies.get(id);
    if (body) Composite.remove(this.engine.world, body);
    this.bodies.delete(id);
    this.remoteTargets.delete(id);
    this.locallyControlledIds.delete(id);
    this.elements.get(id)?.remove();
    this.elements.delete(id);

    if (this.selectedId === id) this.selectBlock(null);
  }

  addSharedBlock() {
    const data = this.getData();
    validateYardData(data);
    const id = `block-${crypto.randomUUID()}`;
    const block = createBlock(id, Object.keys(data.blocks).length);
    this.pendingSelectionId = id;
    this.beginLocalMotion(id);
    this.setData((draft) => {
      draft.blocks[block.id] = block.transform;
    });
  }

  removeSelected() {
    if (!this.selectedId) return;
    const id = this.selectedId;
    this.selectBlock(null);
    this.setData((draft) => {
      delete draft.blocks[id];
    });
  }

  resetAllBlocks() {
    this.selectBlock(null);
    this.pendingSelectionId = null;
    this.locallyControlledIds.clear();
    this.lastPublished = {};
    this.setData((draft) => {
      for (const id of Object.keys(draft.blocks)) {
        delete draft.blocks[id];
      }
    });
  }

  rotateSelected() {
    if (!this.selectedId) return;
    const body = this.bodies.get(this.selectedId);
    const quarterTurn = Math.PI / 2;
    const targetAngle = Math.round(body.angle / quarterTurn) * quarterTurn + quarterTurn;
    Body.setAngle(body, targetAngle);
    Body.setAngularVelocity(body, 0);
    Sleeping.set(body, false);
    this.beginLocalMotion(this.selectedId);
    this.publishTransforms(performance.now(), true);
  }

  selectBlock(id) {
    if (this.selectedId) {
      const previous = this.elements.get(this.selectedId);
      previous?.classList.remove("is-selected");
      previous?.setAttribute("aria-pressed", "false");
    }

    this.selectedId = id;
    if (id) {
      const selected = this.elements.get(id);
      selected?.classList.add("is-selected");
      selected?.setAttribute("aria-pressed", "true");
    }

    const disabled = !id;
    document.querySelector('[data-action="rotate"]').disabled = disabled;
    document.querySelector('[data-action="remove"]').disabled = disabled;
  }

  pointInYard(event) {
    const rect = this.board.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * WORLD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * WORLD_HEIGHT,
    };
  }

  handlePointerDown(event) {
    const blockElement = event.target.closest("[data-block-id]");
    if (!blockElement) {
      this.selectBlock(null);
      return;
    }

    event.preventDefault();
    const id = blockElement.dataset.blockId;
    const body = this.bodies.get(id);
    const point = this.pointInYard(event);
    this.draggedBody = body;
    this.dragOffset = Vector.sub(body.position, point);
    this.dragPointerId = event.pointerId;
    this.board.setPointerCapture(event.pointerId);
    Body.setVelocity(body, { x: 0, y: 0 });
    Body.setAngularVelocity(body, 0);
    Body.setStatic(body, true);
    this.selectBlock(id);
    this.beginLocalMotion(id);
  }

  handlePointerMove(event) {
    if (!this.draggedBody || event.pointerId !== this.dragPointerId) return;
    Body.setPosition(
      this.draggedBody,
      Vector.add(this.pointInYard(event), this.dragOffset),
    );
    this.lastMotionAt = performance.now();
  }

  handlePointerUp(event) {
    if (!this.draggedBody || event.pointerId !== this.dragPointerId) return;
    Body.setStatic(this.draggedBody, false);
    Body.setVelocity(this.draggedBody, { x: 0, y: 0 });
    Body.setAngularVelocity(this.draggedBody, 0);
    Sleeping.set(this.draggedBody, false);
    this.draggedBody = null;
    this.dragOffset = null;
    this.dragPointerId = null;
    this.lastMotionAt = performance.now();
    if (this.board.hasPointerCapture(event.pointerId)) {
      this.board.releasePointerCapture(event.pointerId);
    }
  }

  handleKeyDown(event) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    if (event.key === "Escape") this.closeLightbox();
    if (event.key.toLowerCase() === "r") this.rotateSelected();
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      this.removeSelected();
    }
  }

  beginLocalMotion(id) {
    this.locallyControlledIds.add(id);
    for (const body of this.bodies.values()) {
      Sleeping.set(body, false);
    }
    this.lastMotionAt = performance.now();
  }

  isBodyMoving(body) {
    return (
      !body.isSleeping &&
      (body.speed > MOVING_SPEED ||
        Math.abs(body.angularSpeed) > MOVING_ANGULAR_SPEED)
    );
  }

  claimMovingBodies() {
    for (const [id, body] of this.bodies) {
      if (this.isBodyMoving(body)) this.locallyControlledIds.add(id);
    }
  }

  hasMovingBodies() {
    return [...this.locallyControlledIds].some((id) => {
      const body = this.bodies.get(id);
      return body && this.isBodyMoving(body);
    });
  }

  limitBodySpeeds() {
    for (const body of this.bodies.values()) {
      if (body.speed > MAX_LINEAR_SPEED) {
        Body.setVelocity(
          body,
          Vector.mult(Vector.normalise(body.velocity), MAX_LINEAR_SPEED),
        );
      }
      if (Math.abs(body.angularSpeed) > MAX_ANGULAR_SPEED) {
        Body.setAngularVelocity(
          body,
          Math.sign(body.angularVelocity) * MAX_ANGULAR_SPEED,
        );
      }
    }
  }

  interpolateRemoteTransforms(frameDeltaMs) {
    const amount = 1 - Math.exp(-REMOTE_INTERPOLATION_SPEED * frameDeltaMs / 1000);

    for (const [id, target] of this.remoteTargets) {
      if (this.locallyControlledIds.has(id)) continue;
      const body = this.bodies.get(id);
      if (!body) continue;
      const current = {
        x: body.position.x,
        y: body.position.y,
        angle: body.angle,
      };
      const next = interpolateTransform(current, target, amount);
      const positionDistance = Math.hypot(target.x - next.x, target.y - next.y);
      const angleDistance = Math.abs(
        Math.atan2(Math.sin(target.angle - next.angle), Math.cos(target.angle - next.angle)),
      );

      Body.setPosition(
        body,
        positionDistance < REMOTE_POSITION_SNAP_DISTANCE
          ? { x: target.x, y: target.y }
          : { x: next.x, y: next.y },
      );
      Body.setAngle(
        body,
        angleDistance < REMOTE_ANGLE_SNAP_DISTANCE ? target.angle : next.angle,
      );
    }
  }

  getCurrentTransforms(ids = this.bodies.keys()) {
    return Object.fromEntries(
      [...ids].flatMap((id) => {
        const body = this.bodies.get(id);
        return body ? [[id, roundTransform(body)]] : [];
      }),
    );
  }

  publishTransforms(now, force = false) {
    if (!this.setData || (!force && now - this.lastSyncAt < SYNC_INTERVAL_MS)) return;
    const current = this.getCurrentTransforms(this.locallyControlledIds);
    const changed = getChangedTransforms(
      current,
      this.lastPublished,
      this.locallyControlledIds,
    );
    if (Object.keys(changed).length === 0) return;

    this.setData((draft) => {
      for (const [id, transform] of Object.entries(changed)) {
        const block = draft.blocks[id];
        if (!block) continue;
        block.x = transform.x;
        block.y = transform.y;
        block.angle = transform.angle;
      }
    });
    this.lastPublished = current;
    this.lastSyncAt = now;
  }

  updateLocalSync(now) {
    if (this.locallyControlledIds.size === 0) return;
    if (this.hasMovingBodies() || this.draggedBody) this.lastMotionAt = now;
    this.publishTransforms(now);

    if (!this.draggedBody && now - this.lastMotionAt >= STILLNESS_WINDOW_MS) {
      this.publishTransforms(now, true);
      this.locallyControlledIds.clear();
      this.lastPublished = {};
      this.applySharedState(this.getData());
    }
  }

  render() {
    for (const [id, body] of this.bodies) {
      const element = this.elements.get(id);
      element.style.transform = `translate(${body.position.x - BLOCK_WIDTH / 2}px, ${
        body.position.y - BLOCK_HEIGHT / 2
      }px) rotate(${body.angle}rad)`;
    }
  }

  animate(now) {
    const frameDeltaMs = this.previousFrameAt
      ? Math.min(now - this.previousFrameAt, 50)
      : FIXED_TIMESTEP_MS;
    this.previousFrameAt = now;
    this.accumulator += frameDeltaMs;

    while (this.accumulator >= FIXED_TIMESTEP_MS) {
      Engine.update(this.engine, FIXED_TIMESTEP_MS);
      this.limitBodySpeeds();
      if (this.locallyControlledIds.size > 0) this.claimMovingBodies();
      this.accumulator -= FIXED_TIMESTEP_MS;
    }

    this.interpolateRemoteTransforms(frameDeltaMs);
    this.render();
    this.updateLocalSync(now);
    this.animationFrame = requestAnimationFrame(this.animate);
  }
}

const yardElement = requireElement("cinderblock-yard");
const yard = new CinderblockYard({
  board: yardElement,
  layer: requireElement("block-layer"),
  frame: requireElement("stage-frame"),
  status: requireElement("yard-status"),
  gallery: requireElement("snapshot-gallery"),
  saveButton: requireElement("save-snapshot"),
  saveStatus: requireElement("save-status"),
});

yardElement.defaultData = createDefaultYard();
yardElement.updateElement = ({ data }) => yard.applySharedState(data);
yardElement.onMount = ({ getData, setData }) => yard.mount({ getData, setData });

playhtml.init({
  room: window.location.pathname,
  cursors: { enabled: true, room: "page" },
});
