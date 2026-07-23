// ABOUTME: Defines the canonical collaborative Matter.js physics recipe.
// ABOUTME: Keeps one browser in control while remote browsers interpolate shared transforms.

import type { ExampleRecipe } from "./types";

export const matterPhysicsRecipe: ExampleRecipe = {
  id: "matter-physics",
  title: "Shared Matter.js physics",
  description:
    "Drag, drop, add, and reset a small set of physics bodies shared across browsers.",
  tags: ["physics", "Matter.js", "dragging", "multiplayer"],
  capabilities: ["can-play"],
  difficulty: "advanced",
  docsHref: "/docs/examples/matter-physics/",
  html: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Shared Matter.js physics</title>
  <style>
    :root {
      color: #3d3833;
      background: #f7f3ea;
      font-family: system-ui, sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      min-width: 320px;
      margin: 0;
      padding: clamp(16px, 4vw, 36px);
    }

    main {
      width: min(720px, 100%);
      margin: 0 auto;
    }

    header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 14px;
    }

    h1 {
      margin: 0;
      font-size: clamp(30px, 7vw, 56px);
      letter-spacing: -0.05em;
      line-height: 0.95;
    }

    header p {
      max-width: 260px;
      margin: 0;
      color: #6b6560;
      font-family: ui-monospace, monospace;
      font-size: 12px;
      line-height: 1.5;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }

    button {
      border: 2px solid #3d3833;
      border-radius: 999px;
      padding: 8px 14px;
      color: #3d3833;
      background: #fffdf8;
      font: 700 13px/1 ui-monospace, monospace;
      cursor: pointer;
    }

    button:hover:not(:disabled) { background: #ffe95c; }
    button:disabled { cursor: default; opacity: 0.45; }

    #physics-status {
      margin-left: auto;
      color: #6b6560;
      font: 12px/1.3 ui-monospace, monospace;
    }

    #physics-world {
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 10;
      overflow: hidden;
      border: 2px solid #3d3833;
      border-radius: 18px;
      touch-action: none;
      user-select: none;
      background:
        linear-gradient(rgba(61, 56, 51, 0.08) 1px, transparent 1px),
        linear-gradient(90deg, rgba(61, 56, 51, 0.08) 1px, transparent 1px),
        #dff6ef;
      background-size: 32px 32px;
    }

    #physics-world::after {
      position: absolute;
      right: 0;
      bottom: 0;
      left: 0;
      height: 14px;
      background: #3d3833;
      content: "";
    }

    .body {
      position: absolute;
      top: 0;
      left: 0;
      display: grid;
      width: 76px;
      height: 76px;
      place-items: center;
      border: 2px solid #3d3833;
      border-radius: 16px;
      padding: 0;
      color: #3d3833;
      box-shadow: 0 5px 0 rgba(61, 56, 51, 0.18);
      cursor: grab;
      font: 700 18px/1 ui-monospace, monospace;
      transform-origin: center;
      will-change: transform;
    }

    .body:active { cursor: grabbing; }
    .body:nth-child(3n + 1) { background: #ff8fa3; }
    .body:nth-child(3n + 2) { background: #ffe95c; }
    .body:nth-child(3n) { background: #8ed8ff; }

    .note {
      margin: 10px 4px 0;
      color: #6b6560;
      font-size: 13px;
    }

    @media (max-width: 560px) {
      header { display: block; }
      header p { margin-top: 8px; }
      #physics-status { display: none; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Shared physics</h1>
      <p>Drag a block, then let go. Its Matter.js motion syncs to everyone.</p>
    </header>

    <div class="toolbar">
      <button id="add-body" type="button" disabled>Add body</button>
      <button id="reset-bodies" type="button" disabled>Reset</button>
      <span id="physics-status" role="status">Joining room…</span>
    </div>

    <div id="physics-world" can-play aria-label="Shared physics world"></div>
    <p class="note">The last person to interact controls the simulation.</p>
  </main>

  <script type="module">
    import Matter from "https://esm.sh/matter-js@0.20.0";
    import { playhtml } from "playhtml";

    const { Bodies, Body, Composite, Engine, Sleeping } = Matter;
    const WORLD_WIDTH = 640;
    const WORLD_HEIGHT = 400;
    const BODY_SIZE = 76;
    const SYNC_INTERVAL_MS = 100;
    const POSITION_THRESHOLD = 0.5;
    const ANGLE_THRESHOLD = 0.01;
    const MAX_BODIES = 6;
    const CLIENT_ID = crypto.randomUUID();

    const INITIAL_BODIES = {
      "body-a": { x: 245, y: 320, angle: 0 },
      "body-b": { x: 320, y: 220, angle: 0.08 },
      "body-c": { x: 395, y: 320, angle: 0 },
    };

    const worldElement = document.getElementById("physics-world");
    const addButton = document.getElementById("add-body");
    const resetButton = document.getElementById("reset-bodies");
    const statusElement = document.getElementById("physics-status");

    if (!worldElement || !addButton || !resetButton || !statusElement) {
      throw new Error("The physics recipe is missing required elements");
    }

    const engine = Engine.create({ enableSleeping: true });
    const bodies = new Map();
    const bodyElements = new Map();
    const remoteTargets = new Map();
    let getData;
    let setData;
    let controlsWorld = false;
    let draggedBody = null;
    let dragPointerId = null;
    let dragOffset = { x: 0, y: 0 };
    let lastFrameAt = 0;
    let lastSyncAt = 0;
    let lastPublished = {};

    const boundaryOptions = { isStatic: true, friction: 1, restitution: 0 };
    Composite.add(engine.world, [
      Bodies.rectangle(WORLD_WIDTH / 2, WORLD_HEIGHT + 20, WORLD_WIDTH + 80, 50, boundaryOptions),
      Bodies.rectangle(-20, WORLD_HEIGHT / 2, 40, WORLD_HEIGHT * 2, boundaryOptions),
      Bodies.rectangle(WORLD_WIDTH + 20, WORLD_HEIGHT / 2, 40, WORLD_HEIGHT * 2, boundaryOptions),
      Bodies.rectangle(WORLD_WIDTH / 2, -20, WORLD_WIDTH + 80, 40, boundaryOptions),
    ]);

    function validateData(data) {
      if (!data || typeof data !== "object" || !data.bodies || typeof data.bodies !== "object") {
        throw new Error("Shared physics requires a keyed bodies object");
      }
      if (typeof data.controllerId !== "string") {
        throw new Error("Shared physics requires a controllerId string");
      }
    }

    function createBody(id, transform) {
      const body = Bodies.rectangle(transform.x, transform.y, BODY_SIZE, BODY_SIZE, {
        angle: transform.angle,
        friction: 0.8,
        frictionAir: 0.025,
        restitution: 0.15,
        sleepThreshold: 35,
        label: id,
      });
      const element = document.createElement("button");
      element.type = "button";
      element.id = "physics-" + id;
      element.className = "body";
      element.dataset.bodyId = id;
      element.setAttribute("aria-label", "Physics body " + id);
      element.textContent = String(bodyElements.size + 1);

      bodies.set(id, body);
      bodyElements.set(id, element);
      worldElement.appendChild(element);
      Composite.add(engine.world, body);
      return body;
    }

    function removeBody(id) {
      const body = bodies.get(id);
      if (body) Composite.remove(engine.world, body);
      bodies.delete(id);
      remoteTargets.delete(id);
      bodyElements.get(id)?.remove();
      bodyElements.delete(id);
    }

    function setControlMode(shouldControl) {
      if (controlsWorld === shouldControl) return;
      controlsWorld = shouldControl;
      lastPublished = {};

      for (const body of bodies.values()) {
        if (body === draggedBody) continue;
        Body.setStatic(body, !shouldControl);
        if (shouldControl) Sleeping.set(body, false);
      }

      statusElement.textContent = shouldControl ? "You control the simulation" : "Watching shared motion";
    }

    function applySharedState(data) {
      validateData(data);
      const sharedIds = new Set(Object.keys(data.bodies));

      for (const id of bodies.keys()) {
        if (!sharedIds.has(id)) removeBody(id);
      }

      for (const [id, transform] of Object.entries(data.bodies)) {
        if (!bodies.has(id)) createBody(id, transform);
        remoteTargets.set(id, transform);
      }

      setControlMode(data.controllerId === CLIENT_ID);
      addButton.disabled = sharedIds.size >= MAX_BODIES;
      resetButton.disabled = false;
    }

    function claimControl() {
      setControlMode(true);
      setData((draft) => {
        draft.controllerId = CLIENT_ID;
      });
    }

    function pointInWorld(event) {
      const rect = worldElement.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * WORLD_WIDTH,
        y: ((event.clientY - rect.top) / rect.height) * WORLD_HEIGHT,
      };
    }

    function handlePointerDown(event) {
      const element = event.target.closest("[data-body-id]");
      if (!element) return;
      const body = bodies.get(element.dataset.bodyId);
      if (!body) return;

      event.preventDefault();
      claimControl();
      const point = pointInWorld(event);
      draggedBody = body;
      dragPointerId = event.pointerId;
      dragOffset = {
        x: body.position.x - point.x,
        y: body.position.y - point.y,
      };
      Body.setStatic(body, true);
      worldElement.setPointerCapture(event.pointerId);
    }

    function handlePointerMove(event) {
      if (!draggedBody || event.pointerId !== dragPointerId) return;
      const point = pointInWorld(event);
      Body.setPosition(draggedBody, {
        x: Math.max(BODY_SIZE / 2, Math.min(WORLD_WIDTH - BODY_SIZE / 2, point.x + dragOffset.x)),
        y: Math.max(BODY_SIZE / 2, Math.min(WORLD_HEIGHT - BODY_SIZE / 2, point.y + dragOffset.y)),
      });
    }

    function handlePointerUp(event) {
      if (!draggedBody || event.pointerId !== dragPointerId) return;
      Body.setStatic(draggedBody, false);
      Body.setVelocity(draggedBody, { x: 0, y: 0 });
      Sleeping.set(draggedBody, false);
      draggedBody = null;
      dragPointerId = null;
      if (worldElement.hasPointerCapture(event.pointerId)) {
        worldElement.releasePointerCapture(event.pointerId);
      }
      publishTransforms(performance.now(), true);
    }

    function addBody() {
      const data = getData();
      validateData(data);
      if (Object.keys(data.bodies).length >= MAX_BODIES) return;

      const id = "body-" + crypto.randomUUID();
      setControlMode(true);
      setData((draft) => {
        draft.controllerId = CLIENT_ID;
        draft.bodies[id] = { x: WORLD_WIDTH / 2, y: 70, angle: 0 };
      });
    }

    function resetLocalBodies() {
      for (const id of [...bodies.keys()]) {
        if (!INITIAL_BODIES[id]) removeBody(id);
      }

      for (const [id, transform] of Object.entries(INITIAL_BODIES)) {
        const body = bodies.get(id) || createBody(id, transform);
        Body.setPosition(body, { x: transform.x, y: transform.y });
        Body.setAngle(body, transform.angle);
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, 0);
        Sleeping.set(body, false);
      }
      lastPublished = {};
    }

    function resetBodies() {
      setControlMode(true);
      resetLocalBodies();
      setData((draft) => {
        draft.controllerId = CLIENT_ID;
        for (const id of Object.keys(draft.bodies)) delete draft.bodies[id];
        for (const [id, transform] of Object.entries(INITIAL_BODIES)) {
          draft.bodies[id] = { ...transform };
        }
      });
    }

    function boundedTransform(body) {
      return {
        x: Math.round(Math.max(BODY_SIZE / 2, Math.min(WORLD_WIDTH - BODY_SIZE / 2, body.position.x)) * 10) / 10,
        y: Math.round(Math.max(BODY_SIZE / 2, Math.min(WORLD_HEIGHT - BODY_SIZE / 2, body.position.y)) * 10) / 10,
        angle: Math.round(body.angle * 1000) / 1000,
      };
    }

    function transformChanged(next, previous) {
      return !previous ||
        Math.abs(next.x - previous.x) >= POSITION_THRESHOLD ||
        Math.abs(next.y - previous.y) >= POSITION_THRESHOLD ||
        Math.abs(next.angle - previous.angle) >= ANGLE_THRESHOLD;
    }

    function publishTransforms(now, force = false) {
      if (!controlsWorld || (!force && now - lastSyncAt < SYNC_INTERVAL_MS)) return;
      const current = Object.fromEntries(
        [...bodies].map(([id, body]) => [id, boundedTransform(body)]),
      );
      const changed = Object.entries(current).filter(
        ([id, transform]) => transformChanged(transform, lastPublished[id]),
      );
      if (changed.length === 0) return;

      setData((draft) => {
        if (draft.controllerId !== CLIENT_ID) return;
        for (const [id, transform] of changed) {
          if (!draft.bodies[id]) continue;
          draft.bodies[id].x = transform.x;
          draft.bodies[id].y = transform.y;
          draft.bodies[id].angle = transform.angle;
        }
      });
      lastPublished = current;
      lastSyncAt = now;
    }

    function interpolateRemoteBodies() {
      for (const [id, target] of remoteTargets) {
        const body = bodies.get(id);
        if (!body) continue;
        Body.setPosition(body, {
          x: body.position.x + (target.x - body.position.x) * 0.22,
          y: body.position.y + (target.y - body.position.y) * 0.22,
        });
        Body.setAngle(body, body.angle + (target.angle - body.angle) * 0.22);
      }
    }

    function render() {
      const rect = worldElement.getBoundingClientRect();
      const scaleX = rect.width / WORLD_WIDTH;
      const scaleY = rect.height / WORLD_HEIGHT;
      for (const [id, body] of bodies) {
        const element = bodyElements.get(id);
        const width = BODY_SIZE * scaleX;
        const height = BODY_SIZE * scaleY;
        element.style.width = width + "px";
        element.style.height = height + "px";
        element.style.transform =
          "translate(" +
          (body.position.x * scaleX - width / 2) + "px, " +
          (body.position.y * scaleY - height / 2) + "px) rotate(" +
          body.angle + "rad)";
      }
    }

    function animate(now) {
      const delta = lastFrameAt ? Math.min(now - lastFrameAt, 32) : 1000 / 60;
      lastFrameAt = now;

      if (controlsWorld) {
        Engine.update(engine, delta);
        const isMoving = draggedBody || [...bodies.values()].some((body) => !body.isSleeping);
        if (isMoving) publishTransforms(now);
      } else {
        interpolateRemoteBodies();
      }

      render();
      requestAnimationFrame(animate);
    }

    worldElement.defaultData = {
      controllerId: "",
      bodies: structuredClone(INITIAL_BODIES),
    };
    worldElement.updateElement = ({ data }) => applySharedState(data);
    worldElement.onMount = (context) => {
      getData = context.getData;
      setData = context.setData;
      statusElement.textContent = "Watching shared motion";
    };

    worldElement.addEventListener("pointerdown", handlePointerDown);
    worldElement.addEventListener("pointermove", handlePointerMove);
    worldElement.addEventListener("pointerup", handlePointerUp);
    worldElement.addEventListener("pointercancel", handlePointerUp);
    addButton.addEventListener("click", addBody);
    resetButton.addEventListener("click", resetBodies);
    requestAnimationFrame(animate);

    await playhtml.init({ developmentMode: true });
  </script>
</body>
</html>`,
};
