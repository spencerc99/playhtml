// ABOUTME: Displays the user's identity with name, cursor preview, palette, and site count
// ABOUTME: Shown in the main popup home view
import React from "react";
import { PlayerIdentity } from "../types";
import "./PlayerIdentityCard.scss";

interface PlayerIdentityCardProps {
  playerIdentity: PlayerIdentity;
  /** Compact inline mode: cursor icon + name only, for header row */
  compact?: boolean;
}

// SVG cursor path rendered in the player's primary color
function CursorPreview({ color }: { color: string }) {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
      <path
        d="m12 24.4219v-16.015l11.591 11.619h-6.781l-.411.124z"
        fill={color}
      />
      <path
        d="m21.0845 25.0962-3.605 1.535-4.682-11.089 3.686-1.553z"
        fill={color}
      />
    </svg>
  );
}

export function PlayerIdentityCard({ playerIdentity, compact = false }: PlayerIdentityCardProps) {
  const primaryColor = playerIdentity.playerStyle.colorPalette[0] ?? "#4a9a8a";
  const displayName = playerIdentity.name?.trim() || "Anonymous";
  const siteCount = playerIdentity.discoveredSites?.length ?? 0;

  if (compact) {
    return (
      <div className="identity-card identity-card--compact">
        <CursorPreview color={primaryColor} />
        <span className="identity-card__name">{displayName}</span>
      </div>
    );
  }

  return (
    <div className="identity-card">
      <div className="identity-card__cursor">
        <CursorPreview color={primaryColor} />
      </div>
      <div className="identity-card__info">
        <div className="identity-card__name">{displayName}</div>
        <div className="identity-card__meta">
          {siteCount > 0 && (
            <span className="identity-card__site-count">
              {siteCount} {siteCount === 1 ? "site" : "sites"}
            </span>
          )}
          <div className="identity-card__palette">
            {playerIdentity.playerStyle.colorPalette.map((color, i) => (
              <div
                key={i}
                className="identity-card__swatch"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
