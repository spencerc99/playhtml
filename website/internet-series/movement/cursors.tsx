/**
 * SVG Cursor Shapes Library
 * 
 * Different cursor types for visualizing cursor style changes
 */

import React from "react";

interface CursorProps {
  color: string;
  size?: number; // Base size (default: 24)
}

// Default arrow cursor (pointer)
export const DefaultCursor = ({ color, size = 24 }: CursorProps) => {
  const scale = size / 24;
  return (
    <g transform={`scale(${scale})`}>
      {/* White outline for contrast */}
      <path
        d="M12 4 L12 20 L16 16 L20 23 L23 21 L19 14 L24 14 Z"
        fill="white"
        stroke="none"
      />
      {/* Colored fill */}
      <path
        d="M12 4 L12 20 L16 16 L20 23 L23 21 L19 14 L24 14 Z"
        fill={color}
        stroke="white"
        strokeWidth="0.5"
        strokeLinejoin="round"
        transform="translate(-0.5, -0.5)"
      />
    </g>
  );
};

// Pointer hand cursor (for clickable elements)
export const PointerCursor = ({ color, size = 24 }: CursorProps) => {
  const scale = size / 24;
  return (
    <g transform={`scale(${scale})`}>
      {/* Hand with pointing finger */}
      {/* White outline */}
      <path
        d="M12 4 L12 10 L14 10 L14 6 L16 6 L16 10 L18 10 L18 7 L20 7 L20 12 L20 16 C20 17 19 18 18 18 L14 18 L10 14 L10 10 L12 10 Z"
        fill="white"
        stroke="none"
      />
      {/* Colored fill */}
      <path
        d="M12 4 L12 10 L14 10 L14 6 L16 6 L16 10 L18 10 L18 7 L20 7 L20 12 L20 16 C20 17 19 18 18 18 L14 18 L10 14 L10 10 L12 10 Z"
        fill={color}
        stroke="white"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    </g>
  );
};

// Text I-beam cursor
export const TextCursor = ({ color, size = 24 }: CursorProps) => {
  const scale = size / 24;
  return (
    <g transform={`scale(${scale})`}>
      {/* I-beam shape */}
      {/* White outline */}
      <g transform="translate(12, 12)">
        <path
          d="M-3 -8 L3 -8 M0 -8 L0 8 M-3 8 L3 8"
          stroke="white"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        {/* Colored stroke */}
        <path
          d="M-3 -8 L3 -8 M0 -8 L0 8 M-3 8 L3 8"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </g>
  );
};

// Grab/hand cursor (open hand)
export const GrabCursor = ({ color, size = 24 }: CursorProps) => {
  const scale = size / 24;
  return (
    <g transform={`scale(${scale})`}>
      {/* Open hand */}
      {/* White outline */}
      <path
        d="M8 10 L8 6 L10 6 L10 10 M10 10 L10 5 L12 5 L12 10 M12 10 L12 4 L14 4 L14 10 M14 10 L14 6 L16 6 L16 11 L16 15 C16 17 14 18 12 18 L10 18 L6 14 L6 11 L8 11 Z"
        fill="white"
        stroke="none"
      />
      {/* Colored fill */}
      <path
        d="M8 10 L8 6 L10 6 L10 10 M10 10 L10 5 L12 5 L12 10 M12 10 L12 4 L14 4 L14 10 M14 10 L14 6 L16 6 L16 11 L16 15 C16 17 14 18 12 18 L10 18 L6 14 L6 11 L8 11 Z"
        fill={color}
        stroke="white"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    </g>
  );
};

// Grabbing cursor (closed hand)
export const GrabbingCursor = ({ color, size = 24 }: CursorProps) => {
  const scale = size / 24;
  return (
    <g transform={`scale(${scale})`}>
      {/* Closed fist */}
      {/* White outline */}
      <path
        d="M8 12 L8 10 L10 10 L10 11 L12 11 L12 10 L14 10 L14 11 L16 11 L16 13 L16 16 C16 17.5 14.5 19 13 19 L11 19 L7 15 L7 13 L8 13 Z"
        fill="white"
        stroke="none"
      />
      {/* Colored fill */}
      <path
        d="M8 12 L8 10 L10 10 L10 11 L12 11 L12 10 L14 10 L14 11 L16 11 L16 13 L16 16 C16 17.5 14.5 19 13 19 L11 19 L7 15 L7 13 L8 13 Z"
        fill={color}
        stroke="white"
        strokeWidth="0.5"
        strokeLinejoin="round"
      />
    </g>
  );
};

// Move cursor (four-way arrows)
export const MoveCursor = ({ color, size = 24 }: CursorProps) => {
  const scale = size / 24;
  return (
    <g transform={`scale(${scale})`}>
      {/* Four-way arrows */}
      {/* White outline */}
      <g transform="translate(12, 12)">
        <path
          d="M0 -8 L-2 -6 L-1 -6 L-1 -1 L-6 -1 L-6 -2 L-8 0 L-6 2 L-6 1 L-1 1 L-1 6 L-2 6 L0 8 L2 6 L1 6 L1 1 L6 1 L6 2 L8 0 L6 -2 L6 -1 L1 -1 L1 -6 L2 -6 Z"
          fill="white"
          stroke="none"
        />
        {/* Colored fill */}
        <path
          d="M0 -8 L-2 -6 L-1 -6 L-1 -1 L-6 -1 L-6 -2 L-8 0 L-6 2 L-6 1 L-1 1 L-1 6 L-2 6 L0 8 L2 6 L1 6 L1 1 L6 1 L6 2 L8 0 L6 -2 L6 -1 L1 -1 L1 -6 L2 -6 Z"
          fill={color}
          stroke="white"
          strokeWidth="0.3"
        />
      </g>
    </g>
  );
};

// Helper function to get the right cursor component
export const getCursorComponent = (
  cursorType: string | undefined
): React.ComponentType<CursorProps> => {
  switch (cursorType) {
    case "pointer":
      return PointerCursor;
    case "text":
      return TextCursor;
    case "grab":
      return GrabCursor;
    case "grabbing":
      return GrabbingCursor;
    case "move":
    case "all-scroll":
      return MoveCursor;
    case "default":
    case undefined:
    default:
      return DefaultCursor;
  }
};
