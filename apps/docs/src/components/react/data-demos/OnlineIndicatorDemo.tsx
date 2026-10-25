// Docs live demo for presence: one colored dot per reader, yours glowing.
// The code readers copy lives in playground/recipes/online-indicator.ts.
import React from "react";
import { withSharedState } from "@playhtml/react";

const DEFAULT_COLOR = "#4a6a3e"; // sage-deep, matches the docs chrome

// Its own id so the docs indicator never shares state with the homepage one.
export const OnlineIndicatorDemo = withSharedState(
  {
    id: "docs-presence-indicator",
    defaultData: {},
    presence: { color: DEFAULT_COLOR },
  },
  ({ myPresence, setMyPresence, everyone }) => (
    <div className="ph-online-indicator">
      <div
        className="ph-online-indicator__row"
        aria-label={`${everyone.length} online`}
      >
        {everyone.map(({ user, presence }) => (
          <span
            key={user.pid}
            className={`ph-online-indicator__dot${user.isMe ? " is-me" : ""}`}
            style={{ background: presence?.color ?? user.color }}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className="ph-online-indicator__meta">
        <span className="ph-online-indicator__count">
          {everyone.length} {everyone.length === 1 ? "person" : "people"} here
        </span>
        <label className="ph-online-indicator__swatch">
          <span>your color</span>
          <input
            type="color"
            value={myPresence?.color ?? DEFAULT_COLOR}
            onChange={(event) => setMyPresence({ color: event.target.value })}
          />
        </label>
      </div>
    </div>
  ),
  { standalone: true },
);
