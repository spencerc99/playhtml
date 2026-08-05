// ABOUTME: Exports the copy-paste React source for the collaborative Matter.js recipe.
// ABOUTME: Keeps the complete App.tsx example available to Starlight code blocks.

export const matterPhysicsReactSource = `// ABOUTME: Runs one shared Matter.js world through PlayHTML's React bindings.
// ABOUTME: Lets one browser simulate while remote browsers interpolate shared transforms.
// npm install react react-dom playhtml @playhtml/react matter-js
// npm install --save-dev typescript @types/react @types/react-dom @types/matter-js

import {
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import Matter from "matter-js";
import { PlayProvider, withSharedState } from "@playhtml/react";

type Transform = {
  x: number;
  y: number;
  angle: number;
};

type PhysicsData = {
  controllerId: string;
  bodies: Record<string, Transform>;
};

const { Bodies, Body, Composite, Engine, Sleeping } = Matter;
type PhysicsBody = ReturnType<typeof Bodies.rectangle>;

const WORLD_WIDTH = 640;
const WORLD_HEIGHT = 400;
const BODY_SIZE = 76;
const SYNC_INTERVAL_MS = 100;
const POSITION_THRESHOLD = 0.5;
const ANGLE_THRESHOLD = 0.01;
const MAX_BODIES = 6;

const INITIAL_BODIES: Record<string, Transform> = {
  "body-a": { x: 245, y: 320, angle: 0 },
  "body-b": { x: 320, y: 220, angle: 0.08 },
  "body-c": { x: 395, y: 320, angle: 0 },
};

const STYLES = \`
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

  .physics-app {
    width: min(720px, 100%);
    margin: 0 auto;
  }

  .physics-app header {
    display: flex;
    align-items: end;
    justify-content: space-between;
    gap: 24px;
    margin-bottom: 14px;
  }

  .physics-app h1 {
    margin: 0;
    font-size: clamp(30px, 7vw, 56px);
    letter-spacing: -0.05em;
    line-height: 0.95;
  }

  .physics-app header p {
    max-width: 260px;
    margin: 0;
    color: #6b6560;
    font: 12px/1.5 ui-monospace, monospace;
  }

  .physics-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .physics-app button {
    border: 2px solid #3d3833;
    border-radius: 999px;
    padding: 8px 14px;
    color: #3d3833;
    background: #fffdf8;
    font: 700 13px/1 ui-monospace, monospace;
    cursor: pointer;
  }

  .physics-app button:hover:not(:disabled) { background: #ffe95c; }
  .physics-app button:disabled { cursor: default; opacity: 0.45; }

  .physics-status {
    margin-left: auto;
    color: #6b6560;
    font: 12px/1.3 ui-monospace, monospace;
  }

  .physics-world {
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

  .physics-world::after {
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    height: 14px;
    background: #3d3833;
    content: "";
  }

  .physics-body {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 1;
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

  .physics-body:active { cursor: grabbing; }
  .physics-body:nth-child(3n + 1) { background: #ff8fa3; }
  .physics-body:nth-child(3n + 2) { background: #ffe95c; }
  .physics-body:nth-child(3n) { background: #8ed8ff; }

  .physics-note {
    margin: 10px 4px 0;
    color: #6b6560;
    font-size: 13px;
  }

  @media (max-width: 560px) {
    .physics-app header { display: block; }
    .physics-app header p { margin-top: 8px; }
    .physics-status { display: none; }
  }
\`;

function createEngine() {
  const engine = Engine.create({ enableSleeping: true });
  const boundaryOptions = { isStatic: true, friction: 1, restitution: 0 };
  Composite.add(engine.world, [
    Bodies.rectangle(
      WORLD_WIDTH / 2,
      WORLD_HEIGHT + 20,
      WORLD_WIDTH + 80,
      50,
      boundaryOptions,
    ),
    Bodies.rectangle(
      -20,
      WORLD_HEIGHT / 2,
      40,
      WORLD_HEIGHT * 2,
      boundaryOptions,
    ),
    Bodies.rectangle(
      WORLD_WIDTH + 20,
      WORLD_HEIGHT / 2,
      40,
      WORLD_HEIGHT * 2,
      boundaryOptions,
    ),
    Bodies.rectangle(
      WORLD_WIDTH / 2,
      -20,
      WORLD_WIDTH + 80,
      40,
      boundaryOptions,
    ),
  ]);
  return engine;
}

function createPhysicsBody(id: string, transform: Transform): PhysicsBody {
  return Bodies.rectangle(
    transform.x,
    transform.y,
    BODY_SIZE,
    BODY_SIZE,
    {
      angle: transform.angle,
      friction: 0.8,
      frictionAir: 0.025,
      restitution: 0.15,
      sleepThreshold: 35,
      label: id,
    },
  );
}

function boundedTransform(body: PhysicsBody): Transform {
  return {
    x:
      Math.round(
        Math.max(
          BODY_SIZE / 2,
          Math.min(WORLD_WIDTH - BODY_SIZE / 2, body.position.x),
        ) * 10,
      ) / 10,
    y:
      Math.round(
        Math.max(
          BODY_SIZE / 2,
          Math.min(WORLD_HEIGHT - BODY_SIZE / 2, body.position.y),
        ) * 10,
      ) / 10,
    angle: Math.round(body.angle * 1000) / 1000,
  };
}

function transformChanged(
  next: Transform,
  previous: Transform | undefined,
): boolean {
  return (
    !previous ||
    Math.abs(next.x - previous.x) >= POSITION_THRESHOLD ||
    Math.abs(next.y - previous.y) >= POSITION_THRESHOLD ||
    Math.abs(next.angle - previous.angle) >= ANGLE_THRESHOLD
  );
}

const SharedPhysics = withSharedState<PhysicsData>(
  {
    id: "shared-physics-world",
    defaultData: {
      controllerId: "",
      bodies: structuredClone(INITIAL_BODIES),
    },
  },
  ({ data, setData, ref }) => {
    const clientIdRef = useRef("");
    if (!clientIdRef.current) clientIdRef.current = crypto.randomUUID();

    const engine = useMemo(createEngine, []);
    const worldRef = useRef<HTMLDivElement | null>(null);
    const bodiesRef = useRef(new Map<string, PhysicsBody>());
    const bodyElementsRef = useRef(new Map<string, HTMLButtonElement>());
    const remoteTargetsRef = useRef(new Map<string, Transform>());
    const controlsWorldRef = useRef(false);
    const draggedBodyRef = useRef<PhysicsBody | null>(null);
    const dragPointerIdRef = useRef<number | null>(null);
    const dragOffsetRef = useRef({ x: 0, y: 0 });
    const lastFrameAtRef = useRef(0);
    const lastSyncAtRef = useRef(0);
    const lastPublishedRef = useRef<Record<string, Transform>>({});
    const publishRef = useRef<(now: number, force?: boolean) => void>(() => {});

    function removeLocalBody(id: string) {
      const body = bodiesRef.current.get(id);
      if (body) Composite.remove(engine.world, body);
      bodiesRef.current.delete(id);
      bodyElementsRef.current.delete(id);
      remoteTargetsRef.current.delete(id);
    }

    function setControlMode(shouldControl: boolean) {
      if (controlsWorldRef.current === shouldControl) return;
      controlsWorldRef.current = shouldControl;
      lastPublishedRef.current = {};

      for (const body of bodiesRef.current.values()) {
        if (body === draggedBodyRef.current) continue;
        Body.setStatic(body, !shouldControl);
        if (shouldControl) Sleeping.set(body, false);
      }
    }

    useEffect(() => {
      const sharedIds = new Set(Object.keys(data.bodies));

      for (const id of bodiesRef.current.keys()) {
        if (!sharedIds.has(id)) removeLocalBody(id);
      }

      for (const [id, transform] of Object.entries(data.bodies)) {
        if (!bodiesRef.current.has(id)) {
          const body = createPhysicsBody(id, transform);
          bodiesRef.current.set(id, body);
          Composite.add(engine.world, body);
        }
        remoteTargetsRef.current.set(id, { ...transform });
      }
    }, [data.bodies, engine]);

    useEffect(() => {
      setControlMode(data.controllerId === clientIdRef.current);
    }, [data.controllerId]);

    function claimControl() {
      setControlMode(true);
      setData((draft) => {
        draft.controllerId = clientIdRef.current;
      });
    }

    function pointInWorld(event: ReactPointerEvent<HTMLElement>) {
      const world = worldRef.current;
      if (!world) return null;
      const rect = world.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * WORLD_WIDTH,
        y: ((event.clientY - rect.top) / rect.height) * WORLD_HEIGHT,
      };
    }

    function handlePointerDown(
      event: ReactPointerEvent<HTMLButtonElement>,
      id: string,
    ) {
      const body = bodiesRef.current.get(id);
      const point = pointInWorld(event);
      const world = worldRef.current;
      if (!body || !point || !world) return;

      event.preventDefault();
      claimControl();
      draggedBodyRef.current = body;
      dragPointerIdRef.current = event.pointerId;
      dragOffsetRef.current = {
        x: body.position.x - point.x,
        y: body.position.y - point.y,
      };
      Body.setStatic(body, true);
      world.setPointerCapture(event.pointerId);
    }

    function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
      const body = draggedBodyRef.current;
      if (!body || event.pointerId !== dragPointerIdRef.current) return;
      const point = pointInWorld(event);
      if (!point) return;

      Body.setPosition(body, {
        x: Math.max(
          BODY_SIZE / 2,
          Math.min(
            WORLD_WIDTH - BODY_SIZE / 2,
            point.x + dragOffsetRef.current.x,
          ),
        ),
        y: Math.max(
          BODY_SIZE / 2,
          Math.min(
            WORLD_HEIGHT - BODY_SIZE / 2,
            point.y + dragOffsetRef.current.y,
          ),
        ),
      });
    }

    function handlePointerUp(event: ReactPointerEvent<HTMLElement>) {
      const body = draggedBodyRef.current;
      if (!body || event.pointerId !== dragPointerIdRef.current) return;

      Body.setStatic(body, false);
      Body.setVelocity(body, { x: 0, y: 0 });
      Sleeping.set(body, false);
      draggedBodyRef.current = null;
      dragPointerIdRef.current = null;
      if (worldRef.current?.hasPointerCapture(event.pointerId)) {
        worldRef.current.releasePointerCapture(event.pointerId);
      }
      publishRef.current(performance.now(), true);
    }

    function addBody() {
      if (Object.keys(data.bodies).length >= MAX_BODIES) return;
      const id = "body-" + crypto.randomUUID();

      setControlMode(true);
      setData((draft) => {
        draft.controllerId = clientIdRef.current;
        draft.bodies[id] = { x: WORLD_WIDTH / 2, y: 70, angle: 0 };
      });
    }

    function resetLocalBodies() {
      for (const id of [...bodiesRef.current.keys()]) {
        if (!INITIAL_BODIES[id]) removeLocalBody(id);
      }

      for (const [id, transform] of Object.entries(INITIAL_BODIES)) {
        let body = bodiesRef.current.get(id);
        if (!body) {
          body = createPhysicsBody(id, transform);
          bodiesRef.current.set(id, body);
          Composite.add(engine.world, body);
        }
        Body.setPosition(body, { x: transform.x, y: transform.y });
        Body.setAngle(body, transform.angle);
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, 0);
        Sleeping.set(body, false);
      }
      lastPublishedRef.current = {};
    }

    function resetBodies() {
      setControlMode(true);
      resetLocalBodies();
      setData((draft) => {
        draft.controllerId = clientIdRef.current;
        for (const id of Object.keys(draft.bodies)) delete draft.bodies[id];
        for (const [id, transform] of Object.entries(INITIAL_BODIES)) {
          draft.bodies[id] = { ...transform };
        }
      });
    }

    publishRef.current = (now, force = false) => {
      if (
        !controlsWorldRef.current ||
        (!force && now - lastSyncAtRef.current < SYNC_INTERVAL_MS)
      ) {
        return;
      }

      const current = Object.fromEntries(
        [...bodiesRef.current].map(([id, body]) => [
          id,
          boundedTransform(body),
        ]),
      );
      const changed = Object.entries(current).filter(([id, transform]) =>
        transformChanged(transform, lastPublishedRef.current[id]),
      );
      if (changed.length === 0) return;

      setData((draft) => {
        if (draft.controllerId !== clientIdRef.current) return;
        for (const [id, transform] of changed) {
          if (!draft.bodies[id]) continue;
          draft.bodies[id].x = transform.x;
          draft.bodies[id].y = transform.y;
          draft.bodies[id].angle = transform.angle;
        }
      });
      lastPublishedRef.current = current;
      lastSyncAtRef.current = now;
    };

    useEffect(() => {
      let animationFrame = 0;

      function interpolateRemoteBodies() {
        for (const [id, target] of remoteTargetsRef.current) {
          const body = bodiesRef.current.get(id);
          if (!body) continue;
          Body.setPosition(body, {
            x: body.position.x + (target.x - body.position.x) * 0.22,
            y: body.position.y + (target.y - body.position.y) * 0.22,
          });
          Body.setAngle(
            body,
            body.angle + (target.angle - body.angle) * 0.22,
          );
        }
      }

      function renderBodies() {
        const world = worldRef.current;
        if (!world) return;
        const rect = world.getBoundingClientRect();
        const scaleX = rect.width / WORLD_WIDTH;
        const scaleY = rect.height / WORLD_HEIGHT;

        for (const [id, body] of bodiesRef.current) {
          const element = bodyElementsRef.current.get(id);
          if (!element) continue;
          const width = BODY_SIZE * scaleX;
          const height = BODY_SIZE * scaleY;
          element.style.width = width + "px";
          element.style.height = height + "px";
          element.style.transform =
            "translate(" +
            (body.position.x * scaleX - width / 2) +
            "px, " +
            (body.position.y * scaleY - height / 2) +
            "px) rotate(" +
            body.angle +
            "rad)";
        }
      }

      function animate(now: number) {
        const delta = lastFrameAtRef.current
          ? Math.min(now - lastFrameAtRef.current, 32)
          : 1000 / 60;
        lastFrameAtRef.current = now;

        if (controlsWorldRef.current) {
          Engine.update(engine, delta);
          const isMoving =
            draggedBodyRef.current ||
            [...bodiesRef.current.values()].some((body) => !body.isSleeping);
          if (isMoving) publishRef.current(now);
        } else {
          interpolateRemoteBodies();
        }

        renderBodies();
        animationFrame = requestAnimationFrame(animate);
      }

      animationFrame = requestAnimationFrame(animate);
      return () => cancelAnimationFrame(animationFrame);
    }, [engine]);

    const controlsWorld = data.controllerId === clientIdRef.current;
    const bodyIds = Object.keys(data.bodies);

    return (
      <section
        id="shared-physics-world"
        className="physics-app"
        ref={ref as Ref<HTMLElement>}
      >
        <style>{STYLES}</style>
        <header>
          <h1>Shared physics</h1>
          <p>Drag a block, then let go. Its Matter.js motion syncs to everyone.</p>
        </header>

        <div className="physics-toolbar">
          <button
            type="button"
            onClick={addBody}
            disabled={bodyIds.length >= MAX_BODIES}
          >
            Add body
          </button>
          <button type="button" onClick={resetBodies}>
            Reset
          </button>
          <span className="physics-status" role="status">
            {controlsWorld
              ? "You control the simulation"
              : "Watching shared motion"}
          </span>
        </div>

        <div
          ref={worldRef}
          className="physics-world"
          aria-label="Shared physics world"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {bodyIds.map((id, index) => (
            <button
              key={id}
              id={"physics-" + id}
              className="physics-body"
              type="button"
              data-body-id={id}
              aria-label={"Physics body " + id}
              onPointerDown={(event) => handlePointerDown(event, id)}
              ref={(element) => {
                if (element) bodyElementsRef.current.set(id, element);
                else bodyElementsRef.current.delete(id);
              }}
            >
              {index + 1}
            </button>
          ))}
        </div>

        <p className="physics-note">
          The last person to interact controls the simulation.
        </p>
      </section>
    );
  },
);

export default function App() {
  return (
    <PlayProvider initOptions={{ developmentMode: true }}>
      <SharedPhysics />
    </PlayProvider>
  );
}
`;
