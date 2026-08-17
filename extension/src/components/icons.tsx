// ABOUTME: Shared SVG icon components for collector types and cursor preview
// ABOUTME: All icons parameterize size; cursor also accepts a color prop

import React from "react";

const TEXT_COLOR = "#3d3833";
const SURFACE_COLOR = "#efe9df";
const SCROLLBAR_TRACK = "#b5aea5";

interface SizeProps {
  size?: number;
}

export function CursorSvg({ size = 14, color = TEXT_COLOR }: SizeProps & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path d="m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z" fill={color} />
      <path d="m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z" fill={color} />
    </svg>
  );
}

export function KeyboardSvg({ size = 14 }: SizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="7" width="18" height="10" rx="2" stroke={TEXT_COLOR} />
      <rect x="5" y="9" width="2" height="2" fill={TEXT_COLOR} />
      <rect x="8" y="9" width="2" height="2" fill={TEXT_COLOR} />
      <rect x="11" y="9" width="2" height="2" fill={TEXT_COLOR} />
      <rect x="14" y="9" width="2" height="2" fill={TEXT_COLOR} />
      <rect x="17" y="9" width="2" height="2" fill={TEXT_COLOR} />
      <rect x="5" y="12" width="10" height="2" fill={TEXT_COLOR} />
      <rect x="16" y="12" width="3" height="2" fill={TEXT_COLOR} />
    </svg>
  );
}

export function NavigationSvg({ size = 14 }: SizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke={TEXT_COLOR} />
      <circle cx="7" cy="8" r="1" fill={TEXT_COLOR} />
      <circle cx="10" cy="8" r="1" fill={TEXT_COLOR} />
      <rect x="5" y="10" width="14" height="7" fill={SURFACE_COLOR} stroke={SURFACE_COLOR} />
    </svg>
  );
}

export function ViewportSvg({ size = 14 }: SizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="4" width="16" height="16" rx="2" stroke={TEXT_COLOR} />
      <rect x="17" y="6" width="2" height="12" rx="1" fill={SCROLLBAR_TRACK} />
      <rect x="17" y="9" width="2" height="4" rx="1" fill={TEXT_COLOR} />
    </svg>
  );
}

/** Picture frame — the portrait page */
export function FrameSvg({ size = 14 }: SizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="4" y="3" width="16" height="18" rx="1.5" stroke="currentColor" />
      <rect x="7" y="6" width="10" height="12" rx="1" stroke="currentColor" />
      <path d="M8 16.5 11 12l2 2.5 1.5-2 1.5 4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Footprints along a path — the walking record */
export function PathSvg({ size = 14 }: SizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="8" cy="18.5" rx="2.3" ry="3" fill="currentColor" transform="rotate(-14 8 18.5)" />
      <ellipse cx="15.5" cy="14" rx="2.3" ry="3" fill="currentColor" transform="rotate(10 15.5 14)" />
      <ellipse cx="8.5" cy="9" rx="2.3" ry="3" fill="currentColor" transform="rotate(-14 8.5 9)" />
      <ellipse cx="16" cy="4.5" rx="2.3" ry="3" fill="currentColor" transform="rotate(10 16 4.5)" />
    </svg>
  );
}

/** Torn-edge paper scrap — collected scraps */
export function TornPaperSvg({ size = 14 }: SizeProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M5 5.5 8 4l3 1.5L14 4l3 1.5L19.5 4v15.5L17 18l-3 1.5L11 18l-3 1.5L5 18z"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      <path d="M8.5 9h7M8.5 12h4.5" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

/** Returns the collector icon for a given type, or null for unknown types */
export function CollectorIcon({ type, size = 14 }: { type: string; size?: number }) {
  if (type === "cursor") return <CursorSvg size={size} />;
  if (type === "keyboard") return <KeyboardSvg size={size} />;
  if (type === "navigation") return <NavigationSvg size={size} />;
  if (type === "viewport") return <ViewportSvg size={size} />;
  return null;
}
