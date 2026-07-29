// ABOUTME: Detects rough circular gestures inside archived cursor trails.
// ABOUTME: Arranges the detected gestures into an overlapping circle composition.

import { Trail } from "../shared/types";
import { resampleUniform } from "../shared/utils/styleUtils";
import { LibraryItem } from "./draw";
import { Point } from "./image";

const RESAMPLED_POINTS = 32;
const DEFAULT_MIN_POINTS = 9;
const DEFAULT_MAX_WINDOW_POINTS = 64;
const DEFAULT_MIN_DIAMETER = 70;
const DEFAULT_MIN_SCORE = 0.58;
const MAX_CLOSURE_RATIO = 0.25;
const MAX_ANGLE_STEP_VARIATION = 0.75;
const MAX_TURN_VARIATION = 0.8;
const MIN_CIRCULARITY = 0.55;

export interface CircularGesture extends LibraryItem {
  score: number;
}

interface CircleCandidate extends CircularGesture {
  sourceIndex: number;
  startIndex: number;
  endIndex: number;
}

interface CircleMetrics {
  score: number;
  centroid: Point;
  diameter: number;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function coefficientOfVariation(values: number[]): number {
  if (values.length === 0) return Infinity;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  if (mean === 0) return Infinity;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    values.length;
  return Math.sqrt(variance) / mean;
}

function circularDelta(from: number, to: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function tangentTurnConcentration(points: Point[]): number {
  const turns: number[] = [];
  for (let index = 1; index < points.length - 1; index++) {
    const incoming = Math.atan2(
      points[index].y - points[index - 1].y,
      points[index].x - points[index - 1].x,
    );
    const outgoing = Math.atan2(
      points[index + 1].y - points[index].y,
      points[index + 1].x - points[index].x,
    );
    turns.push(Math.abs(circularDelta(incoming, outgoing)));
  }
  if (turns.length === 0) return Infinity;
  turns.sort((a, b) => a - b);
  const meanTurn = turns.reduce((total, turn) => total + turn, 0) / turns.length;
  const ninetiethPercentile = turns[Math.floor(turns.length * 0.9)];
  return meanTurn === 0 ? Infinity : ninetiethPercentile / meanTurn;
}

function tangentTurnVariation(points: Point[]): number {
  const turns: number[] = [];
  for (let index = 2; index < points.length - 2; index++) {
    const incoming = Math.atan2(
      points[index].y - points[index - 2].y,
      points[index].x - points[index - 2].x,
    );
    const outgoing = Math.atan2(
      points[index + 2].y - points[index].y,
      points[index + 2].x - points[index].x,
    );
    turns.push(Math.abs(circularDelta(incoming, outgoing)));
  }
  if (turns.length === 0) return Infinity;

  return coefficientOfVariation(turns);
}

function polygonCircularity(points: Point[]): number {
  let twiceArea = 0;
  let perimeter = 0;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    twiceArea += point.x * next.y - next.x * point.y;
    perimeter += distance(point, next);
  }
  if (perimeter === 0) return 0;
  return (2 * Math.PI * Math.abs(twiceArea)) / perimeter ** 2;
}

function analyzeCircle(points: Point[], minDiameter: number): CircleMetrics | null {
  if (points.length < DEFAULT_MIN_POINTS) return null;

  const sampled = resampleUniform(points, RESAMPLED_POINTS);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let centroidX = 0;
  let centroidY = 0;

  for (const point of sampled) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
    centroidX += point.x;
    centroidY += point.y;
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const diameter = Math.max(width, height);
  if (diameter < minDiameter || Math.min(width, height) < diameter * 0.5) {
    return null;
  }

  const centroid = {
    x: centroidX / sampled.length,
    y: centroidY / sampled.length,
  };
  const radii = sampled.map((point) => distance(point, centroid));
  const meanRadius =
    radii.reduce((total, radius) => total + radius, 0) / radii.length;
  const radiusVariance =
    radii.reduce(
      (total, radius) => total + (radius - meanRadius) ** 2,
      0,
    ) / radii.length;
  const radialVariation = Math.sqrt(radiusVariance) / meanRadius;
  if (radialVariation > 0.42) return null;

  const angles = sampled.map((point) =>
    Math.atan2(point.y - centroid.y, point.x - centroid.x),
  );
  let netTurn = 0;
  let totalTurn = 0;
  const angleSteps: number[] = [];
  const visitedAngleBins = new Set<number>();
  for (let index = 1; index < angles.length; index++) {
    const delta = circularDelta(angles[index - 1], angles[index]);
    netTurn += delta;
    totalTurn += Math.abs(delta);
    angleSteps.push(Math.abs(delta));
  }
  for (const angle of angles) {
    const normalized = (angle + Math.PI) / (Math.PI * 2);
    visitedAngleBins.add(Math.min(11, Math.floor(normalized * 12)));
  }

  const turnCoverage = Math.abs(netTurn) / (Math.PI * 2);
  const directionConsistency =
    totalTurn === 0 ? 0 : Math.abs(netTurn) / totalTurn;
  const angleStepVariation = coefficientOfVariation(angleSteps);
  const angleCoverage = visitedAngleBins.size / 12;
  const turnConcentration = tangentTurnConcentration(sampled);
  const turnVariation = tangentTurnVariation(sampled);
  const circularity = polygonCircularity(sampled);
  if (
    turnCoverage < 0.68 ||
    turnCoverage > 1.45 ||
    directionConsistency < 0.62 ||
    angleStepVariation > MAX_ANGLE_STEP_VARIATION ||
    angleCoverage < 0.67 ||
    turnConcentration > 4.5 ||
    turnVariation > MAX_TURN_VARIATION ||
    circularity < MIN_CIRCULARITY
  ) {
    return null;
  }

  const closure = distance(sampled[0], sampled[sampled.length - 1]) / diameter;
  if (closure > MAX_CLOSURE_RATIO) return null;

  const aspectRatio = Math.min(width, height) / diameter;
  const closureScore = 1 - clamp01(closure / MAX_CLOSURE_RATIO);
  const radialScore = 1 - clamp01(radialVariation / 0.42);
  const turnScore = 1 - clamp01(Math.abs(1 - turnCoverage) / 0.45);
  const score =
    closureScore * 0.3 +
    radialScore * 0.25 +
    turnScore * 0.2 +
    directionConsistency * 0.15 +
    aspectRatio * 0.05 +
    angleCoverage * 0.05;

  return { score, centroid, diameter };
}

function removeNearbyPoints(points: Point[]): Point[] {
  if (points.length === 0) return [];
  const filtered = [points[0]];
  for (let index = 1; index < points.length; index++) {
    if (distance(filtered[filtered.length - 1], points[index]) >= 4) {
      filtered.push(points[index]);
    }
  }
  return filtered;
}

function rangesOverlap(a: CircleCandidate, b: CircleCandidate): boolean {
  if (a.sourceIndex !== b.sourceIndex) return false;
  const overlap =
    Math.min(a.endIndex, b.endIndex) - Math.max(a.startIndex, b.startIndex);
  if (overlap <= 0) return false;
  const shorterLength = Math.min(
    a.endIndex - a.startIndex,
    b.endIndex - b.startIndex,
  );
  return overlap / shorterLength > 0.45;
}

export function detectCircularGestures(
  trails: LibraryItem[],
  {
    maxGestures = 120,
    minDiameter = DEFAULT_MIN_DIAMETER,
    minScore = DEFAULT_MIN_SCORE,
  }: {
    maxGestures?: number;
    minDiameter?: number;
    minScore?: number;
  } = {},
): CircularGesture[] {
  const candidates: CircleCandidate[] = [];

  trails.forEach((trail, sourceIndex) => {
    const points = removeNearbyPoints(trail.points);
    for (
      let startIndex = 0;
      startIndex <= points.length - DEFAULT_MIN_POINTS;
      startIndex += 3
    ) {
      const maxEndIndex = Math.min(
        points.length - 1,
        startIndex + DEFAULT_MAX_WINDOW_POINTS,
      );
      let minX = points[startIndex].x;
      let maxX = minX;
      let minY = points[startIndex].y;
      let maxY = minY;
      let pathLength = 0;

      for (
        let endIndex = startIndex + 1;
        endIndex <= maxEndIndex;
        endIndex++
      ) {
        const point = points[endIndex];
        pathLength += distance(points[endIndex - 1], point);
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
        if (endIndex - startIndex + 1 < DEFAULT_MIN_POINTS) continue;
        if (
          (endIndex - startIndex - (DEFAULT_MIN_POINTS - 1)) % 2 !== 0 &&
          endIndex !== maxEndIndex
        ) {
          continue;
        }

        const diameter = Math.max(maxX - minX, maxY - minY);
        if (
          diameter < minDiameter ||
          distance(points[startIndex], point) > diameter * MAX_CLOSURE_RATIO
        ) {
          continue;
        }

        const pathToDiameterRatio = pathLength / diameter;
        if (pathToDiameterRatio < 2.2 || pathToDiameterRatio > 5.5) {
          continue;
        }

        const candidatePoints = points.slice(startIndex, endIndex + 1);
        const metrics = analyzeCircle(candidatePoints, minDiameter);
        if (!metrics || metrics.score < minScore) continue;
        candidates.push({
          points: candidatePoints,
          color: trail.color,
          id: `${trail.id}-circle-${startIndex}-${endIndex}`,
          score: metrics.score,
          sourceIndex,
          startIndex,
          endIndex,
        });
      }
    }
  });

  candidates.sort((a, b) => b.score - a.score);
  const selected: CircleCandidate[] = [];
  for (const candidate of candidates) {
    if (selected.some((existing) => rangesOverlap(candidate, existing))) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= maxGestures) break;
  }

  return selected.map(({ points, color, id, score }) => ({
    points,
    color,
    id,
    score,
  }));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashFraction(value: string): number {
  return hashString(value) / 0xffffffff;
}

export function arrangeCircularGestures(
  gestures: CircularGesture[],
  viewport: { width: number; height: number },
  {
    maxCircles,
    spatialOverlap,
  }: {
    maxCircles: number;
    spatialOverlap: number;
  },
): Trail[] {
  const selected = gestures.slice(0, maxCircles);
  const minViewportDimension = Math.min(viewport.width, viewport.height);
  const spread = 1 - clamp01(spatialOverlap);

  return selected.flatMap((gesture, index) => {
    const metrics = analyzeCircle(gesture.points, 0);
    if (!metrics) return [];

    const angle = index * Math.PI * (3 - Math.sqrt(5));
    const ringFraction =
      selected.length <= 1 ? 0 : Math.sqrt(index / (selected.length - 1));
    const horizontalRadius = viewport.width * 0.42 * spread * ringFraction;
    const verticalRadius = viewport.height * 0.35 * spread * ringFraction;
    const center = {
      x: viewport.width / 2 + Math.cos(angle) * horizontalRadius,
      y: viewport.height / 2 + Math.sin(angle) * verticalRadius,
    };
    const sizeVariation = 0.44 + hashFraction(gesture.id) * 0.48;
    const targetDiameter = minViewportDimension * sizeVariation;
    const scale = targetDiameter / metrics.diameter;
    const points = gesture.points.map((point, pointIndex) => ({
      x: center.x + (point.x - metrics.centroid.x) * scale,
      y: center.y + (point.y - metrics.centroid.y) * scale,
      ts: pointIndex,
    }));

    return [
      {
        points,
        color: gesture.color,
        opacity: 1,
        id: `arranged-${gesture.id}`,
        startTime: 0,
        endTime: Math.max(1, points.length - 1),
        clicks: [],
      },
    ];
  });
}
