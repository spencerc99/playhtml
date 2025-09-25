import React from "react";
import { usePlayContext } from "@playhtml/react";
import { ViewCount } from "./ViewCount";
import { formatLargeNumber } from "./utils";
import "./DataModes.scss";

// Awareness Data Mode - Current online users
function AwarenessIndicator() {
  const { cursors } = usePlayContext();
  const currentUsers = cursors.allColors.length;

  // Limit displayed dots to prevent overcrowding
  const maxDotsToShow = 12;
  const visibleColors = cursors.allColors.slice(0, maxDotsToShow);
  const hiddenCount = Math.max(0, currentUsers - maxDotsToShow);

  const formatted = formatLargeNumber(currentUsers);
  const isLargeNumber = typeof formatted === "object";

  return (
    <div className="data-mode-demo awareness">
      {/* Show colored dots for each user */}
      <div className="user-dots">
        {visibleColors.map((color, index) => (
          <div
            key={`${color}-${index}`}
            className="user-dot"
            style={{
              backgroundColor: color,
              animationDelay: `${index * 0.1}s`,
            }}
            title={index === 0 ? "you" : `user ${index + 1}`}
          />
        ))}
        {hiddenCount > 0 && (
          <div
            className="user-dot-overflow"
            title={`+${hiddenCount} more users`}
          >
            +{hiddenCount}
          </div>
        )}
      </div>
      <div className="mode-value">
        {isLargeNumber ? (
          <div className="large-number-display">
            <div className="number-main">{formatted.main}</div>
            <div className="number-suffix">{formatted.suffix}</div>
          </div>
        ) : (
          formatted
        )}
      </div>
      <div className="mode-description">online now</div>
    </div>
  );
}

export function DataModes() {
  return (
    <div className="data-modes-container">
      <AwarenessIndicator />
      <div className="data-mode-demo persistent">
        <ViewCount />
        <div className="mode-description">total visits</div>
      </div>
    </div>
  );
}
