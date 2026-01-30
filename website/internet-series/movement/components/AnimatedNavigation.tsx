// ABOUTME: Animated navigation timeline visualization - branching roots style
// ABOUTME: Auto-scrolling timeline with sessions as tracks and shared nodes
// ABOUTME: Nodes appear when visible, edges connect with organic wobbly lines

import React, { useState, useEffect, useRef, memo } from "react";
import { TimelineState, TimelineNode, TimelineEdge, TimelineSession } from "../types";

interface AnimatedNavigationProps {
  timelineState: TimelineState;
  canvasSize: { width: number; height: number };
  settings: {
    scrollSpeed: number;
    nodeOpacity: number;
    edgeOpacity: number;
    randomizeColors?: boolean;
  };
}

// Configuration
const FADE_DISTANCE = 100; // px to fade in/out at edges
const NODE_RADIUS = 8;
const LABEL_OFFSET = 15;

// Generate SVG path from points with smooth curves
function generateSmoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length < 2) return "";
  
  let path = `M ${points[0].x} ${points[0].y}`;
  
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    
    // Catmull-Rom to Bezier conversion
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    
    path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }
  
  return path;
}

// Generate wobbly organic path between two points
function generateWobblyPath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  seed: number
): Array<{ x: number; y: number }> {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  // More points for longer distances
  const numPoints = Math.max(3, Math.min(8, Math.ceil(distance / 60)));
  const points: Array<{ x: number; y: number }> = [source];
  
  // Seeded random
  const rand = (offset: number) => {
    const x = Math.sin(seed + offset * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  
  for (let i = 1; i < numPoints; i++) {
    const t = i / numPoints;
    const baseX = source.x + dx * t;
    const baseY = source.y + dy * t;
    
    // Organic wobble - perpendicular to the line
    const perpX = -dy / distance;
    const perpY = dx / distance;
    const wobbleAmount = 20 * (1 - Math.abs(t - 0.5) * 2); // More wobble in middle
    const wobble = (rand(i) - 0.5) * wobbleAmount;
    
    points.push({
      x: baseX + perpX * wobble,
      y: baseY + perpY * wobble,
    });
  }
  
  points.push(target);
  return points;
}

// Hash string for seeding
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// Format URL for label
function formatLabel(node: TimelineNode): string {
  // Show domain and abbreviated path
  const path = node.id.replace(node.domain, "");
  if (!path || path === "/") {
    return node.domain;
  }
  
  // Abbreviate long paths
  if (path.length > 15) {
    const parts = path.split("/").filter(p => p);
    if (parts.length > 0) {
      return node.domain + "/..." + parts[parts.length - 1].slice(0, 10);
    }
  }
  
  return node.domain + path.slice(0, 12);
}

// Node component
const TimelineNodeComponent = memo(({
  node,
  opacity,
  showLabel,
}: {
  node: TimelineNode;
  opacity: number;
  showLabel: boolean;
}) => {
  if (opacity <= 0) return null;
  
  return (
    <g opacity={opacity}>
      {/* Node circle */}
      <circle
        cx={node.x}
        cy={node.y}
        r={NODE_RADIUS + Math.min(4, node.visitCount - 1)}
        fill={node.color}
        stroke="white"
        strokeWidth={2}
        style={{ filter: "drop-shadow(1px 1px 2px rgba(0,0,0,0.2))" }}
      />
      
      {/* Floating label */}
      {showLabel && (
        <text
          x={node.x}
          y={node.y + NODE_RADIUS + LABEL_OFFSET}
          textAnchor="middle"
          fontSize={9}
          fontFamily='"Martian Mono", "Space Mono", monospace'
          fill="#666"
          opacity={0.8}
        >
          {formatLabel(node)}
        </text>
      )}
    </g>
  );
});

// Edge component
const TimelineEdgeComponent = memo(({
  edge,
  sourceNode,
  targetNode,
  opacity,
}: {
  edge: TimelineEdge;
  sourceNode: TimelineNode;
  targetNode: TimelineNode;
  opacity: number;
}) => {
  if (opacity <= 0) return null;
  
  const seed = hashString(edge.id);
  const wobblePath = generateWobblyPath(
    { x: sourceNode.x, y: sourceNode.y },
    { x: targetNode.x, y: targetNode.y },
    seed
  );
  
  const pathData = generateSmoothPath(wobblePath);
  
  return (
    <path
      d={pathData}
      fill="none"
      stroke={edge.color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
      style={{ mixBlendMode: "multiply" }}
    />
  );
});

export const AnimatedNavigation: React.FC<AnimatedNavigationProps> = memo(({
  timelineState,
  canvasSize,
  settings,
}) => {
  const [scrollOffset, setScrollOffset] = useState(0);
  const animationFrameRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);
  
  // Settings refs
  const scrollSpeedRef = useRef(settings.scrollSpeed);
  useEffect(() => {
    scrollSpeedRef.current = settings.scrollSpeed;
  }, [settings.scrollSpeed]);
  
  // Auto-scroll animation
  useEffect(() => {
    if (!timelineState || timelineState.nodes.size === 0) return;
    
    const animate = (timestamp: number) => {
      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
      }
      
      const deltaTime = (timestamp - lastTimeRef.current) / 1000; // seconds
      lastTimeRef.current = timestamp;
      
      setScrollOffset(prev => {
        const newOffset = prev + scrollSpeedRef.current * deltaTime;
        
        // Loop back when we've scrolled past all content
        const maxScroll = timelineState.totalWidth - canvasSize.width + 200;
        if (newOffset > maxScroll) {
          return 0; // Loop back to start
        }
        
        return newOffset;
      });
      
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    
    animationFrameRef.current = requestAnimationFrame(animate);
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      lastTimeRef.current = 0;
    };
  }, [timelineState, canvasSize.width]);
  
  if (!timelineState || timelineState.nodes.size === 0) {
    return null;
  }
  
  // Calculate visible range
  const visibleLeft = scrollOffset - FADE_DISTANCE;
  const visibleRight = scrollOffset + canvasSize.width + FADE_DISTANCE;
  
  // Calculate opacity based on position in viewport
  const getOpacity = (x: number, baseOpacity: number): number => {
    const relativeX = x - scrollOffset;
    
    // Fade in from left
    if (relativeX < FADE_DISTANCE) {
      return baseOpacity * Math.max(0, relativeX / FADE_DISTANCE);
    }
    
    // Fade out to right
    if (relativeX > canvasSize.width - FADE_DISTANCE) {
      return baseOpacity * Math.max(0, (canvasSize.width - relativeX) / FADE_DISTANCE);
    }
    
    return baseOpacity;
  };
  
  // Get visible nodes
  const visibleNodes = Array.from(timelineState.nodes.values()).filter(
    node => node.x >= visibleLeft && node.x <= visibleRight
  );
  
  // Get visible edges (both endpoints must be in extended visible range)
  const visibleEdges = timelineState.edges.filter(edge => {
    const sourceNode = timelineState.nodes.get(edge.sourceNodeId);
    const targetNode = timelineState.nodes.get(edge.targetNodeId);
    if (!sourceNode || !targetNode) return false;
    
    const minX = Math.min(sourceNode.x, targetNode.x);
    const maxX = Math.max(sourceNode.x, targetNode.x);
    
    return maxX >= visibleLeft && minX <= visibleRight;
  });
  
  return (
    <svg
      className="navigation-timeline-svg"
      width="100%"
      height="100%"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {/* Transform group for scrolling */}
      <g transform={`translate(${-scrollOffset}, 0)`}>
        {/* Render edges first (below nodes) */}
        {visibleEdges.map(edge => {
          const sourceNode = timelineState.nodes.get(edge.sourceNodeId);
          const targetNode = timelineState.nodes.get(edge.targetNodeId);
          if (!sourceNode || !targetNode) return null;
          
          // Use average x for opacity calculation
          const avgX = (sourceNode.x + targetNode.x) / 2;
          const opacity = getOpacity(avgX, settings.edgeOpacity);
          
          return (
            <TimelineEdgeComponent
              key={edge.id}
              edge={edge}
              sourceNode={sourceNode}
              targetNode={targetNode}
              opacity={opacity}
            />
          );
        })}
        
        {/* Render nodes */}
        {visibleNodes.map(node => {
          const opacity = getOpacity(node.x, settings.nodeOpacity);
          // Show label for nodes with higher opacity (more central)
          const showLabel = opacity > settings.nodeOpacity * 0.7;
          
          return (
            <TimelineNodeComponent
              key={node.id}
              node={node}
              opacity={opacity}
              showLabel={showLabel}
            />
          );
        })}
      </g>
      
      {/* Gradient overlays for fade effect */}
      <defs>
        <linearGradient id="fadeLeft" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgb(245,244,241)" stopOpacity="1" />
          <stop offset="100%" stopColor="rgb(245,244,241)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fadeRight" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgb(245,244,241)" stopOpacity="0" />
          <stop offset="100%" stopColor="rgb(245,244,241)" stopOpacity="1" />
        </linearGradient>
      </defs>
      
      {/* Left fade overlay */}
      <rect
        x="0"
        y="0"
        width={FADE_DISTANCE}
        height={canvasSize.height}
        fill="url(#fadeLeft)"
      />
      
      {/* Right fade overlay */}
      <rect
        x={canvasSize.width - FADE_DISTANCE}
        y="0"
        width={FADE_DISTANCE}
        height={canvasSize.height}
        fill="url(#fadeRight)"
      />
    </svg>
  );
});
