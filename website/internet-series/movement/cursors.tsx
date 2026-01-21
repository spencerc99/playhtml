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
  const scale = size / 32;
  return (
    <g transform={`scale(${scale})`}>
      {/* Based on pointinghand.svg */}
      <path
        d="M11.3,20.4c-0.3-0.4-0.6-1.1-1.2-2c-0.3-0.5-1.2-1.5-1.5-1.9c-0.2-0.4-0.2-0.6-0.1-1c0.1-0.6,0.7-1.1,1.4-1.1c0.5,0,1,0.4,1.4,0.7c0.2,0.2,0.5,0.6,0.7,0.8c0.2,0.2,0.2,0.3,0.4,0.5c0.2,0.3,0.3,0.5,0.2,0.1c-0.1-0.5-0.2-1.3-0.4-2.1c-0.1-0.6-0.2-0.7-0.3-1.1c-0.1-0.5-0.2-0.8-0.3-1.3c-0.1-0.3-0.2-1.1-0.3-1.5c-0.1-0.5-0.1-1.4,0.3-1.8c0.3-0.3,0.9-0.4,1.3-0.2c0.5,0.3,0.8,1,0.9,1.3c0.2,0.5,0.4,1.2,0.5,2c0.2,1,0.5,2.5,0.5,2.8c0-0.4-0.1-1.1,0-1.5c0.1-0.3,0.3-0.7,0.7-0.8c0.3-0.1,0.6-0.1,0.9-0.1c0.3,0.1,0.6,0.3,0.8,0.5c0.4,0.6,0.4,1.9,0.4,1.8c0.1-0.4,0.1-1.2,0.3-1.6c0.1-0.2,0.5-0.4,0.7-0.5c0.3-0.1,0.7-0.1,1,0c0.2,0,0.6,0.3,0.7,0.5c0.2,0.3,0.3,1.3,0.4,1.7c0,0.1,0.1-0.4,0.3-0.7c0.4-0.6,1.8-0.8,1.9,0.6c0,0.7,0,0.6,0,1.1c0,0.5,0,0.8,0,1.2c0,0.4-0.1,1.3-0.2,1.7c-0.1,0.3-0.4,1-0.7,1.4c0,0-1.1,1.2-1.2,1.8c-0.1,0.6-0.1,0.6-0.1,1c0,0.4,0.1,0.9,0.1,0.9s-0.8,0.1-1.2,0c-0.4-0.1-0.9-0.8-1-1.1c-0.2-0.3-0.5-0.3-0.7,0c-0.2,0.4-0.7,1.1-1.1,1.1c-0.7,0.1-2.1,0-3.1,0c0,0,0.2-1-0.2-1.4c-0.3-0.3-0.8-0.8-1.1-1.1L11.3,20.4z"
        fill={color}
        fillOpacity="0.85"
        stroke="black"
        strokeWidth="0.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Finger detail lines */}
      <line x1="19.6" y1="20.7" x2="19.6" y2="17.3" stroke="black" strokeWidth="0.75" strokeLinecap="round" />
      <line x1="17.6" y1="20.7" x2="17.5" y2="17.3" stroke="black" strokeWidth="0.75" strokeLinecap="round" />
      <line x1="15.6" y1="17.3" x2="15.6" y2="20.7" stroke="black" strokeWidth="0.75" strokeLinecap="round" />
    </g>
  );
};

// Text I-beam cursor
export const TextCursor = ({ color, size = 24 }: CursorProps) => {
  const scale = size / 24;
  return (
    <g transform={`scale(${scale})`}>
      {/* Based on text-cursor.svg */}
      <path
        d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1M7 22h1a4 4 0 0 0 4-4v-1M7 2h1a4 4 0 0 1 4 4v1"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fillOpacity="0.85"
      />
    </g>
  );
};

// Grab/hand cursor (open hand)
export const GrabCursor = ({ color, size = 24 }: CursorProps) => {
  const scale = size / 32;
  return (
    <g transform={`scale(${scale})`}>
      {/* Based on openhand (1).svg */}
      <path
        d="M12.6,16.6c-0.1-0.4-0.2-0.8-0.4-1.6c-0.2-0.6-0.3-0.9-0.5-1.2c-0.2-0.5-0.3-0.7-0.5-1.2c-0.1-0.3-0.4-1-0.5-1.4c-0.1-0.5,0-0.9,0.2-1.2c0.3-0.3,1-0.5,1.4-0.4c0.4,0.1,0.7,0.5,0.9,0.8c0.3,0.5,0.4,0.6,0.7,1.5c0.4,1,0.6,1.9,0.6,2.2l0.1,0.5c0,0,0-1.1,0-1.2c0-1-0.1-1.8,0-2.9c0-0.1,0.1-0.6,0.1-0.7c0.1-0.5,0.3-0.8,0.7-1c0.4-0.2,0.9-0.2,1.4,0c0.4,0.2,0.6,0.5,0.7,1c0,0.1,0.1,1,0.1,1.1c0,1,0,1.6,0,2.2c0,0.2,0,1.6,0,1.5c0.1-0.7,0.1-3.2,0.3-3.9c0.1-0.4,0.4-0.7,0.8-0.9c0.4-0.2,1.1-0.1,1.4,0.2c0.3,0.3,0.4,0.7,0.5,1.2c0,0.4,0,0.9,0,1.2c0,0.9,0,1.3,0,2.1c0,0,0,0.3,0,0.2c0.1-0.3,0.2-0.5,0.3-0.7c0-0.1,0.2-0.6,0.4-0.9c0.1-0.2,0.2-0.4,0.4-0.7c0.2-0.3,0.4-0.4,0.7-0.6c0.5-0.2,1.1,0.1,1.3,0.6c0.1,0.2,0,0.7,0,1.1c-0.1,0.6-0.3,1.3-0.4,1.6c-0.1,0.4-0.3,1.2-0.3,1.6c-0.1,0.4-0.2,1.4-0.4,1.8c-0.1,0.3-0.4,1-0.7,1.4c0,0-1.1,1.2-1.2,1.8c-0.1,0.6-0.1,0.6-0.1,1c0,0.4,0.1,0.9,0.1,0.9s-0.8,0.1-1.2,0c-0.4-0.1-0.9-0.8-1-1.1c-0.2-0.3-0.5-0.3-0.7,0c-0.2,0.4-0.7,1.1-1.1,1.1c-0.7,0.1-2.1,0-3.1,0c0,0,0.2-1-0.2-1.4c-0.3-0.3-0.8-0.8-1.1-1.1l-0.8-0.9c-0.3-0.4-0.6-1.1-1.2-2c-0.3-0.5-1-1.1-1.3-1.6c-0.2-0.4-0.3-1-0.2-1.3c0.2-0.6,0.7-0.9,1.4-0.8c0.5,0,0.8,0.2,1.2,0.5c0.2,0.2,0.6,0.5,0.8,0.7c0.2,0.2,0.2,0.3,0.4,0.5C12.6,16.8,12.6,16.9,12.6,16.6"
        fill={color}
        fillOpacity="0.7"
        stroke="black"
        strokeWidth="0.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Finger detail lines */}
      <line x1="19.6" y1="20.7" x2="19.6" y2="17.3" stroke="black" strokeWidth="0.75" strokeLinecap="round" />
      <line x1="17.6" y1="20.7" x2="17.5" y2="17.3" stroke="black" strokeWidth="0.75" strokeLinecap="round" />
      <line x1="15.6" y1="17.3" x2="15.6" y2="20.7" stroke="black" strokeWidth="0.75" strokeLinecap="round" />
    </g>
  );
};

// Grabbing cursor (closed hand)
export const GrabbingCursor = ({ color, size = 24 }: CursorProps) => {
  const scale = size / 32;
  return (
    <g transform={`scale(${scale})`}>
      {/* Based on closedhand.svg */}
      <path
        d="M12.6,13c0.5-0.2,1.4-0.1,1.7,0.5c0.2,0.5,0.4,1.2,0.4,1.1c0-0.4,0-1.2,0.1-1.6c0.1-0.3,0.3-0.6,0.7-0.7c0.3-0.1,0.6-0.1,0.9-0.1c0.3,0.1,0.6,0.3,0.8,0.5c0.4,0.6,0.4,1.9,0.4,1.8c0.1-0.3,0.1-1.2,0.3-1.6c0.1-0.2,0.5-0.4,0.7-0.5c0.3-0.1,0.7-0.1,1,0c0.2,0,0.6,0.3,0.7,0.5c0.2,0.3,0.3,1.3,0.4,1.7c0,0.1,0.1-0.4,0.3-0.7c0.4-0.6,1.8-0.8,1.9,0.6c0,0.7,0,0.6,0,1.1c0,0.5,0,0.8,0,1.2c0,0.4-0.1,1.3-0.2,1.7c-0.1,0.3-0.4,1-0.7,1.4c0,0-1.1,1.2-1.2,1.8c-0.1,0.6-0.1,0.6-0.1,1c0,0.4,0.1,0.9,0.1,0.9s-0.8,0.1-1.2,0c-0.4-0.1-0.9-0.8-1-1.1c-0.2-0.3-0.5-0.3-0.7,0c-0.2,0.4-0.7,1.1-1,1.1c-0.7,0.1-2.1,0-3.1,0c0,0,0.2-1-0.2-1.4c-0.3-0.3-0.8-0.8-1.1-1.1l-0.8-0.9c-0.3-0.4-1-0.9-1.2-2c-0.2-0.9-0.2-1.4,0-1.8c0.2-0.4,0.7-0.6,0.9-0.6c0.2,0,0.7,0,0.9,0.1c0.2,0.1,0.3,0.2,0.5,0.4c0.2,0.3,0.3,0.5,0.2,0.1c-0.1-0.3-0.3-0.6-0.4-1c-0.1-0.4-0.4-0.9-0.4-1.5C11.7,13.9,11.8,13.3,12.6,13"
        fill={color}
        fillOpacity="0.7"
        stroke="black"
        strokeWidth="0.75"
        strokeLinejoin="round"
      />
      {/* Finger detail lines */}
      <line x1="19.6" y1="20.7" x2="19.6" y2="17.3" stroke="black" strokeWidth="0.75" strokeLinecap="round" />
      <line x1="17.6" y1="20.7" x2="17.5" y2="17.3" stroke="black" strokeWidth="0.75" strokeLinecap="round" />
      <line x1="15.6" y1="17.3" x2="15.6" y2="20.7" stroke="black" strokeWidth="0.75" strokeLinecap="round" />
    </g>
  );
};

// Move cursor (four-way arrows)
export const MoveCursor = ({ color, size = 24 }: CursorProps) => {
  const scale = size / 18;
  return (
    <g transform={`scale(${scale})`}>
      {/* Based on move.svg */}
      <path
        d="M9,1L1,9l5.2,5.2L9,17l8-8L9,1z M7,12H6v-1h1V12z M7,7H6V6h1V7z M12,12h-1v-1h1V12z M11,6h1v1h-1V6z"
        fill="white"
        fillOpacity="0.85"
      />
      <polygon
        points="15.6,9 13,6.2 13,8 9,8 5,8 5,6.2 2.4,9 5,11.8 5,10 9,10 13,10 13,11.8"
        fill={color}
      />
      <polygon
        points="10,9 10,9 10,5 11.8,5 9,2.4 6.2,5 8,5 8,9 8,9 8,13 6.2,13 9,15.6 11.8,13 10,13"
        fill={color}
      />
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
