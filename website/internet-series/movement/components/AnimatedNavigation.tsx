// ABOUTME: Animated navigation graph visualization component
// ABOUTME: Shows navigation hops building up a graph - nodes appear when edges reach them
// ABOUTME: Edges and nodes stay visible after appearing (graph builds up over time)
import React, { useState, useEffect, useRef, memo, useCallback } from "react";
import { NavigationNode, NavigationEdge, NavigationState, NavigationJourney } from "../types";

// Configuration
const HOP_DURATION = 1200; // How long edge takes to draw (ms)
const HOP_STAGGER = 800; // Time between spawning hops (ms)
const MAX_CONCURRENT_HOPS = 3; // Max hops animating at once
const CYCLE_PAUSE = 2000; // Pause before restarting cycle (ms)

// RISO-inspired color palette
const RISO_COLORS = [
  "rgb(0, 120, 191)", // Blue
  "rgb(255, 102, 94)", // Bright Red
  "rgb(0, 169, 92)", // Green
  "rgb(255, 123, 75)", // Orange
  "rgb(146, 55, 141)", // Purple
  "rgb(255, 232, 0)", // Yellow
  "rgb(255, 72, 176)", // Fluorescent Pink
  "rgb(0, 131, 138)", // Teal
];

interface AnimatedNavigationProps {
  navigationState: NavigationState;
  timeRange: { min: number; max: number; duration: number };
  settings: {
    animationSpeed: number;
    navigationWindowOpacity: number;
    navigationEdgeOpacity: number;
    navigationUniqueHopsOnly: boolean;
    randomizeColors?: boolean;
  };
}

// A single navigation hop: from one node to another
interface NavigationHop {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  edgeId: string;
  color: string;
}

// An active hop animation
interface ActiveHop {
  id: string;
  hop: NavigationHop;
  startTime: number;
  duration: number;
}

// Format URL for display
function formatUrlForDisplay(node: NavigationNode, maxLength: number = 18): string {
  const fullPath = node.id;
  
  if (fullPath === node.domain || fullPath === node.domain + "/") {
    return node.domain.length > maxLength 
      ? node.domain.slice(0, maxLength - 2) + ".." 
      : node.domain;
  }
  
  const pathStart = fullPath.indexOf("/");
  if (pathStart === -1) {
    return fullPath.length > maxLength ? fullPath.slice(0, maxLength - 2) + ".." : fullPath;
  }
  
  const domain = fullPath.slice(0, pathStart);
  const path = fullPath.slice(pathStart);
  
  const shortDomain = domain.length > 12 ? domain.slice(0, 10) + ".." : domain;
  const remainingLength = maxLength - shortDomain.length;
  
  if (path.length <= remainingLength) {
    return shortDomain + path;
  }
  
  const pathParts = path.split("/").filter(p => p);
  if (pathParts.length > 0) {
    const lastPart = pathParts[pathParts.length - 1];
    const abbreviated = lastPart.length > remainingLength - 3 
      ? "/.." + lastPart.slice(-(remainingLength - 4))
      : "/.." + lastPart;
    return shortDomain + abbreviated;
  }
  
  return shortDomain + path.slice(0, remainingLength - 2) + "..";
}

// Generate SVG path from points
function generatePathFromPoints(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  
  let path = `M ${points[0].x} ${points[0].y}`;
  
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    path += ` Q ${p1.x} ${p1.y} ${(p1.x + p2.x) / 2} ${(p1.y + p2.y) / 2}`;
  }
  
  if (points.length > 1) {
    const lastPoint = points[points.length - 1];
    const secondLast = points[points.length - 2];
    path += ` Q ${secondLast.x} ${secondLast.y} ${lastPoint.x} ${lastPoint.y}`;
  }
  
  return path;
}

// Generate wobbly path between two points
function generateWobblyPath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  seed: number
): Array<{ x: number; y: number }> {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  const numPoints = Math.max(4, Math.min(12, Math.ceil(distance / 35)));
  const points: Array<{ x: number; y: number }> = [source];
  
  for (let i = 1; i < numPoints; i++) {
    const t = i / numPoints;
    const baseX = source.x + dx * t;
    const baseY = source.y + dy * t;
    
    const rand = (offset: number) => {
      const x = Math.sin(seed + i * 12.9898 + offset * 7.233) * 43758.5453;
      return x - Math.floor(x);
    };
    
    const wobble = 15;
    const offsetX = (rand(0) - 0.5) * wobble;
    const offsetY = (rand(1) - 0.5) * wobble;
    
    points.push({ x: baseX + offsetX, y: baseY + offsetY });
  }
  
  points.push(target);
  return points;
}

// Hash string to number
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// Node component - appears when revealed
const NodePill = memo(({
  node,
  opacity,
  color,
  scale = 1,
}: {
  node: NavigationNode;
  opacity: number;
  color: string;
  scale?: number;
}) => {
  const width = 140;
  const height = 24;
  const x = node.x - width / 2;
  const y = node.y - height / 2;
  
  const displayUrl = formatUrlForDisplay(node, 18);
  
  return (
    <g 
      opacity={opacity}
      transform={`translate(${node.x}, ${node.y}) scale(${scale}) translate(${-node.x}, ${-node.y})`}
    >
      {/* Shadow */}
      <rect
        x={x + 2}
        y={y + 2}
        width={width}
        height={height}
        rx={4}
        ry={4}
        fill="rgba(0,0,0,0.15)"
      />
      
      {/* Background */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        ry={4}
        fill="white"
        stroke={color}
        strokeWidth={2}
      />
      
      {/* Color accent */}
      <rect
        x={x}
        y={y}
        width={6}
        height={height}
        rx={4}
        ry={4}
        fill={color}
      />
      <rect
        x={x + 3}
        y={y}
        width={3}
        height={height}
        fill={color}
      />
      
      {/* URL text */}
      <text
        x={x + 12}
        y={node.y + 4}
        fontSize={9}
        fontFamily='"Martian Mono", "Space Mono", "Courier New", monospace'
        fill="#333"
        fontWeight="500"
      >
        {displayUrl}
      </text>
    </g>
  );
});

// Edge component - draws progressively
const EdgePath = memo(({
  sourceNode,
  targetNode,
  progress,
  opacity,
  color,
  seed,
}: {
  sourceNode: NavigationNode;
  targetNode: NavigationNode;
  progress: number;
  opacity: number;
  color: string;
  seed: number;
}) => {
  if (progress <= 0) return null;
  
  const wobblePath = generateWobblyPath(
    { x: sourceNode.x, y: sourceNode.y },
    { x: targetNode.x, y: targetNode.y },
    seed
  );
  
  const pathData = generatePathFromPoints(wobblePath);
  
  const totalLength = wobblePath.reduce((acc, point, i) => {
    if (i === 0) return 0;
    const prev = wobblePath[i - 1];
    return acc + Math.sqrt(Math.pow(point.x - prev.x, 2) + Math.pow(point.y - prev.y, 2));
  }, 0);
  
  const visibleLength = totalLength * progress;
  const dashArray = `${visibleLength} ${totalLength - visibleLength + 50}`;
  
  return (
    <path
      d={pathData}
      fill="none"
      stroke={color}
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      strokeDasharray={dashArray}
      style={{ mixBlendMode: "multiply" }}
    />
  );
});

export const AnimatedNavigation: React.FC<AnimatedNavigationProps> = memo(({
  navigationState,
  timeRange,
  settings,
}) => {
  // Track which nodes and edges have been revealed (stay visible)
  const [revealedNodes, setRevealedNodes] = useState<Map<string, string>>(new Map()); // nodeId -> color
  const [revealedEdges, setRevealedEdges] = useState<Map<string, string>>(new Map()); // edgeId -> color
  const [activeHops, setActiveHops] = useState<ActiveHop[]>([]);
  
  const hopQueueRef = useRef<NavigationHop[]>([]);
  const queueIndexRef = useRef(0);
  const lastSpawnTimeRef = useRef(0);
  const animationFrameRef = useRef<number>();
  const cycleStartTimeRef = useRef<number>(0);
  
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  
  // Build hop queue from journeys
  useEffect(() => {
    if (!navigationState || navigationState.journeys.length === 0) {
      hopQueueRef.current = [];
      return;
    }
    
    const hops: NavigationHop[] = [];
    const seenEdges = new Set<string>();
    
    const multiNodeJourneys = navigationState.journeys.filter(j => j.edgeSequence.length > 0);
    
    multiNodeJourneys.forEach(journey => {
      for (let i = 0; i < journey.edgeSequence.length; i++) {
        const edgeId = journey.edgeSequence[i];
        const sourceNodeId = journey.nodeSequence[i];
        const targetNodeId = journey.nodeSequence[i + 1];
        
        // If unique hops only, skip if we've seen this edge
        if (settingsRef.current.navigationUniqueHopsOnly && seenEdges.has(edgeId)) {
          continue;
        }
        
        if (sourceNodeId && targetNodeId) {
          seenEdges.add(edgeId);
          hops.push({
            id: `${journey.id}-hop-${i}`,
            sourceNodeId,
            targetNodeId,
            edgeId,
            color: journey.color,
          });
        }
      }
    });
    
    // Shuffle for variety
    for (let i = hops.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [hops[i], hops[j]] = [hops[j], hops[i]];
    }
    
    hopQueueRef.current = hops;
    queueIndexRef.current = 0;
    
    // Reset revealed state
    setRevealedNodes(new Map());
    setRevealedEdges(new Map());
    setActiveHops([]);
    cycleStartTimeRef.current = 0;
    
    console.log(`[Navigation] Created ${hops.length} hops (unique: ${settingsRef.current.navigationUniqueHopsOnly})`);
  }, [navigationState, settings.navigationUniqueHopsOnly]);
  
  // Node lookup map
  const nodeMap = React.useMemo(() => {
    const map = new Map<string, NavigationNode>();
    navigationState.nodes.forEach(n => map.set(n.id, n));
    return map;
  }, [navigationState.nodes]);
  
  // Get next hop from queue
  const getNextHop = useCallback((): NavigationHop | null => {
    const queue = hopQueueRef.current;
    if (queue.length === 0) return null;
    
    const hop = queue[queueIndexRef.current];
    queueIndexRef.current = (queueIndexRef.current + 1) % queue.length;
    
    // Check if we've completed a cycle
    if (queueIndexRef.current === 0) {
      return null; // Signal cycle complete
    }
    
    return hop;
  }, []);
  
  // Animation loop
  useEffect(() => {
    if (navigationState.nodes.length === 0 || hopQueueRef.current.length === 0) return;
    
    const animate = (timestamp: number) => {
      if (cycleStartTimeRef.current === 0) {
        cycleStartTimeRef.current = timestamp;
      }
      
      const now = timestamp;
      const speed = settingsRef.current.animationSpeed;
      
      // Check if we should restart the cycle
      const allHopsProcessed = queueIndexRef.current === 0 && revealedEdges.size > 0;
      if (allHopsProcessed && activeHops.length === 0) {
        // Wait for pause, then restart
        const pauseElapsed = now - lastSpawnTimeRef.current;
        if (pauseElapsed > CYCLE_PAUSE / speed) {
          // Reset for new cycle
          setRevealedNodes(new Map());
          setRevealedEdges(new Map());
          queueIndexRef.current = 0;
          cycleStartTimeRef.current = now;
        }
      }
      
      // Try to spawn new hop
      if (now - lastSpawnTimeRef.current > HOP_STAGGER / speed) {
        const activeCount = activeHops.length;
        
        if (activeCount < MAX_CONCURRENT_HOPS) {
          const hop = getNextHop();
          if (hop) {
            const sourceNode = nodeMap.get(hop.sourceNodeId);
            const targetNode = nodeMap.get(hop.targetNodeId);
            
            if (sourceNode && targetNode) {
              // Reveal source node immediately when hop starts
              setRevealedNodes(prev => {
                const next = new Map(prev);
                if (!next.has(hop.sourceNodeId)) {
                  next.set(hop.sourceNodeId, hop.color);
                }
                return next;
              });
              
              setActiveHops(prev => [...prev, {
                id: `${hop.id}-${now}`,
                hop,
                startTime: now,
                duration: HOP_DURATION / speed,
              }]);
              lastSpawnTimeRef.current = now;
            }
          }
        }
      }
      
      // Update active hops
      const completedHops: ActiveHop[] = [];
      const stillActive: ActiveHop[] = [];
      
      activeHops.forEach(activeHop => {
        const elapsed = now - activeHop.startTime;
        if (elapsed >= activeHop.duration) {
          completedHops.push(activeHop);
        } else {
          stillActive.push(activeHop);
        }
      });
      
      // Mark completed hops' targets and edges as permanently revealed
      if (completedHops.length > 0) {
        setRevealedNodes(prev => {
          const next = new Map(prev);
          completedHops.forEach(h => {
            if (!next.has(h.hop.targetNodeId)) {
              next.set(h.hop.targetNodeId, h.hop.color);
            }
          });
          return next;
        });
        
        setRevealedEdges(prev => {
          const next = new Map(prev);
          completedHops.forEach(h => {
            if (!next.has(h.hop.edgeId)) {
              next.set(h.hop.edgeId, h.hop.color);
            }
          });
          return next;
        });
        
        setActiveHops(stillActive);
      }
      
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [navigationState.nodes.length, activeHops, getNextHop, nodeMap, revealedEdges.size]);
  
  if (navigationState.nodes.length === 0) {
    return null;
  }
  
  const windowOpacity = settings.navigationWindowOpacity;
  const edgeOpacity = settings.navigationEdgeOpacity;
  
  // Calculate current progress for active hops
  const now = performance.now();
  const activeHopProgress = new Map<string, { progress: number; color: string; sourceId: string; targetId: string }>();
  
  activeHops.forEach(activeHop => {
    const elapsed = now - activeHop.startTime;
    const progress = Math.min(1, elapsed / activeHop.duration);
    activeHopProgress.set(activeHop.hop.edgeId, {
      progress,
      color: activeHop.hop.color,
      sourceId: activeHop.hop.sourceNodeId,
      targetId: activeHop.hop.targetNodeId,
    });
  });
  
  return (
    <svg
      className="navigation-svg"
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
      }}
    >
      {/* Render permanently revealed edges */}
      {Array.from(revealedEdges.entries()).map(([edgeId, color]) => {
        const edge = navigationState.edges.find(e => e.id === edgeId);
        if (!edge) return null;
        
        const sourceNode = nodeMap.get(edge.source);
        const targetNode = nodeMap.get(edge.target);
        if (!sourceNode || !targetNode) return null;
        
        // Skip if this edge is currently animating
        if (activeHopProgress.has(edgeId)) return null;
        
        return (
          <EdgePath
            key={`revealed-${edgeId}`}
            sourceNode={sourceNode}
            targetNode={targetNode}
            progress={1}
            opacity={edgeOpacity}
            color={color}
            seed={hashString(edgeId)}
          />
        );
      })}
      
      {/* Render actively animating edges */}
      {activeHops.map(activeHop => {
        const sourceNode = nodeMap.get(activeHop.hop.sourceNodeId);
        const targetNode = nodeMap.get(activeHop.hop.targetNodeId);
        if (!sourceNode || !targetNode) return null;
        
        const elapsed = now - activeHop.startTime;
        const progress = Math.min(1, elapsed / activeHop.duration);
        
        return (
          <EdgePath
            key={activeHop.id}
            sourceNode={sourceNode}
            targetNode={targetNode}
            progress={progress}
            opacity={edgeOpacity}
            color={activeHop.hop.color}
            seed={hashString(activeHop.hop.edgeId)}
          />
        );
      })}
      
      {/* Render permanently revealed nodes */}
      {Array.from(revealedNodes.entries()).map(([nodeId, color]) => {
        const node = nodeMap.get(nodeId);
        if (!node) return null;
        
        return (
          <NodePill
            key={`revealed-${nodeId}`}
            node={node}
            opacity={windowOpacity}
            color={color}
          />
        );
      })}
      
      {/* Render nodes that are targets of active hops (appearing) */}
      {activeHops.map(activeHop => {
        const targetNode = nodeMap.get(activeHop.hop.targetNodeId);
        if (!targetNode) return null;
        
        // Skip if already revealed
        if (revealedNodes.has(activeHop.hop.targetNodeId)) return null;
        
        const elapsed = now - activeHop.startTime;
        const progress = Math.min(1, elapsed / activeHop.duration);
        
        // Target node starts appearing at 60% of edge progress
        const nodeProgress = Math.max(0, (progress - 0.6) / 0.4);
        if (nodeProgress <= 0) return null;
        
        const scale = 0.8 + nodeProgress * 0.2;
        const opacity = nodeProgress * windowOpacity;
        
        return (
          <NodePill
            key={`appearing-${activeHop.id}`}
            node={targetNode}
            opacity={opacity}
            color={activeHop.hop.color}
            scale={scale}
          />
        );
      })}
    </svg>
  );
});
