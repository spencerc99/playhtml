// ABOUTME: Radial (expand from center) navigation visualization
// ABOUTME: Domain nodes as bumpy blobs, one session at a time, edges animate

import React, { useState, useEffect, useRef, memo } from "react";
import { RadialState, RadialNode } from "../types";

export interface RadialBlobSettings {
  samples?: number;
  curveTension?: number;
  edgeNoise?: number;
  valleyDepth?: number;
}

interface AnimatedNavigationRadialProps {
  radialState: RadialState;
  canvasSize: { width: number; height: number };
  settings: {
    nodeOpacity: number;
    edgeOpacity: number;
    maxParallelEdges?: number;
    blob?: RadialBlobSettings;
  };
}

const STEP_DURATION = 800; // ms per step (edge draw + node appear/grow)
const PAUSE_BETWEEN_SESSIONS = 1500;
const GROWTH_DURATION = 200;
const DEFAULT_MAX_CONCURRENT_EDGES = 3;
const BASE_RADIUS = 12;
const NODE_RADIUS_LERP = 0.055; // smooth transition toward target radius (per frame); lower = slower growth
const Bump_AMPLITUDE_RATIO = 0.35; // base bump size as fraction of radius

// Seeded RNG for reproducible per-node variation (same node = same shape, different nodes = different)
function seeded(seed: number) {
  return (i: number) => {
    const x = Math.sin(seed + i * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function generateWobblyPath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  seed: number,
): Array<{ x: number; y: number }> {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const numPoints = Math.max(3, Math.min(10, Math.ceil(distance / 50)));
  const points: Array<{ x: number; y: number }> = [source];
  const rand = (offset: number) => {
    const x = Math.sin(seed + offset * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 1; i < numPoints; i++) {
    const t = i / numPoints;
    const baseX = source.x + dx * t;
    const baseY = source.y + dy * t;
    const perpX = -dy / distance;
    const perpY = dx / distance;
    const wobble = 18 * (1 - Math.abs(t - 0.5) * 2);
    const w = (rand(i) - 0.5) * wobble;
    points.push({ x: baseX + perpX * w, y: baseY + perpY * w });
  }
  points.push(target);
  return points;
}

function pathFromPoints(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`;
  }
  return d;
}

const DEFAULT_BLOB_SAMPLES = 64;
const FOOTPRINT_RADIUS_SCALE = 11.4; // max multiplier for footprint at large radii
const FOOTPRINT_RAMP_SCALE = 1.6; // smaller = steeper growth (exponential approach)
// Subtract this from raw ramp so small nodes stay at 1x longer; 0 = no delay
const FOOTPRINT_RAMP_OFFSET = 0.5;
const FOOTPRINT_RADIUS_LERP = 0.032; // footprint size lags behind node (slower than NODE_RADIUS_LERP)
const FOOTPRINT_FILL = "rgba(127, 138, 121, 0.03)"; // only control for footprint visibility (no filter)
const DEFAULT_BLOB_CURVE_TENSION = 0.5;
const DEFAULT_BLOB_EDGE_NOISE = 0.45;
const DEFAULT_BLOB_VALLEY_DEPTH = 0.05;

// Blob: 0-1 distinct URLs = circle; 2+ = irregular organic blob (stochastic per seed so same count ≠ same shape)
function blobPath(
  cx: number,
  cy: number,
  radius: number,
  numBumps: number,
  seed: number,
  options?: RadialBlobSettings,
): string {
  if (numBumps <= 1) {
    const r = radius;
    return `M ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${
      cx - r
    } ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy} Z`;
  }

  const rnd = seeded(seed);
  const n = Math.max(2, numBumps);
  const samples = Math.max(
    8,
    Math.min(160, options?.samples ?? DEFAULT_BLOB_SAMPLES),
  );
  const curveTension = Math.max(
    0.15,
    Math.min(0.5, options?.curveTension ?? DEFAULT_BLOB_CURVE_TENSION),
  );
  const edgeNoiseAmount = Math.max(
    0,
    Math.min(0.5, options?.edgeNoise ?? DEFAULT_BLOB_EDGE_NOISE),
  );
  const valleyDepthRatio = Math.max(
    0.02,
    Math.min(0.35, options?.valleyDepth ?? DEFAULT_BLOB_VALLEY_DEPTH),
  );

  const highBumpThreshold = 6;
  const isHighBump = n > highBumpThreshold;
  const angleStepRange = isHighBump ? 1.4 : 0.8;
  const angleStepBase = isHighBump ? 0.3 : 0.6;

  // Irregular bump placement: more randomness when many bumps to avoid gear-like regularity
  const bumpAngles: number[] = [];
  let angle = 0;
  for (let i = 0; i < n; i++) {
    bumpAngles.push(angle);
    const step =
      ((2 * Math.PI) / n) * (angleStepBase + rnd(i * 7) * angleStepRange);
    angle += step;
  }
  const scale = (2 * Math.PI) / angle;
  for (let i = 0; i < n; i++) bumpAngles[i] *= scale;

  const bumpAmps: number[] = [];
  const bumpWidths: number[] = [];
  const ampRange = isHighBump ? 1.2 : 0.9;
  const ampBase = isHighBump ? 0.4 : 0.6;
  for (let i = 0; i < n; i++) {
    bumpAmps.push(
      radius * Bump_AMPLITUDE_RATIO * (ampBase + rnd(i * 11) * ampRange),
    );
    bumpWidths.push(0.35 + rnd(i * 13) * (isHighBump ? 0.7 : 0.5));
  }

  const valleyDepth = radius * valleyDepthRatio;
  const halfGap = ((2 * Math.PI) / n) * 0.5;

  const radii: number[] = [];
  for (let i = 0; i < samples; i++) {
    const theta = (2 * Math.PI * i) / samples;
    let bump = 0;
    let minDist = Math.PI;
    for (let b = 0; b < n; b++) {
      let d = theta - bumpAngles[b];
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      const absD = Math.abs(d);
      if (absD < minDist) minDist = absD;
      const w = bumpWidths[b];
      const cosd = Math.cos(d);
      const lobe = Math.pow(Math.max(0, cosd), w);
      bump = Math.max(bump, (lobe * bumpAmps[b]) / radius);
    }
    const baseR = radius + radius * bump;
    const t = Math.min(1, minDist / halfGap);
    const smooth = t * t * (3 - 2 * t);
    const dip = valleyDepth * smooth;
    let noise =
      edgeNoiseAmount > 0
        ? radius * (rnd(i * 31 + (seed % 100)) - 0.5) * edgeNoiseAmount
        : 0;
    if (isHighBump) {
      const extraWobble = radius * 0.12 * (rnd(i * 19 + seed) - 0.5);
      noise += extraWobble;
    }
    const r = Math.max(radius * 0.4, baseR - dip + noise);
    radii.push(r);
  }

  // Smoothing pass: running average to reduce jaggedness (each radius blends with neighbors)
  const smoothed = [...radii];
  for (let i = 0; i < samples; i++) {
    const prev = radii[(i - 1 + samples) % samples];
    const next = radii[(i + 1) % samples];
    smoothed[i] = (prev + radii[i] + next) / 3;
  }

  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < samples; i++) {
    const theta = (2 * Math.PI * i) / samples;
    const r = smoothed[i];
    points.push({
      x: cx + Math.cos(theta) * r,
      y: cy + Math.sin(theta) * r,
    });
  }

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < samples; i++) {
    const p0 = points[(i - 1 + samples) % samples];
    const p1 = points[i];
    const p2 = points[(i + 1) % samples];
    const cpX = p1.x + (p2.x - p0.x) * curveTension;
    const cpY = p1.y + (p2.y - p0.y) * curveTension;
    d += ` Q ${cpX} ${cpY} ${p2.x} ${p2.y}`;
  }
  d += " Z";
  return d;
}

// Node radius from visitCount
function radiusFromVisitCount(visitCount: number): number {
  return BASE_RADIUS + Math.min(20, Math.sqrt(visitCount) * 4);
}

// displayVisitCount/displayDistinctUrlCount: live values during animation (grow with edges);
// animatedRadius: when provided, use for smooth size transition instead of jumping.
// blobSettings: optional tuning for outline smoothness (samples, curveTension, edgeNoise, valleyDepth).
const RadialNodeBlob = memo(
  ({
    node,
    opacity,
    scale,
    visible,
    displayVisitCount,
    displayDistinctUrlCount,
    animatedRadius,
    blobSettings,
  }: {
    node: RadialNode;
    opacity: number;
    scale: number;
    visible: boolean;
    displayVisitCount?: number;
    displayDistinctUrlCount?: number;
    animatedRadius?: number;
    blobSettings?: RadialBlobSettings;
  }) => {
    if (!visible || opacity <= 0) return null;
    const visitCount = displayVisitCount ?? node.visitCount;
    const distinctUrlCount = displayDistinctUrlCount ?? node.distinctUrlCount;
    const radius =
      animatedRadius !== undefined
        ? animatedRadius
        : radiusFromVisitCount(visitCount) * scale;
    const seed = hashString(node.id);
    const numBumps = Math.max(0, distinctUrlCount);
    const d = blobPath(node.x, node.y, radius, numBumps, seed, blobSettings);
    const strokeColor = "rgba(55, 60, 50, 0.55)";
    const clipId = `node-blob-clip-${node.id}`;
    return (
      <g opacity={opacity}>
        <defs>
          <clipPath id={clipId}>
            <path d={d} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <path
            d={d}
            fill={node.color}
            filter={`url(#radialBlobGrain-${hashString(node.id) % 5})`}
          />
        </g>
        <path d={d} fill="none" stroke={strokeColor} strokeWidth={1.8} />
        <g aria-hidden>
          {(() => {
            const pillW = Math.max(52, node.id.length * 5.2);
            const pillX = node.x - pillW / 2;
            const pillY = node.y + radius + 5;
            return (
              <>
                <rect
                  x={pillX}
                  y={pillY}
                  width={pillW}
                  height={14}
                  rx={7}
                  ry={7}
                  fill="rgba(255, 255, 255, 0.72)"
                  stroke="rgba(255, 255, 255, 0.5)"
                  strokeWidth={0.5}
                />
                <text
                  x={node.x}
                  y={pillY + 10}
                  textAnchor="middle"
                  fontSize={9}
                  fontFamily='"Martian Mono", monospace'
                  fill="rgba(45, 48, 42, 0.92)"
                  paintOrder="stroke"
                  stroke="rgba(255, 255, 255, 0.6)"
                  strokeWidth={1.5}
                >
                  {node.id}
                </text>
              </>
            );
          })()}
        </g>
      </g>
    );
  },
);

const EDGE_OFFSET_PX = 5;
const EDGE_GROUP_THRESHOLD = 4;

const AnimatedEdge = memo(
  ({
    sourceNode,
    targetNode,
    progress,
    opacity,
    color,
    seed,
    offsetIndex = 0,
    totalInGroup = 1,
    groupedAsOne = false,
  }: {
    sourceNode: RadialNode;
    targetNode: RadialNode;
    progress: number;
    opacity: number;
    color: string;
    seed: number;
    offsetIndex?: number;
    totalInGroup?: number;
    groupedAsOne?: boolean;
  }) => {
    if (progress <= 0) return null;
    const sx = sourceNode.x;
    const sy = sourceNode.y;
    const tx = targetNode.x;
    const ty = targetNode.y;
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const perpX = -dy / len;
    const perpY = dx / len;

    const useOffset =
      !groupedAsOne && totalInGroup > 1 && totalInGroup < EDGE_GROUP_THRESHOLD;
    const offset = useOffset
      ? (offsetIndex - (totalInGroup - 1) / 2) * EDGE_OFFSET_PX
      : 0;

    const strokeWidth =
      groupedAsOne && totalInGroup > 1
        ? 2.5 + Math.min(10, (totalInGroup - 1) * 2)
        : 2.5;

    const points = generateWobblyPath(
      { x: sx + perpX * offset, y: sy + perpY * offset },
      { x: tx + perpX * offset, y: ty + perpY * offset },
      seed,
    );
    const pathD = pathFromPoints(points);
    const totalLen = points.reduce((acc, p, i) => {
      if (i === 0) return 0;
      const prev = points[i - 1];
      return acc + Math.hypot(p.x - prev.x, p.y - prev.y);
    }, 0);
    const visibleLen = totalLen * progress;
    return (
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
        strokeDasharray={`${visibleLen} ${totalLen + 10}`}
        style={{ mixBlendMode: "multiply" }}
      />
    );
  },
);

type ActiveEdge = {
  fromId: string;
  toId: string;
  startTime: number;
  color: string;
};

export const AnimatedNavigationRadial: React.FC<AnimatedNavigationRadialProps> =
  memo(({ radialState, canvasSize, settings }) => {
    const [currentSessionIndex, setCurrentSessionIndex] = useState(0);
    const [activeEdges, setActiveEdges] = useState<ActiveEdge[]>([]);
    const [currentTime, setCurrentTime] = useState(0);
    const [visibleNodeIds, setVisibleNodeIds] = useState<Set<string>>(
      new Set(),
    );
    const [nodeScales, setNodeScales] = useState<Map<string, number>>(
      new Map(),
    );
    const [displayVisitCounts, setDisplayVisitCounts] = useState<
      Map<string, number>
    >(new Map());
    const [completedEdges, setCompletedEdges] = useState<
      Array<{ from: string; to: string; color: string }>
    >([]);
    const [phase, setPhase] = useState<"playing" | "pause">("playing");
    const [nodeAnimatedRadii, setNodeAnimatedRadii] = useState<
      Map<string, number>
    >(new Map());
    const [footprintAnimatedRadii, setFootprintAnimatedRadii] = useState<
      Map<string, number>
    >(new Map());
    const animationRef = useRef<number>();
    const sessionOrderRef = useRef<number[]>([]);
    const activeEdgesRef = useRef<ActiveEdge[]>([]);
    const nextStepIndexRef = useRef<number>(1);
    const lastEdgeStartTimeRef = useRef<number>(0);
    const sessionStartTimeRef = useRef<number>(0);
    const hasShownFirstNodeRef = useRef<boolean>(false);
    const nodeAnimatedRadiusRef = useRef<Map<string, number>>(new Map());
    const footprintAnimatedRadiusRef = useRef<Map<string, number>>(new Map());
    const displayVisitCountsRef = useRef<Map<string, number>>(new Map());
    const visibleNodeIdsRef = useRef<Set<string>>(new Set());
    const nodeScalesRef = useRef<Map<string, number>>(new Map());

    // Keep refs in sync with state so the animation loop sees latest values
    useEffect(() => {
      displayVisitCountsRef.current = displayVisitCounts;
      visibleNodeIdsRef.current = visibleNodeIds;
      nodeScalesRef.current = nodeScales;
    }, [displayVisitCounts, visibleNodeIds, nodeScales]);

    // Initialize random session order when radialState changes
    useEffect(() => {
      if (!radialState || radialState.sessions.length === 0) return;
      const order = radialState.sessions.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      sessionOrderRef.current = order;
      setCurrentSessionIndex(0);
      setActiveEdges([]);
      setVisibleNodeIds(new Set());
      setNodeScales(new Map());
      setDisplayVisitCounts(new Map());
      setCompletedEdges([]);
      setNodeAnimatedRadii(new Map());
      setFootprintAnimatedRadii(new Map());
      setPhase("playing");
      activeEdgesRef.current = [];
      nextStepIndexRef.current = 1;
      hasShownFirstNodeRef.current = false;
      nodeAnimatedRadiusRef.current = new Map();
      footprintAnimatedRadiusRef.current = new Map();
    }, [radialState]);

    useEffect(() => {
      if (!radialState || radialState.sessions.length === 0) return;

      const animate = (timestamp: number) => {
        const sessionIdx = sessionOrderRef.current[currentSessionIndex] ?? 0;
        const session = radialState.sessions[sessionIdx];
        if (!session || session.steps.length === 0) {
          animationRef.current = requestAnimationFrame(animate);
          return;
        }

        if (phase === "pause") {
          if (
            timestamp - sessionStartTimeRef.current >
            PAUSE_BETWEEN_SESSIONS
          ) {
            setPhase("playing");
            setCurrentSessionIndex(
              (prev) => (prev + 1) % radialState.sessions.length,
            );
            setActiveEdges([]);
            setVisibleNodeIds(new Set());
            setNodeScales(new Map());
            setDisplayVisitCounts(new Map());
            setCompletedEdges([]);
            setNodeAnimatedRadii(new Map());
            setFootprintAnimatedRadii(new Map());
            activeEdgesRef.current = [];
            nextStepIndexRef.current = 1;
            hasShownFirstNodeRef.current = false;
            nodeAnimatedRadiusRef.current = new Map();
            footprintAnimatedRadiusRef.current = new Map();
            sessionStartTimeRef.current = timestamp;
          }
          animationRef.current = requestAnimationFrame(animate);
          return;
        }

        if (sessionStartTimeRef.current === 0)
          sessionStartTimeRef.current = timestamp;

        const steps = session.steps;
        const now = timestamp;
        const maxParallel = Math.max(
          1,
          Math.min(
            10,
            settings.maxParallelEdges ?? DEFAULT_MAX_CONCURRENT_EDGES,
          ),
        );
        const edgeStartInterval = STEP_DURATION / (maxParallel + 0.5);
        setCurrentTime(now);

        // Show first node at session start (once)
        if (!hasShownFirstNodeRef.current && steps.length > 0) {
          hasShownFirstNodeRef.current = true;
          const firstId = steps[0].domainId;
          setVisibleNodeIds((prev) => new Set(prev).add(firstId));
          setDisplayVisitCounts((prev) => {
            const next = new Map(prev);
            next.set(firstId, 1);
            return next;
          });
          setNodeScales((prev) => {
            const next = new Map(prev);
            if (!next.has(firstId)) next.set(firstId, 1);
            return next;
          });
        }

        // Complete edges that have finished
        const stillActive: ActiveEdge[] = [];
        for (const edge of activeEdgesRef.current) {
          const progress = (now - edge.startTime) / STEP_DURATION;
          if (progress >= 1) {
            setCompletedEdges((prev) => [
              ...prev,
              { from: edge.fromId, to: edge.toId, color: edge.color },
            ]);
            setVisibleNodeIds((prev) => new Set(prev).add(edge.toId));
            setDisplayVisitCounts((prev) => {
              const next = new Map(prev);
              next.set(edge.toId, (next.get(edge.toId) ?? 0) + 1);
              return next;
            });
            setNodeScales((prev) => {
              const next = new Map(prev);
              const current = next.get(edge.toId) ?? 1;
              next.set(edge.toId, Math.min(1.2, current + 0.05));
              return next;
            });
          } else {
            stillActive.push(edge);
          }
        }
        activeEdgesRef.current = stillActive;

        // Start new edges: stagger so up to maxParallel are in flight
        while (
          nextStepIndexRef.current >= 1 &&
          nextStepIndexRef.current < steps.length &&
          activeEdgesRef.current.length < maxParallel &&
          (activeEdgesRef.current.length === 0 ||
            now - lastEdgeStartTimeRef.current >= edgeStartInterval)
        ) {
          const fromId = steps[nextStepIndexRef.current - 1].domainId;
          const toId = steps[nextStepIndexRef.current].domainId;
          lastEdgeStartTimeRef.current = now;
          activeEdgesRef.current.push({
            fromId,
            toId,
            startTime: now,
            color: session.color,
          });
          setVisibleNodeIds((prev) => new Set(prev).add(fromId));
          // Ensure source node has displayVisitCount when it first appears (avoids flash from full node.visitCount)
          setDisplayVisitCounts((prev) => {
            const next = new Map(prev);
            if ((next.get(fromId) ?? 0) < 1) next.set(fromId, 1);
            return next;
          });
          nextStepIndexRef.current += 1;
        }

        setActiveEdges([...activeEdgesRef.current]);

        // Smooth node size: lerp animated radius toward target (avoids jump when visit count updates)
        const radii = nodeAnimatedRadiusRef.current;
        const footprintRadii = footprintAnimatedRadiusRef.current;
        for (const nodeId of visibleNodeIdsRef.current) {
          const node = radialState.nodes.get(nodeId);
          if (!node) continue;
          const visitCount = displayVisitCountsRef.current.get(nodeId) ?? 1;
          const scale = nodeScalesRef.current.get(nodeId) ?? 1;
          const targetRadius = radiusFromVisitCount(visitCount) * scale;
          const current = radii.get(nodeId);
          if (current === undefined) {
            radii.set(nodeId, targetRadius);
          } else {
            const next = current + (targetRadius - current) * NODE_RADIUS_LERP;
            radii.set(
              nodeId,
              Math.abs(next - targetRadius) < 0.5 ? targetRadius : next,
            );
          }
          // Footprint lags behind node (slower lerp) so it grows after the node
          const nodeRadius = radii.get(nodeId) ?? targetRadius;
          const rampRaw =
            1 - Math.exp(-nodeRadius / (BASE_RADIUS * FOOTPRINT_RAMP_SCALE));
          const ramp = Math.max(
            0,
            (rampRaw - FOOTPRINT_RAMP_OFFSET) / (1 - FOOTPRINT_RAMP_OFFSET),
          );
          const targetFootprintRadius =
            nodeRadius * (1 + (FOOTPRINT_RADIUS_SCALE - 1) * ramp);
          const currentFootprint = footprintRadii.get(nodeId);
          if (currentFootprint === undefined) {
            footprintRadii.set(nodeId, targetFootprintRadius);
          } else {
            const nextFootprint =
              currentFootprint +
              (targetFootprintRadius - currentFootprint) *
                FOOTPRINT_RADIUS_LERP;
            footprintRadii.set(
              nodeId,
              Math.abs(nextFootprint - targetFootprintRadius) < 0.5
                ? targetFootprintRadius
                : nextFootprint,
            );
          }
        }
        setNodeAnimatedRadii(new Map(radii));
        setFootprintAnimatedRadii(new Map(footprintRadii));

        // Session done when no more steps to start and all in-flight edges complete
        if (
          nextStepIndexRef.current >= steps.length &&
          activeEdgesRef.current.length === 0
        ) {
          setPhase("pause");
          sessionStartTimeRef.current = timestamp;
        }

        animationRef.current = requestAnimationFrame(animate);
      };

      animationRef.current = requestAnimationFrame(animate);
      return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
      };
    }, [radialState, currentSessionIndex, phase, settings.maxParallelEdges]);

    if (!radialState || radialState.nodes.size === 0) return null;

    const sessionIdx = sessionOrderRef.current[currentSessionIndex] ?? 0;
    const session = radialState.sessions[sessionIdx];

    return (
      <svg
        className="navigation-radial-svg"
        width="100%"
        height="100%"
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      >
        <defs>
          {/* Rainbow/iridescent texture: intensity varies per-node (0–4) for visual variation */}
          {[0.28, 0.48, 0.68, 0.85, 1].map((intensity, i) => (
            <filter
              key={i}
              id={`radialBlobGrain-${i}`}
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.06"
                numOctaves="3"
                seed="1"
                result="noise"
              />
              <feComponentTransfer in="noise" result="noiseScaled">
                <feFuncR
                  type="linear"
                  slope={intensity}
                  intercept={0.5 - intensity * 0.5}
                />
                <feFuncG
                  type="linear"
                  slope={intensity}
                  intercept={0.5 - intensity * 0.5}
                />
                <feFuncB
                  type="linear"
                  slope={intensity}
                  intercept={0.5 - intensity * 0.5}
                />
              </feComponentTransfer>
              <feBlend in="SourceGraphic" in2="noiseScaled" mode="multiply" />
            </filter>
          ))}
        </defs>
        {/* Bottom layer: moss footprint background (drawn first so it sits behind edges and nodes) */}
        {Array.from(radialState.nodes.values()).map((node) => {
          if (!visibleNodeIds.has(node.id)) return null;
          const liveVisitCount = displayVisitCounts.get(node.id) ?? 0;
          const radius =
            nodeAnimatedRadii.get(node.id) ??
            radiusFromVisitCount(liveVisitCount || 1) *
              (nodeScales.get(node.id) ?? 1);
          const numBumps = Math.min(
            node.distinctUrlCount,
            Math.max(1, liveVisitCount),
          );
          // Use animated footprint radius so footprint grows slower than node
          const footprintRadius =
            footprintAnimatedRadii.get(node.id) ??
            radius * (1 + (FOOTPRINT_RADIUS_SCALE - 1) * 0);
          const seed = hashString(node.id);
          const footprintBumps = Math.max(2, numBumps);
          const dFootprint = blobPath(
            node.x,
            node.y,
            footprintRadius,
            footprintBumps,
            seed,
            settings.blob,
          );
          const clipId = `footprint-clip-${node.id}`;
          return (
            <g key={`footprint-${node.id}`}>
              <defs>
                <clipPath id={clipId}>
                  <path d={dFootprint} />
                </clipPath>
              </defs>
              <g clipPath={`url(#${clipId})`}>
                <path d={dFootprint} fill={FOOTPRINT_FILL} />
              </g>
            </g>
          );
        })}

        {/* Completed edges - group by from-to; many same-pair => one thick edge */}
        {(() => {
          const keyToIndices = new Map<string, number[]>();
          completedEdges.forEach((e, i) => {
            const key = `${e.from}|${e.to}`;
            if (!keyToIndices.has(key)) keyToIndices.set(key, []);
            keyToIndices.get(key)!.push(i);
          });
          const rendered: React.ReactNode[] = [];
          const seenKeys = new Set<string>();
          completedEdges.forEach((e, i) => {
            const src = radialState.nodes.get(e.from);
            const tgt = radialState.nodes.get(e.to);
            if (!src || !tgt) return;
            const key = `${e.from}|${e.to}`;
            const indices = keyToIndices.get(key)!;
            const count = indices.length;

            if (count >= EDGE_GROUP_THRESHOLD) {
              if (seenKeys.has(key)) return;
              seenKeys.add(key);
              rendered.push(
                <AnimatedEdge
                  key={`done-${key}`}
                  sourceNode={src}
                  targetNode={tgt}
                  progress={1}
                  opacity={settings.edgeOpacity}
                  color={e.color}
                  seed={hashString(key)}
                  totalInGroup={count}
                  groupedAsOne
                />,
              );
            } else {
              const offsetIndex = indices.indexOf(i);
              rendered.push(
                <AnimatedEdge
                  key={`done-${i}`}
                  sourceNode={src}
                  targetNode={tgt}
                  progress={1}
                  opacity={settings.edgeOpacity}
                  color={e.color}
                  seed={hashString(e.from + e.to + i)}
                  offsetIndex={offsetIndex}
                  totalInGroup={count}
                />,
              );
            }
          });
          return rendered;
        })()}

        {/* In-flight edges (multiple at once for parallel unfolding) */}
        {activeEdges.map((edge, i) => {
          const sourceNode = radialState.nodes.get(edge.fromId);
          const targetNode = radialState.nodes.get(edge.toId);
          if (!sourceNode || !targetNode) return null;
          const progress = Math.min(
            1,
            (currentTime - edge.startTime) / STEP_DURATION,
          );
          return (
            <AnimatedEdge
              key={`active-${edge.fromId}-${edge.toId}-${i}`}
              sourceNode={sourceNode}
              targetNode={targetNode}
              progress={progress}
              opacity={settings.edgeOpacity}
              color={edge.color}
              seed={hashString(edge.fromId + edge.toId + i)}
            />
          );
        })}

        {/* Visible nodes: size and blob bumps live-update; radius animates smoothly via nodeAnimatedRadii */}
        {Array.from(radialState.nodes.values()).map((node) => {
          const liveVisitCount = displayVisitCounts.get(node.id) ?? 0;
          const liveDistinctUrlCount = Math.min(
            node.distinctUrlCount,
            Math.max(1, liveVisitCount),
          );
          const visible = visibleNodeIds.has(node.id);
          return (
            <RadialNodeBlob
              key={node.id}
              node={node}
              opacity={visible ? settings.nodeOpacity : 0}
              scale={nodeScales.get(node.id) ?? 1}
              visible={visible}
              displayVisitCount={liveVisitCount || undefined}
              displayDistinctUrlCount={liveDistinctUrlCount || undefined}
              animatedRadius={
                visible ? nodeAnimatedRadii.get(node.id) : undefined
              }
              blobSettings={settings.blob}
            />
          );
        })}

        {/* Session date & time (top right), progresses with animation */}
        {session &&
          session.steps.length > 0 &&
          (() => {
            const steps = session.steps;
            const k = Math.min(completedEdges.length, steps.length - 1);
            let displayTs = steps[k].timestamp;
            if (
              activeEdges.length > 0 &&
              completedEdges.length < steps.length - 1
            ) {
              const progress = Math.min(
                1,
                (currentTime - activeEdges[0].startTime) / STEP_DURATION,
              );
              const t0 = steps[completedEdges.length]?.timestamp ?? displayTs;
              const t1 = steps[completedEdges.length + 1]?.timestamp ?? t0;
              displayTs = t0 + (t1 - t0) * progress;
            }
            const d = new Date(displayTs);
            const dateStr = d.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const timeStr = d.toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
              second: "2-digit",
            });
            return (
              <text
                x={canvasSize.width - 16}
                y={22}
                textAnchor="end"
                fontSize={11}
                fontFamily='"Martian Mono", monospace'
                fill="rgba(55, 58, 52, 0.75)"
              >
                {dateStr} {timeStr}
              </text>
            );
          })()}
      </svg>
    );
  });
