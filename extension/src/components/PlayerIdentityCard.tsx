// ABOUTME: Displays the user's identity with name, cursor preview, palette, and site count
// ABOUTME: Shown in the main popup home view
import React from "react";
import { PlayerIdentity } from "../types";
import { CursorSvg } from "./icons";
import "./PlayerIdentityCard.scss";

interface PlayerIdentityCardProps {
  playerIdentity: PlayerIdentity;
  /** Compact inline mode: cursor icon only in bordered box, for header row */
  compact?: boolean;
  onClick?: () => void;
}

export function PlayerIdentityCard({ playerIdentity, compact = false, onClick }: PlayerIdentityCardProps) {
  const primaryColor = playerIdentity.playerStyle.colorPalette[0] ?? "#4a9a8a";
  const displayName = playerIdentity.name?.trim() || "Anonymous";
  const siteCount = playerIdentity.discoveredSites?.length ?? 0;

  if (compact) {
    return (
      <button
        type="button"
        className="identity-card identity-card--compact"
        onClick={onClick}
        title="Profile settings"
      >
        <div className="identity-card__cursor">
          <CursorSvg size={28} color={primaryColor} />
        </div>
      </button>
    );
  }

  return (
    <div className="identity-card">
      <div className="identity-card__cursor">
        <CursorSvg size={28} color={primaryColor} />
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
