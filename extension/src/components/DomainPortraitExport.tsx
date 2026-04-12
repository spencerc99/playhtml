// ABOUTME: Fixed 800x1000px off-screen div for html2canvas domain portrait capture
// ABOUTME: Renders paper texture + frozen trails + PortraitCard for snapshot export

import React from "react";
import type { TrailState } from "../../../website/internet-series/movement/types";
import { AnimatedTrails } from "../../../website/internet-series/movement/components/AnimatedTrails";
import { PortraitCard, type PortraitCardProps } from "./PortraitCard";

interface DomainPortraitExportProps {
  domain: string;
  stats: PortraitCardProps;
  trailStates: TrailState[];
  timeRange: { min: number; max: number; duration: number };
}

const WIDTH = 800;
const HEIGHT = 1000;

export function DomainPortraitExport({
  stats,
  trailStates,
  timeRange,
}: DomainPortraitExportProps) {
  return (
    <div
      style={{
        position: "absolute",
        left: "-9999px",
        top: 0,
        width: `${WIDTH}px`,
        height: `${HEIGHT}px`,
        overflow: "hidden",
        background: "#faf7f2",
        fontFamily:
          "'Atkinson Hyperlegible', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      {/* RISO paper texture */}
      <svg
        width="100%"
        height="100%"
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.7,
          pointerEvents: "none",
          mixBlendMode: "multiply",
        }}
      >
        <defs>
          <filter id="export-noise">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="3"
              stitchTiles="stitch"
            />
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 2 -1"
            />
          </filter>
          <filter id="export-grain">
            <feTurbulence
              type="turbulence"
              baseFrequency="0.5"
              numOctaves="2"
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="discrete" tableValues="0 0.2 0.3 0.4" />
            </feComponentTransfer>
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#export-noise)" />
        <rect
          width="100%"
          height="100%"
          filter="url(#export-grain)"
          style={{ opacity: 0.3 }}
        />
      </svg>

      {/* Frozen trails filling full canvas */}
      {trailStates.length > 0 && (
        <AnimatedTrails
          trailStates={trailStates}
          timeRange={timeRange}
          frozen={true}
          showClickRipples={false}
          settings={{
            strokeWidth: 5,
            trailOpacity: 0.7,
            animationSpeed: 1,
            clickMinRadius: 10,
            clickMaxRadius: 80,
            clickMinDuration: 500,
            clickMaxDuration: 2500,
            clickExpansionDuration: 12300,
            clickStrokeWidth: 4,
            clickOpacity: 0.3,
            clickNumRings: 6,
            clickRingDelayMs: 360,
            clickAnimationStopPoint: 0.45,
          }}
        />
      )}

      {/* PortraitCard anchored to bottom third */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: `${Math.round(HEIGHT * 0.4)}px`,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          padding: "0 0 40px",
          background:
            "linear-gradient(to bottom, transparent, rgba(61,56,51,0.7) 40%)",
        }}
      >
        <PortraitCard {...stats} />
      </div>
    </div>
  );
}
