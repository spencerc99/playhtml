// ABOUTME: Generates deterministic ink-wash scenery for the commute windows.
// ABOUTME: Renders layered mountains, clouds, water, and trees as animated SVG.

import React, { useMemo } from "react";

const STRIP_WIDTH = 2200;
const STRIP_HEIGHT = 120;

interface Point {
  x: number;
  y: number;
}

interface TreeMark {
  x: number;
  y: number;
  height: number;
  lean: number;
}

interface RidgePeak {
  center: number;
  height: number;
  leftWidth: number;
  rightWidth: number;
}

export interface LandscapePlan {
  clouds: string[];
  mountain: string;
  contours: string[];
  ridgeTrees: TreeMark[];
  foregroundTrees: TreeMark[];
  water: string[];
}

function hashSeed(seed: string): number {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function seededRandom(seed: string): () => number {
  let value = hashSeed(seed);
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function between(random: () => number, min: number, max: number): number {
  return min + random() * (max - min);
}

function smoothPath(points: Point[]): string {
  if (points.length < 2) return "";
  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    const midX = (point.x + next.x) / 2;
    const midY = (point.y + next.y) / 2;
    path += ` Q ${point.x.toFixed(1)} ${point.y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }

  const last = points[points.length - 1];
  return `${path} T ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
}

function makeRidge(
  random: () => number,
  baseline: number,
  minY: number,
  step: number,
): Point[] {
  const points: Point[] = [{ x: 0, y: baseline }];
  const availableHeight = baseline - minY;
  const peaks: RidgePeak[] = [];
  let peakCenter = between(random, 100, 260);

  while (peakCenter < STRIP_WIDTH) {
    peaks.push({
      center: peakCenter,
      height: between(random, availableHeight * 0.42, availableHeight * 0.8),
      leftWidth: between(random, 120, 210),
      rightWidth: between(random, 140, 230),
    });
    peakCenter += between(random, 260, 380);
  }

  const shoulderFrequency = between(random, 5, 8);
  const shoulderPhase = between(random, 0, Math.PI * 2);

  for (let x = step; x < STRIP_WIDTH; x += step) {
    const peakHeight = peaks.reduce((highest, peak) => {
      const distance = x - peak.center;
      const width = distance < 0 ? peak.leftWidth : peak.rightWidth;
      const contribution =
        peak.height * Math.exp(-0.5 * Math.pow(distance / width, 2));
      return Math.max(highest, contribution);
    }, 0);
    const shoulder =
      ((Math.sin(
        (x / STRIP_WIDTH) * Math.PI * shoulderFrequency + shoulderPhase,
      ) +
        1) /
        2) *
      availableHeight *
      0.1;
    const y = Math.max(
      minY,
      baseline -
        7 -
        availableHeight * 0.1 -
        peakHeight -
        shoulder +
        between(random, -3, 3),
    );

    points.push({
      x,
      y,
    });
  }

  points.push({ x: STRIP_WIDTH, y: baseline });
  return points;
}

function makeRidgeTrees(
  random: () => number,
  ridge: Point[],
): TreeMark[] {
  const trees: TreeMark[] = [];

  for (let index = 0; index < ridge.length - 1; index += 1) {
    const start = ridge[index];
    const end = ridge[index + 1];
    const treeCount = Math.floor((end.x - start.x) / 28);

    for (let treeIndex = 1; treeIndex < treeCount; treeIndex += 1) {
      if (random() < 0.42) continue;
      const progress = treeIndex / treeCount;
      const x = start.x + (end.x - start.x) * progress;
      const y = start.y + (end.y - start.y) * progress;
      trees.push(makeTree(random, x, y + 1, 8, 15));
    }
  }

  return trees;
}

function closeMountain(path: string, baseline: number): string {
  return `${path} L ${STRIP_WIDTH} ${baseline} L 0 ${baseline} Z`;
}

function makeCloud(random: () => number): string {
  const x = between(random, 0, STRIP_WIDTH - 260);
  const y = between(random, 12, 45);
  const width = between(random, 130, 280);
  const height = between(random, 8, 18);
  const points: Point[] = [
    { x, y },
    { x: x + width * 0.18, y: y - height * 0.5 },
    { x: x + width * 0.38, y: y + height * 0.12 },
    { x: x + width * 0.58, y: y - height },
    { x: x + width * 0.78, y: y - height * 0.15 },
    { x: x + width, y },
  ];
  return smoothPath(points);
}

function makeTree(
  random: () => number,
  x: number,
  y: number,
  minHeight: number,
  maxHeight: number,
): TreeMark {
  return {
    x,
    y,
    height: between(random, minHeight, maxHeight),
    lean: between(random, -7, 7),
  };
}

function makeWaterLine(random: () => number, index: number): string {
  const x = between(random, -40, STRIP_WIDTH - 240);
  const y = 18 + index * 11 + between(random, -3, 3);
  const width = between(random, 110, 330);
  return `M ${x.toFixed(1)} ${y.toFixed(1)} q ${(width * 0.2).toFixed(1)} ${between(random, -3, 3).toFixed(1)} ${(width * 0.4).toFixed(1)} 0 t ${(width * 0.4).toFixed(1)} 0`;
}

// Visual inspiration: Lingdong Huang's {Shan, Shui}* landscape generator
// (MIT), https://github.com/LingDong-/shan-shui-inf. This is an independent,
// simplified generator built for the train's narrow SVG scenery.
export function createLandscapePlan(seed: string): LandscapePlan {
  const random = seededRandom(seed);
  const mountainRidge = makeRidge(random, 118, 30, 115);
  const mountainPath = closeMountain(smoothPath(mountainRidge), 118);
  const contours = Array.from({ length: 2 }, (_, contourIndex) => {
    const points = mountainRidge.map((point, pointIndex) => ({
      x: point.x + contourIndex * 4,
      y: Math.min(
        110 + contourIndex * 4,
        point.y +
          13 +
          contourIndex * 14 +
          Math.sin(pointIndex * 1.7 + contourIndex) * 2,
      ),
    }));
    return smoothPath(points);
  });

  const ridgeTrees = makeRidgeTrees(random, mountainRidge);

  const foregroundTrees = Array.from({ length: 13 }, (_, index) =>
    makeTree(
      random,
      45 + index * 170 + between(random, -55, 55),
      118,
      23,
      52,
    ),
  );

  return {
    clouds: Array.from({ length: 7 }, () => makeCloud(random)),
    mountain: mountainPath,
    contours,
    ridgeTrees,
    foregroundTrees,
    water: Array.from({ length: 8 }, (_, index) =>
      makeWaterLine(random, index),
    ),
  };
}

function SmallTree({ tree }: { tree: TreeMark }) {
  const crownY = tree.y - tree.height;
  const tipX = tree.x + tree.lean;
  return (
    <g className="landscape-tree landscape-tree--small">
      <path d={`M ${tree.x} ${tree.y} Q ${tree.x} ${crownY + 5} ${tipX} ${crownY}`} />
      <path
        className="landscape-tree__leaf"
        d={`M ${tipX} ${crownY - 4} q -5 7 0 11 q 5 -4 0 -11 Z`}
      />
    </g>
  );
}

function CurvyTree({ tree }: { tree: TreeMark }) {
  const topY = tree.y - tree.height;
  const tipX = tree.x + tree.lean;
  const middleY = tree.y - tree.height * 0.52;
  const branchY = tree.y - tree.height * 0.38;

  return (
    <g className="landscape-tree landscape-tree--curvy">
      <path
        d={`M ${tree.x} ${tree.y} C ${tree.x - 5} ${middleY + 8}, ${tipX + 7} ${middleY - 4}, ${tipX} ${topY}`}
      />
      <path
        d={`M ${tree.x + 1} ${branchY} C ${tree.x - 8} ${branchY - 5}, ${tree.x - 13} ${branchY - 12}, ${tree.x - 10} ${branchY - 18}`}
      />
      <path
        d={`M ${tree.x + 2} ${middleY} C ${tree.x + 10} ${middleY - 2}, ${tree.x + 14} ${middleY - 9}, ${tree.x + 11} ${middleY - 16}`}
      />
    </g>
  );
}

function LandscapeSvg({
  plan,
  layer,
}: {
  plan: LandscapePlan;
  layer: "clouds" | "mountain" | "foreground" | "water";
}) {
  return (
    <svg
      viewBox={`0 0 ${STRIP_WIDTH} ${STRIP_HEIGHT}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      {layer === "clouds" &&
        plan.clouds.map((cloud, index) => (
          <path key={index} className="landscape-cloud" d={cloud} />
        ))}
      {layer === "mountain" && (
        <>
          <path className="landscape-mountain landscape-mountain--near" d={plan.mountain} />
          {plan.contours.map((contour, index) => (
            <path key={index} className="landscape-contour" d={contour} />
          ))}
          {plan.ridgeTrees.map((tree, index) => (
            <SmallTree key={index} tree={tree} />
          ))}
        </>
      )}
      {layer === "foreground" &&
        plan.foregroundTrees.map((tree, index) => (
          <CurvyTree key={index} tree={tree} />
        ))}
      {layer === "water" &&
        plan.water.map((water, index) => (
          <path key={index} className="landscape-water" d={water} />
        ))}
    </svg>
  );
}

function MovingLayer({
  plan,
  layer,
  className,
}: {
  plan: LandscapePlan;
  layer: "clouds" | "mountain" | "foreground" | "water";
  className: string;
}) {
  return (
    <span className={`landscape-track ${className}`}>
      <LandscapeSvg plan={plan} layer={layer} />
      <LandscapeSvg plan={plan} layer={layer} />
    </span>
  );
}

export function ProceduralLandscape({
  seed,
  phase,
  edge,
}: {
  seed: string;
  phase: "stopped" | "riding" | "arriving";
  edge: "upper" | "lower";
}) {
  const plan = useMemo(
    () => createLandscapePlan(`${seed}-${edge}`),
    [edge, seed],
  );

  return (
    <div className={`landscape landscape--${edge} landscape--${phase}`}>
      {edge === "upper" ? (
        <>
          <MovingLayer plan={plan} layer="clouds" className="landscape-track--clouds" />
          <MovingLayer plan={plan} layer="mountain" className="landscape-track--mountain" />
          <MovingLayer
            plan={plan}
            layer="foreground"
            className="landscape-track--foreground"
          />
        </>
      ) : (
        <>
          <MovingLayer plan={plan} layer="water" className="landscape-track--water" />
          <MovingLayer
            plan={plan}
            layer="foreground"
            className="landscape-track--lower-trees"
          />
        </>
      )}
    </div>
  );
}
