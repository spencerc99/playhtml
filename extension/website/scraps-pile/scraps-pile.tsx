// ABOUTME: Builds a throwable physics pile from synthetic image, button, icon, and cursor scraps.
// ABOUTME: Renders an open crate with tunable circle collisions, gravity, rotation, and spring dragging.

import React, { useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { buildItems } from "../scraps-preview/demoScraps";

const PHYSICS = {
  gravity: 2200,
  velocityDamping: 0.995,
  angularDamping: 0.992,
  restitution: 0.15,
  spawnIntervalMs: 80,
  sleepVelocity: 18,
  sleepAngularVelocity: 0.06,
  sleepDistance: 2,
  sleepAngle: 0.03,
  sleepFrames: 24,
  spinImpactVelocity: 90,
  collisionSlop: 0.5,
  positionCorrection: 0.8,
  supportTolerance: 1,
  contactDamping: 0.86,
  relaxationIterations: 3,
  dragSpring: 92,
  dragDamping: 0.82,
  maxTimeStep: 1 / 30,
} as const;

const IMAGE_LONG_EDGES = [90, 130, 170] as const;
const CURSOR_SIZE = 40;
const WALL_FRICTION = 0.84;
const FLOOR_FRICTION = 0.9;
const MAX_THROW_SPEED = 2400;
// Below this, a crate measurement is treated as a transient mid-layout
// report rather than the real bounds (see the resize handler in
// ScrapsPilePage). The crate's CSS min-height/min-width keep it well above
// this at all real layout sizes.
const MIN_CRATE_DIMENSION = 100;

interface ScrapLayout {
  item: ScrapItem;
  width: number;
  height: number;
  radius: number;
  spawnOrder: number;
}

interface Body extends ScrapLayout {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  angle: number;
  angularVelocity: number;
  spawnAt: number;
  active: boolean;
  sleeping: boolean;
  stillFrames: number;
  onFloor: boolean;
  supported: boolean;
  restX: number;
  restY: number;
  restAngle: number;
  zIndex: number;
}

interface CrateBounds {
  width: number;
  height: number;
}

interface DragState {
  body: Body;
  pointerId: number;
  targetX: number;
  targetY: number;
  pointerVelocityX: number;
  pointerVelocityY: number;
  lastPointerX: number;
  lastPointerY: number;
  lastPointerTime: number;
  element: HTMLDivElement;
}

function clamp(minimum: number, maximum: number, value: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(key: string, salt: number): number {
  let value = hashString(`${key}:${salt}`);
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function imageDimensions(
  item: Extract<ScrapItem, { kind: "image" }>,
  longEdge: number,
): { width: number; height: number } {
  const naturalLongEdge = Math.max(item.naturalWidth, item.naturalHeight);
  if (naturalLongEdge <= 0) return { width: longEdge, height: longEdge };

  return {
    width: longEdge * (item.naturalWidth / naturalLongEdge),
    height: longEdge * (item.naturalHeight / naturalLongEdge),
  };
}

function buildLayouts(items: ScrapItem[]): ScrapLayout[] {
  const imageAreas = items
    .filter(
      (item): item is Extract<ScrapItem, { kind: "image" }> =>
        item.kind === "image",
    )
    .map((item) => item.naturalWidth * item.naturalHeight)
    .sort((left, right) => left - right);
  const lowerArea = imageAreas[Math.floor((imageAreas.length - 1) / 3)] ?? 0;
  const upperArea =
    imageAreas[Math.floor(((imageAreas.length - 1) * 2) / 3)] ?? 0;

  return items
    .map((item) => {
      switch (item.kind) {
        case "image": {
          const area = item.naturalWidth * item.naturalHeight;
          const tier = area <= lowerArea ? 0 : area <= upperArea ? 1 : 2;
          const dimensions = imageDimensions(item, IMAGE_LONG_EDGES[tier]);
          return {
            item,
            ...dimensions,
            radius: Math.max(dimensions.width, dimensions.height) * 0.42,
            spawnOrder: seededRandom(item.key, 1),
          };
        }
        case "button": {
          const width = clamp(80, 230, item.text.trim().length * 10 + 30);
          return {
            item,
            width,
            height: 40,
            radius: (width / 2) * 0.75,
            spawnOrder: seededRandom(item.key, 1),
          };
        }
        case "svg-icon": {
          const longEdge = 48 + seededRandom(item.key, 2) * 24;
          const naturalLongEdge = Math.max(item.width, item.height);
          const width = longEdge * (item.width / naturalLongEdge);
          const height = longEdge * (item.height / naturalLongEdge);
          return {
            item,
            width,
            height,
            radius: longEdge * 0.45,
            spawnOrder: seededRandom(item.key, 1),
          };
        }
        case "cursor":
          return {
            item,
            width: CURSOR_SIZE,
            height: CURSOR_SIZE,
            radius: CURSOR_SIZE / 2,
            spawnOrder: seededRandom(item.key, 1),
          };
      }
    })
    .sort((left, right) => left.spawnOrder - right.spawnOrder);
}

function createBodies(
  layouts: ScrapLayout[],
  bounds: CrateBounds,
  startTime: number,
): Body[] {
  return layouts.map((layout, index) => {
    const usableWidth = Math.max(0, bounds.width - layout.radius * 2);
    const x = layout.radius + usableWidth * seededRandom(layout.item.key, 3);
    const y = -layout.radius - seededRandom(layout.item.key, 4) * 52;
    const angle = (seededRandom(layout.item.key, 6) - 0.5) * 0.65;
    return {
      ...layout,
      x,
      y,
      velocityX: (seededRandom(layout.item.key, 5) - 0.5) * 90,
      velocityY: 0,
      angle,
      angularVelocity: (seededRandom(layout.item.key, 7) - 0.5) * 1.3,
      spawnAt: startTime + index * PHYSICS.spawnIntervalMs,
      active: false,
      sleeping: false,
      stillFrames: 0,
      onFloor: false,
      supported: false,
      restX: x,
      restY: y,
      restAngle: angle,
      zIndex: index + 1,
    };
  });
}

function wakeBody(body: Body): void {
  body.sleeping = false;
  body.stillFrames = 0;
  body.restX = body.x;
  body.restY = body.y;
  body.restAngle = body.angle;
}

// Re-anchors a body to the current crate bounds after a resize. Always
// recomputes x from the body's spawn seed against the CURRENT width rather
// than scaling the previous x by a ratio: ratio-scaling compounds across
// repeated resizes (and degenerates to 0 if a transient mid-layout
// measurement reports width 0), which is how bodies ended up permanently
// clustered against the left wall. Wakes the body and re-anchors its rest
// snapshot so the positional sleep criterion doesn't instantly re-sleep it
// at a position that's now stale.
function reflowBody(body: Body, bounds: CrateBounds, heightRatio: number): void {
  const usableWidth = Math.max(0, bounds.width - body.radius * 2);
  body.x = body.radius + usableWidth * seededRandom(body.item.key, 3);
  // Bodies that haven't landed yet stay airborne (renormalized against the
  // new height); landed bodies get rescaled so the pile keeps its relative
  // vertical position instead of jumping to the new floor instantly.
  if (Number.isFinite(heightRatio)) body.y *= heightRatio;
  constrainBody(body, bounds, false);
  wakeBody(body);
}

function constrainBody(
  body: Body,
  bounds: CrateBounds,
  applyResponse: boolean,
): void {
  const minimumX = body.radius;
  const maximumX = Math.max(minimumX, bounds.width - body.radius);
  const maximumY = Math.max(body.radius, bounds.height - body.radius);

  if (body.x < minimumX) {
    body.x = minimumX;
    if (applyResponse && !body.sleeping && body.velocityX < 0) {
      body.velocityX = -body.velocityX * PHYSICS.restitution;
      body.velocityY *= WALL_FRICTION;
    }
  } else if (body.x > maximumX) {
    body.x = maximumX;
    if (applyResponse && !body.sleeping && body.velocityX > 0) {
      body.velocityX = -body.velocityX * PHYSICS.restitution;
      body.velocityY *= WALL_FRICTION;
    }
  }

  if (body.y > maximumY) {
    body.y = maximumY;
    if (applyResponse && !body.sleeping && body.velocityY > 0) {
      body.velocityY = -body.velocityY * PHYSICS.restitution;
      body.velocityX *= FLOOR_FRICTION;
    }
  }
}

function resolveCollision(
  first: Body,
  second: Body,
  applyImpulse: boolean,
  grabbedBody: Body | undefined,
): void {
  if (!first.active || !second.active) return;

  const differenceX = second.x - first.x;
  const differenceY = second.y - first.y;
  const minimumDistance = first.radius + second.radius;
  const distanceSquared = differenceX * differenceX + differenceY * differenceY;
  if (distanceSquared >= minimumDistance * minimumDistance) return;

  const distance = Math.sqrt(distanceSquared);
  const normalX = distance > 0.001 ? differenceX / distance : 1;
  const normalY = distance > 0.001 ? differenceY / distance : 0;
  const overlap = minimumDistance - Math.max(distance, 0.001);
  const relativeVelocityX = second.velocityX - first.velocityX;
  const relativeVelocityY = second.velocityY - first.velocityY;
  const normalVelocity =
    relativeVelocityX * normalX + relativeVelocityY * normalY;

  if (
    applyImpulse &&
    normalVelocity < 0 &&
    (normalVelocity < -PHYSICS.spinImpactVelocity ||
      first === grabbedBody ||
      second === grabbedBody)
  ) {
    wakeBody(first);
    wakeBody(second);
  }

  const firstInverseMass = first.sleeping
    ? 0
    : (first === grabbedBody ? 0.08 : 1) / (first.radius * first.radius);
  const secondInverseMass = second.sleeping
    ? 0
    : (second === grabbedBody ? 0.08 : 1) / (second.radius * second.radius);
  const totalInverseMass = firstInverseMass + secondInverseMass;
  const correction =
    Math.max(0, overlap - PHYSICS.collisionSlop) * PHYSICS.positionCorrection;

  if (totalInverseMass > 0 && correction > 0) {
    first.x -= normalX * correction * (firstInverseMass / totalInverseMass);
    first.y -= normalY * correction * (firstInverseMass / totalInverseMass);
    second.x += normalX * correction * (secondInverseMass / totalInverseMass);
    second.y += normalY * correction * (secondInverseMass / totalInverseMass);
  }

  if (!applyImpulse || normalVelocity >= 0 || totalInverseMass === 0) return;

  // Restitution slop: resting contacts get a fully inelastic response, so the
  // pile can come to rest instead of absorbing a micro-bounce every frame.
  const restitution =
    normalVelocity < -PHYSICS.spinImpactVelocity ? PHYSICS.restitution : 0;
  const impulse = (-(1 + restitution) * normalVelocity) / totalInverseMass;

  if (firstInverseMass > 0) {
    first.velocityX -= impulse * firstInverseMass * normalX;
    first.velocityY -= impulse * firstInverseMass * normalY;
  }
  if (secondInverseMass > 0) {
    second.velocityX += impulse * secondInverseMass * normalX;
    second.velocityY += impulse * secondInverseMass * normalY;
  }

  if (normalVelocity < -PHYSICS.spinImpactVelocity) {
    const tangentVelocity =
      relativeVelocityX * -normalY + relativeVelocityY * normalX;
    if (firstInverseMass > 0) {
      first.angularVelocity -=
        (tangentVelocity / Math.max(1, first.radius)) * 0.08;
    }
    if (secondInverseMass > 0) {
      second.angularVelocity +=
        (tangentVelocity / Math.max(1, second.radius)) * 0.08;
    }
  }
}

function updateSupport(bodies: Body[], bounds: CrateBounds): void {
  for (const body of bodies) {
    body.onFloor =
      body.active &&
      body.y >= bounds.height - body.radius - PHYSICS.supportTolerance;
    body.supported = false;
  }

  let supportChanged = true;
  while (supportChanged) {
    supportChanged = false;
    for (let firstIndex = 0; firstIndex < bodies.length; firstIndex += 1) {
      const first = bodies[firstIndex];
      if (!first.active) continue;

      for (
        let secondIndex = firstIndex + 1;
        secondIndex < bodies.length;
        secondIndex += 1
      ) {
        const second = bodies[secondIndex];
        if (!second.active) continue;

        const differenceX = second.x - first.x;
        const differenceY = second.y - first.y;
        const contactDistance =
          first.radius + second.radius + PHYSICS.supportTolerance;
        const distanceSquared =
          differenceX * differenceX + differenceY * differenceY;
        if (distanceSquared > contactDistance * contactDistance) continue;

        const distance = Math.sqrt(distanceSquared);
        const normalY = distance > 0.001 ? differenceY / distance : 0;
        if (
          normalY > 0.35 &&
          !first.supported &&
          (second.onFloor || second.supported)
        ) {
          first.supported = true;
          supportChanged = true;
        } else if (
          normalY < -0.35 &&
          !second.supported &&
          (first.onFloor || first.supported)
        ) {
          second.supported = true;
          supportChanged = true;
        }
      }
    }
  }
}

function updateBodyElement(
  body: Body,
  element: HTMLDivElement | undefined,
  grabbedBody: Body | undefined,
): void {
  if (!element) return;

  element.style.visibility = body.active ? "visible" : "hidden";
  if (!body.active) return;

  const left = body.x - body.width / 2;
  const top = body.y - body.height / 2;
  element.style.transform = `translate3d(${left}px, ${top}px, 0) rotate(${body.angle}rad)`;
  element.style.zIndex = String(body === grabbedBody ? 2000 : body.zIndex);
  element.style.setProperty("--counter-rotation", `${-body.angle}rad`);
  element.classList.toggle("is-grabbed", body === grabbedBody);
}

function ScrapContent({ item }: { item: ScrapItem }) {
  switch (item.kind) {
    case "image":
      return (
        <img
          className="scrap-crate__image"
          src={item.src}
          alt={item.alt ?? ""}
          draggable={false}
        />
      );
    case "button":
      return (
        <span
          className="scrap-crate__button"
          style={item.styles as React.CSSProperties}
        >
          {item.innerSvg && (
            <span
              className="scrap-crate__button-icon"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: item.innerSvg }}
            />
          )}
          {item.text}
        </span>
      );
    case "svg-icon":
      return (
        <span
          className="scrap-crate__svg"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: item.markup }}
        />
      );
    case "cursor":
      return (
        <img
          className="scrap-crate__cursor"
          src={item.url}
          alt=""
          draggable={false}
        />
      );
  }
}

const PAGE_STYLES = `
  * {
    box-sizing: border-box;
  }

  html,
  body,
  #reactContent {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  body {
    background: #faf7f2;
    color: #3d3833;
    user-select: none;
  }

  .scrap-page {
    position: relative;
    width: 100vw;
    height: 100vh;
    min-height: 560px;
    overflow: hidden;
    background:
      radial-gradient(circle at 18% 14%, rgba(138, 106, 58, 0.04), transparent 28%),
      #faf7f2;
  }

  .scrap-page__wordmark {
    position: absolute;
    top: 14px;
    left: 20px;
    z-index: 20;
    font-family: "Source Serif 4", Georgia, serif;
    font-size: 20px;
    font-style: italic;
    font-weight: 200;
    pointer-events: none;
  }

  .scrap-page__header {
    position: absolute;
    top: 14px;
    left: 50%;
    z-index: 20;
    width: min(560px, calc(100vw - 260px));
    text-align: center;
    transform: translateX(-50%);
    pointer-events: none;
  }

  .scrap-page__title {
    margin: 0;
    font-family: "Martian Mono", monospace;
    font-size: 15px;
    font-weight: 500;
    letter-spacing: 0.04em;
  }

  .scrap-page__subtitle {
    margin: 5px 0 0;
    color: #827a72;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    line-height: 1.5;
  }

  .scrap-crate {
    position: absolute;
    top: 92px;
    left: 50%;
    width: min(78vw, 1180px);
    height: min(62vh, 700px);
    min-height: 390px;
    padding: 13px 18px 26px;
    border: 3px solid #664925;
    border-radius: 5px 5px 9px 9px;
    background: #8a6a3a;
    box-shadow:
      0 18px 38px rgba(83, 57, 24, 0.18),
      inset 0 2px 0 rgba(255, 245, 221, 0.2),
      inset 0 -8px 14px rgba(72, 47, 19, 0.2);
    transform: translateX(-50%);
  }

  .scrap-crate::before {
    position: absolute;
    top: 9px;
    right: 11px;
    bottom: 21px;
    left: 11px;
    z-index: 1;
    border: 7px solid #73542d;
    border-top-width: 9px;
    box-shadow:
      inset 12px 0 16px rgba(92, 63, 29, 0.14),
      inset -12px 0 16px rgba(92, 63, 29, 0.14);
    content: "";
    pointer-events: none;
  }

  .scrap-crate__interior {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 100%;
    background:
      repeating-linear-gradient(
        5deg,
        rgba(116, 88, 52, 0.025) 0,
        rgba(116, 88, 52, 0.025) 1px,
        transparent 1px,
        transparent 8px
      ),
      #f5f0e8;
    box-shadow:
      inset 0 12px 16px rgba(94, 65, 31, 0.12),
      inset 10px 0 13px rgba(94, 65, 31, 0.08),
      inset -10px 0 13px rgba(94, 65, 31, 0.08);
    touch-action: none;
  }

  .scrap-crate__front {
    position: absolute;
    right: -3px;
    bottom: -3px;
    left: -3px;
    z-index: 1000;
    height: 46px;
    border: 3px solid #664925;
    border-radius: 0 0 8px 8px;
    background:
      linear-gradient(180deg, rgba(255, 240, 207, 0.12), transparent 38%),
      #806033;
    box-shadow:
      0 8px 16px rgba(83, 57, 24, 0.16),
      inset 0 -5px 8px rgba(72, 47, 19, 0.16);
    pointer-events: none;
  }

  .scrap-crate__hud {
    position: absolute;
    top: 50%;
    left: 50%;
    display: flex;
    gap: 7px;
    margin: 0;
    padding: 0;
    list-style: none;
    transform: translate(-50%, -50%);
  }

  .scrap-crate__chip {
    padding: 4px 7px 3px;
    border: 1px solid rgba(76, 51, 24, 0.34);
    border-radius: 2px;
    background: #e9ddc8;
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.28);
    color: #574328;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    line-height: 1;
    white-space: nowrap;
  }

  .scrap-crate__body {
    --counter-rotation: 0rad;
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    visibility: hidden;
    border: 0;
    background: transparent;
    cursor: grab;
    outline: none;
    transform-origin: center;
    will-change: transform;
  }

  .scrap-crate__body:focus-visible {
    filter: drop-shadow(0 0 0.35rem rgba(91, 141, 184, 0.8));
  }

  .scrap-crate__body.is-grabbed {
    cursor: grabbing;
    filter: drop-shadow(0 13px 10px rgba(61, 56, 51, 0.28));
  }

  .scrap-crate__body.is-grabbed > .scrap-crate__content {
    transform: scale(1.07);
  }

  .scrap-crate__content {
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    transition: transform 110ms ease;
  }

  .scrap-crate__image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }

  .scrap-crate__button {
    display: inline-flex !important;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    white-space: nowrap;
    pointer-events: none;
  }

  .scrap-crate__button-icon {
    display: inline-flex;
    width: 1em;
    height: 1em;
    flex: 0 0 auto;
    margin-right: 0.45em;
    pointer-events: none;
  }

  .scrap-crate__button-icon > svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .scrap-crate__svg {
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .scrap-crate__svg > svg {
    display: block;
    max-width: 100%;
    max-height: 100%;
  }

  .scrap-crate__cursor {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    image-rendering: pixelated;
    pointer-events: none;
  }

  .scrap-crate__label {
    position: absolute;
    top: calc(100% + 8px);
    left: 50%;
    z-index: 10;
    width: max-content;
    max-width: 260px;
    padding: 6px 8px 5px;
    overflow: hidden;
    border: 1px solid rgba(91, 68, 39, 0.28);
    border-radius: 2px;
    background: rgba(245, 240, 232, 0.98);
    box-shadow: 0 5px 12px rgba(61, 56, 51, 0.15);
    color: #574c40;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    line-height: 1.3;
    opacity: 0;
    pointer-events: none;
    text-overflow: ellipsis;
    transform:
      translateX(-50%)
      rotate(var(--counter-rotation))
      translateY(3px);
    transition: opacity 100ms ease, transform 100ms ease;
    white-space: nowrap;
  }

  .scrap-crate__body:not(.is-grabbed):hover .scrap-crate__label {
    opacity: 1;
    transform:
      translateX(-50%)
      rotate(var(--counter-rotation))
      translateY(0);
  }

  @media (max-width: 760px) {
    .scrap-page__wordmark {
      left: 14px;
      font-size: 17px;
    }

    .scrap-page__header {
      top: 50px;
      width: calc(100vw - 30px);
    }

    .scrap-crate {
      top: 102px;
      width: calc(100vw - 28px);
      height: calc(100vh - 128px);
      min-height: 390px;
    }

    .scrap-crate__hud {
      gap: 3px;
    }

    .scrap-crate__chip {
      padding-right: 4px;
      padding-left: 4px;
      font-size: 7px;
    }
  }
`;

export function ScrapsPilePage() {
  const items = useMemo(() => buildItems(), []);
  const layouts = useMemo(() => buildLayouts(items), [items]);
  const crateRef = useRef<HTMLDivElement>(null);
  const bodyElements = useRef(new Map<string, HTMLDivElement>());
  const bodiesRef = useRef<Body[]>([]);
  const boundsRef = useRef<CrateBounds>({ width: 0, height: 0 });
  const dragRef = useRef<DragState | undefined>(undefined);
  const nextZIndex = useRef(layouts.length + 1);

  const counts = useMemo(
    () => ({
      images: items.filter((item) => item.kind === "image").length,
      buttons: items.filter((item) => item.kind === "button").length,
      icons: items.filter((item) => item.kind === "svg-icon").length,
      cursors: items.filter((item) => item.kind === "cursor").length,
    }),
    [items],
  );

  useEffect(() => {
    const crate = crateRef.current;
    if (!crate) return;

    const resize = () => {
      const previousBounds = boundsRef.current;
      const rect = crate.getBoundingClientRect();
      // The crate always has a nonzero laid-out size (CSS min-height/min-width
      // guarantee this). A 0x0 (or otherwise degenerate) measurement is a
      // transient mid-layout report from the ResizeObserver, not the real
      // bounds -- reflowing bodies against it would collapse every spawn x to
      // that body's own radius, piling everything against the left wall.
      // Ignore it and wait for a real measurement instead.
      if (rect.width < MIN_CRATE_DIMENSION || rect.height < MIN_CRATE_DIMENSION) {
        return;
      }
      const nextBounds = { width: rect.width, height: rect.height };
      boundsRef.current = nextBounds;

      if (bodiesRef.current.length === 0) {
        bodiesRef.current = createBodies(
          layouts,
          nextBounds,
          performance.now() + 180,
        );
        return;
      }

      const widthChanged =
        Math.abs(nextBounds.width - previousBounds.width) > 2;
      const heightChanged =
        Math.abs(nextBounds.height - previousBounds.height) > 2;
      if (!widthChanged && !heightChanged) return;

      const heightRatio =
        previousBounds.height > 0
          ? nextBounds.height / previousBounds.height
          : 1;
      const grabbedBody = dragRef.current?.body;
      for (const body of bodiesRef.current) {
        if (body === grabbedBody) continue;
        reflowBody(body, nextBounds, heightRatio);
      }
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(crate);

    let animationFrame = 0;
    let previousTime = performance.now();

    const animate = (time: number) => {
      const elapsed = Math.min(
        Math.max(0, (time - previousTime) / 1000),
        PHYSICS.maxTimeStep,
      );
      previousTime = time;
      const bounds = boundsRef.current;
      const bodies = bodiesRef.current;
      const drag = dragRef.current;
      const grabbedBody = drag?.body;

      for (const body of bodies) {
        if (!body.active && time >= body.spawnAt) {
          body.active = true;
          wakeBody(body);
        }
      }

      const substeps = Math.max(1, Math.ceil(elapsed / (1 / 120)));
      const stepElapsed = elapsed / substeps;
      const stepScale = stepElapsed * 60;
      const velocityDamping = Math.pow(PHYSICS.velocityDamping, stepScale);
      const angularDamping = Math.pow(PHYSICS.angularDamping, stepScale);
      const springDamping = Math.pow(PHYSICS.dragDamping, stepScale);

      for (let substep = 0; substep < substeps; substep += 1) {
        for (const body of bodies) {
          if (!body.active || body.sleeping) continue;

          body.velocityY += PHYSICS.gravity * stepElapsed;
          body.velocityX *= velocityDamping;
          body.velocityY *= velocityDamping;
          body.angularVelocity *= angularDamping;

          if (body === grabbedBody && drag) {
            body.velocityX +=
              (drag.targetX - body.x) * PHYSICS.dragSpring * stepElapsed;
            body.velocityY +=
              (drag.targetY - body.y) * PHYSICS.dragSpring * stepElapsed;
            body.velocityX *= springDamping;
            body.velocityY *= springDamping;
          }

          body.x += body.velocityX * stepElapsed;
          body.y += body.velocityY * stepElapsed;
          body.angle += body.angularVelocity * stepElapsed;
          constrainBody(body, bounds, true);
        }

        for (
          let iteration = 0;
          iteration < PHYSICS.relaxationIterations;
          iteration += 1
        ) {
          for (
            let firstIndex = 0;
            firstIndex < bodies.length;
            firstIndex += 1
          ) {
            for (
              let secondIndex = firstIndex + 1;
              secondIndex < bodies.length;
              secondIndex += 1
            ) {
              resolveCollision(
                bodies[firstIndex],
                bodies[secondIndex],
                iteration === 0,
                grabbedBody,
              );
            }
          }
          for (const body of bodies) {
            if (body.active) constrainBody(body, bounds, false);
          }
        }
      }

      updateSupport(bodies, bounds);

      const contactDamping = Math.pow(PHYSICS.contactDamping, elapsed * 60);
      for (const body of bodies) {
        if (
          body.active &&
          !body.sleeping &&
          body !== grabbedBody &&
          (body.onFloor || body.supported)
        ) {
          body.velocityX *= contactDamping;
          body.angularVelocity *= contactDamping;
          // A body pinned in place by neighbors can still accumulate runaway
          // spin from repeated tangential impulses; brake it hard.
          const pinnedDrift = Math.hypot(
            body.x - body.restX,
            body.y - body.restY,
          );
          if (pinnedDrift < 1 && Math.abs(body.angularVelocity) > 1.5) {
            body.angularVelocity *= 0.8;
          }
        }
        if (body.active && body.sleeping && !body.onFloor && !body.supported) {
          wakeBody(body);
        }
      }

      for (const body of bodies) {
        if (body.active && body !== grabbedBody && !body.sleeping) {
          const restDrift = Math.hypot(
            body.x - body.restX,
            body.y - body.restY,
          );
          const restTurn = Math.abs(body.angle - body.restAngle);
          const linearSpeed = Math.hypot(body.velocityX, body.velocityY);
          if (
            (body.onFloor || body.supported) &&
            linearSpeed < PHYSICS.sleepVelocity &&
            Math.abs(body.angularVelocity) < PHYSICS.sleepAngularVelocity &&
            restDrift < PHYSICS.sleepDistance &&
            restTurn < PHYSICS.sleepAngle
          ) {
            body.stillFrames += 1;
            if (body.stillFrames >= PHYSICS.sleepFrames) {
              body.velocityX = 0;
              body.velocityY = 0;
              body.angularVelocity = 0;
              body.sleeping = true;
            }
          } else {
            body.restX = body.x;
            body.restY = body.y;
            body.restAngle = body.angle;
            body.stillFrames = 0;
          }
        }

        updateBodyElement(
          body,
          bodyElements.current.get(body.item.id),
          grabbedBody,
        );
      }

      scheduleFrame();
    };

    let timeoutHandle = 0;
    let nextTick = 0;
    let pendingTick = 0;
    let stopped = false;
    const scheduleFrame = () => {
      if (stopped) return;
      const tickId = nextTick + 1;
      nextTick = tickId;
      pendingTick = tickId;
      const frameHandle = requestAnimationFrame((time) => tick(tickId, time));
      animationFrame = frameHandle;
      timeoutHandle = window.setTimeout(() => {
        cancelAnimationFrame(frameHandle);
        tick(tickId, performance.now());
      }, 40);
    };
    const tick = (tickId: number, time: number) => {
      if (stopped || tickId !== pendingTick) return;
      pendingTick = 0;
      window.clearTimeout(timeoutHandle);
      animate(time);
    };

    scheduleFrame();
    return () => {
      stopped = true;
      pendingTick = 0;
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeoutHandle);
    };
  }, [layouts]);

  const pointerPosition = (event: React.PointerEvent<HTMLDivElement>) => {
    const crate = crateRef.current;
    if (!crate) return;
    const rect = crate.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const grabBody = (
    event: React.PointerEvent<HTMLDivElement>,
    itemId: string,
  ) => {
    const position = pointerPosition(event);
    const body = bodiesRef.current.find(
      (candidate) => candidate.item.id === itemId,
    );
    if (!position || !body || !body.active) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    wakeBody(body);
    body.zIndex = nextZIndex.current;
    nextZIndex.current += 1;
    dragRef.current = {
      body,
      pointerId: event.pointerId,
      targetX: position.x,
      targetY: position.y,
      pointerVelocityX: 0,
      pointerVelocityY: 0,
      lastPointerX: position.x,
      lastPointerY: position.y,
      lastPointerTime: event.timeStamp,
      element: event.currentTarget,
    };
  };

  const moveGrabbedBody = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const position = pointerPosition(event);
    if (!drag || drag.pointerId !== event.pointerId || !position) return;

    const elapsed = Math.max(8, event.timeStamp - drag.lastPointerTime) / 1000;
    const instantVelocityX = (position.x - drag.lastPointerX) / elapsed;
    const instantVelocityY = (position.y - drag.lastPointerY) / elapsed;
    drag.pointerVelocityX =
      drag.pointerVelocityX * 0.35 + instantVelocityX * 0.65;
    drag.pointerVelocityY =
      drag.pointerVelocityY * 0.35 + instantVelocityY * 0.65;
    drag.targetX = position.x;
    drag.targetY = position.y;
    drag.lastPointerX = position.x;
    drag.lastPointerY = position.y;
    drag.lastPointerTime = event.timeStamp;
  };

  const releaseBody = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    wakeBody(drag.body);
    drag.body.velocityX = clamp(
      -MAX_THROW_SPEED,
      MAX_THROW_SPEED,
      drag.pointerVelocityX,
    );
    drag.body.velocityY = clamp(
      -MAX_THROW_SPEED,
      MAX_THROW_SPEED,
      drag.pointerVelocityY,
    );
    drag.body.angularVelocity +=
      (drag.body.velocityX / Math.max(1, drag.body.radius)) * 0.16;
    drag.element.classList.remove("is-grabbed");
    dragRef.current = undefined;
  };

  return (
    <main className="scrap-page">
      <style>{PAGE_STYLES}</style>
      <span className="scrap-page__wordmark">we were online</span>
      <header className="scrap-page__header">
        <h1 className="scrap-page__title">scrap crate</h1>
        <p className="scrap-page__subtitle">
          grab a piece of the internet and toss it back in
        </p>
      </header>
      <section className="scrap-crate" aria-label="Interactive scrap crate">
        <div ref={crateRef} className="scrap-crate__interior">
          {layouts.map((layout) => (
            <div
              key={layout.item.id}
              ref={(element) => {
                if (element) {
                  bodyElements.current.set(layout.item.id, element);
                } else {
                  bodyElements.current.delete(layout.item.id);
                }
              }}
              className="scrap-crate__body"
              style={{ width: layout.width, height: layout.height }}
              role="button"
              tabIndex={0}
              aria-label={`${layout.item.pageTitle} from ${layout.item.domain}`}
              onPointerDown={(event) => grabBody(event, layout.item.id)}
              onPointerMove={moveGrabbedBody}
              onPointerUp={releaseBody}
              onPointerCancel={releaseBody}
            >
              <span className="scrap-crate__content">
                <ScrapContent item={layout.item} />
              </span>
              <span className="scrap-crate__label">
                {layout.item.pageTitle} · {layout.item.domain}
              </span>
            </div>
          ))}
        </div>
        <div className="scrap-crate__front">
          <ul className="scrap-crate__hud" aria-label="Scrap counts">
            <li className="scrap-crate__chip">images {counts.images}</li>
            <li className="scrap-crate__chip">buttons {counts.buttons}</li>
            <li className="scrap-crate__chip">icons {counts.icons}</li>
            <li className="scrap-crate__chip">cursors {counts.cursors}</li>
          </ul>
        </div>
      </section>
    </main>
  );
}

const container = document.getElementById("reactContent");
if (container) {
  createRoot(container).render(<ScrapsPilePage />);
}
