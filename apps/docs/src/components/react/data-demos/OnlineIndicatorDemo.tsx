import React from "react";
import { withSharedState } from "@playhtml/react";

// Docs wrapper around packages/react/examples/OnlineIndicator. We don't just
// import the original because it hard-codes id="online-indicator" which would
// collide if the marketing site's indicator ever shares a room with the docs.
// Giving this one its own id keeps docs / homepage presence orthogonal.

const DEFAULT_COLOR = "#4a6a3e"; // sage-deep palette tone; matches docs chrome

export const OnlineIndicatorDemo = withSharedState<
  Record<string, never>,
  string,
  Record<string, never>
>(
  {
    defaultData: {},
    presence: DEFAULT_COLOR,
    id: "docs-presence-indicator",
  },
  ({ myPresence, everyone, setPresence }) => {
    const count = everyone.length;

    return (
      <div className="ph-online-indicator">
        <div className="ph-online-indicator__row" aria-label={`${count} online`}>
          {everyone.map(({ user, presence }) => (
            <span
              key={user.pid}
              className={`ph-online-indicator__dot${user.isMe ? " is-me" : ""}`}
              style={{ background: presence }}
              aria-hidden="true"
            />
          ))}
        </div>
        <div className="ph-online-indicator__meta">
          <span className="ph-online-indicator__count">
            {count} {count === 1 ? "person" : "people"} here
          </span>
          <label className="ph-online-indicator__swatch">
            <span>your color</span>
            <input
              type="color"
              value={myPresence ?? DEFAULT_COLOR}
              onChange={(e) => setPresence(e.target.value)}
            />
          </label>
        </div>
      </div>
    );
  },
);
