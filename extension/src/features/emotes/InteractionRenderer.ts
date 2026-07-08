// ABOUTME: Renders the four two-cursor interaction emotes (heart, highfive, nuzzle, poke) with WAAPI.
// ABOUTME: Always draws its own ghost cursors for sender and target — sidesteps "peer has no
// ABOUTME: node" (target may be self) and "self has no node" (sender may be self) uniformly.
// ABOUTME: The caller (index.ts) hides both participants' real cursor nodes via cursorClient
// ABOUTME: hideCursor/showCursor around the animation so we don't see real cursor + ghost. Caveat:
// ABOUTME: playhtml re-shows a hidden cursor on the next position update, so a participant who
// ABOUTME: actively moves mid-interaction may briefly flash their real cursor.

import { cursorSvg } from "./EmoteGhostRenderer";
import { angleDeg, distance, travelToward, midpoint, type Point } from "./interaction-geometry";

const GHOST_SIZE = 32;
const GHOST_OFFSET = GHOST_SIZE / 2;
const Z_INDEX = 2147483646;

const POKE_MAX_TRAVEL_PX = 120;
const NUZZLE_DRIFT_FRACTION = 0.35;
const NUZZLE_LEAN_IN_PX = 14;
const HIGHFIVE_REACH_FRACTION = 0.4;
const WARM_COLOR = "#e8863f";

export interface InteractionActors {
  senderPos: Point;
  senderColor: string;
  targetPos: Point;
  targetColor: string;
  /** True when both parties high-fived each other within the mutual window. */
  mutual?: boolean;
}

function makeGhost(pos: Point, color: string): HTMLElement {
  const node = document.createElement("div");
  node.className = "emote-ghost interaction-ghost";
  node.style.cssText = `position:fixed;left:${pos.x - GHOST_OFFSET}px;top:${
    pos.y - GHOST_OFFSET
  }px;pointer-events:none;z-index:${Z_INDEX};opacity:0.85;transform-origin:center;`;
  node.innerHTML = cursorSvg(color);
  document.body.appendChild(node);
  return node;
}

function makeParticle(pos: Point, glyph: string, color: string): HTMLElement {
  const node = document.createElement("div");
  node.className = "interaction-particle";
  node.textContent = glyph;
  node.style.cssText = `position:fixed;left:${pos.x}px;top:${
    pos.y
  }px;pointer-events:none;z-index:${Z_INDEX};color:${color};font-size:20px;transform:translate(-50%,-50%);`;
  document.body.appendChild(node);
  return node;
}

function cleanupAfter(node: HTMLElement, ms: number): void {
  setTimeout(() => node.remove(), ms);
}

function animate(
  node: HTMLElement,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
): void {
  if (typeof node.animate !== "function") return;
  node.animate(frames, options);
}

/** Sender jabs toward target; target recoils on contact. */
function playPoke(actors: InteractionActors, durationMs: number): void {
  const angle = angleDeg(actors.senderPos, actors.targetPos);
  const jab = travelToward(actors.senderPos, actors.targetPos, POKE_MAX_TRAVEL_PX, POKE_MAX_TRAVEL_PX);
  const dx = jab.x - actors.senderPos.x;
  const dy = jab.y - actors.senderPos.y;

  const senderGhost = makeGhost(actors.senderPos, actors.senderColor);
  animate(
    senderGhost,
    [
      { transform: "translate(0, 0)" },
      { transform: `translate(${dx}px, ${dy}px)`, offset: 0.38 },
      { transform: `translate(${dx}px, ${dy}px)`, offset: 0.55 },
      { transform: "translate(0, 0)" },
    ],
    { duration: durationMs, easing: "ease-out" },
  );

  const targetGhost = makeGhost(actors.targetPos, actors.targetColor);
  const recoilRad = (angle * Math.PI) / 180;
  const recoilDist = 18;
  const rx = Math.cos(recoilRad) * recoilDist;
  const ry = Math.sin(recoilRad) * recoilDist;
  animate(
    targetGhost,
    [
      { transform: "translate(0, 0) rotate(0deg)", offset: 0 },
      { transform: "translate(0, 0) rotate(0deg)", offset: 0.37 },
      { transform: `translate(${rx}px, ${ry}px) rotate(14deg)`, offset: 0.5 },
      { transform: "translate(0, 0) rotate(0deg)", offset: 1 },
    ],
    { duration: durationMs, easing: "ease-out" },
  );

  cleanupAfter(senderGhost, durationMs);
  cleanupAfter(targetGhost, durationMs);
}

/** Sender pulses; a heart particle travels sender->target; target warms on arrival. */
function playHeart(actors: InteractionActors, durationMs: number): void {
  const senderGhost = makeGhost(actors.senderPos, actors.senderColor);
  animate(
    senderGhost,
    [
      { transform: "scale(1)" },
      { transform: "scale(1.35)", offset: 0.3 },
      { transform: "scale(1)" },
    ],
    { duration: durationMs, easing: "ease-out" },
  );

  const particle = makeParticle(actors.senderPos, "♥", "#c4724e");
  const landMs = Math.round(durationMs * 0.7);
  animate(
    particle,
    [
      {
        transform: `translate(calc(-50% + ${actors.senderPos.x - actors.senderPos.x}px), -50%) scale(1)`,
        offset: 0,
      },
      {
        transform: `translate(calc(-50% + ${actors.targetPos.x - actors.senderPos.x}px), calc(-50% + ${
          actors.targetPos.y - actors.senderPos.y
        }px)) scale(1.4)`,
        offset: 0.7,
      },
      {
        transform: `translate(calc(-50% + ${actors.targetPos.x - actors.senderPos.x}px), calc(-50% + ${
          actors.targetPos.y - actors.senderPos.y
        }px)) scale(1.8)`,
        offset: 1,
      },
    ],
    { duration: durationMs, easing: "ease-in-out", fill: "forwards" },
  );
  animate(particle, [{ opacity: 1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], {
    duration: durationMs,
    easing: "linear",
    fill: "forwards",
  });

  const warmGhost = makeGhost(actors.targetPos, actors.targetColor);
  setTimeout(() => {
    warmGhost.innerHTML = cursorSvg(WARM_COLOR);
    animate(
      warmGhost,
      [
        { transform: "scale(1)" },
        { transform: "scale(1.3)", offset: 0.4 },
        { transform: "scale(1)" },
      ],
      { duration: durationMs - landMs, easing: "ease-out" },
    );
  }, landMs);

  cleanupAfter(senderGhost, durationMs);
  cleanupAfter(particle, durationMs);
  cleanupAfter(warmGhost, durationMs);
}

/** Both cursors reach toward the midpoint and touch, then return. */
function playHighfive(actors: InteractionActors, durationMs: number): void {
  const mid = midpoint(actors.senderPos, actors.targetPos);
  const senderGhost = makeGhost(actors.senderPos, actors.senderColor);
  const targetGhost = makeGhost(actors.targetPos, actors.targetColor);

  const bonusScale = actors.mutual ? 1.25 : 1.1;

  const reachTransform = (from: Point) => {
    const reach = travelToward(from, mid, distance(from, mid) * HIGHFIVE_REACH_FRACTION, Infinity);
    return `translate(${reach.x - from.x}px, ${reach.y - from.y}px)`;
  };

  const senderReach = reachTransform(actors.senderPos);
  const targetReach = reachTransform(actors.targetPos);
  const senderAngle = angleDeg(actors.senderPos, mid);
  const targetAngle = angleDeg(actors.targetPos, mid);

  animate(
    senderGhost,
    [
      { transform: "translate(0, 0) scale(1) rotate(0deg)", offset: 0 },
      {
        transform: `${senderReach} scale(${bonusScale}) rotate(${senderAngle * 0.15}deg)`,
        offset: 0.5,
      },
      {
        transform: `${senderReach} scale(${bonusScale}) rotate(${senderAngle * 0.15}deg)`,
        offset: 0.65,
      },
      { transform: "translate(0, 0) scale(1) rotate(0deg)", offset: 1 },
    ],
    { duration: durationMs, easing: "ease-out" },
  );
  animate(
    targetGhost,
    [
      { transform: "translate(0, 0) scale(1) rotate(0deg)", offset: 0 },
      {
        transform: `${targetReach} scale(${bonusScale}) rotate(${targetAngle * 0.15}deg)`,
        offset: 0.5,
      },
      {
        transform: `${targetReach} scale(${bonusScale}) rotate(${targetAngle * 0.15}deg)`,
        offset: 0.65,
      },
      { transform: "translate(0, 0) scale(1) rotate(0deg)", offset: 1 },
    ],
    { duration: durationMs, easing: "ease-out" },
  );

  cleanupAfter(senderGhost, durationMs);
  cleanupAfter(targetGhost, durationMs);
}

/** Sender drifts toward target and leans; target leans in toward sender. */
function playNuzzle(actors: InteractionActors, durationMs: number): void {
  const senderGhost = makeGhost(actors.senderPos, actors.senderColor);
  const targetGhost = makeGhost(actors.targetPos, actors.targetColor);

  const drift = travelToward(
    actors.senderPos,
    actors.targetPos,
    distance(actors.senderPos, actors.targetPos) * NUZZLE_DRIFT_FRACTION,
    Infinity,
  );
  const dx = drift.x - actors.senderPos.x;
  const dy = drift.y - actors.senderPos.y;

  animate(
    senderGhost,
    [
      { transform: "translate(0, 0) rotate(0deg)", offset: 0 },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5}px) rotate(-10deg)`, offset: 0.33 },
      { transform: `translate(${dx}px, ${dy}px) rotate(10deg)`, offset: 0.66 },
      { transform: "translate(0, 0) rotate(0deg)", offset: 1 },
    ],
    { duration: durationMs, easing: "ease-in-out" },
  );

  const leanAngleRad = (angleDeg(actors.targetPos, actors.senderPos) * Math.PI) / 180;
  const lx = Math.cos(leanAngleRad) * NUZZLE_LEAN_IN_PX;
  const ly = Math.sin(leanAngleRad) * NUZZLE_LEAN_IN_PX;
  animate(
    targetGhost,
    [
      { transform: "translate(0, 0) rotate(0deg)", offset: 0 },
      { transform: "translate(0, 0) rotate(0deg)", offset: 0.3 },
      { transform: `translate(${lx}px, ${ly}px) rotate(12deg)`, offset: 0.6 },
      { transform: "translate(0, 0) rotate(0deg)", offset: 1 },
    ],
    { duration: durationMs, easing: "ease-out" },
  );

  cleanupAfter(senderGhost, durationMs);
  cleanupAfter(targetGhost, durationMs);
}

const PLAYERS: Record<string, (actors: InteractionActors, durationMs: number) => void> = {
  poke: playPoke,
  heart: playHeart,
  highfive: playHighfive,
  nuzzle: playNuzzle,
};

export function playInteraction(
  emoteId: string,
  actors: InteractionActors,
  durationMs: number,
): boolean {
  const player = PLAYERS[emoteId];
  if (!player) return false;
  player(actors, durationMs);
  return true;
}
