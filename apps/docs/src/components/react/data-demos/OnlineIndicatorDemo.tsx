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
    defaultPresence: { color: DEFAULT_COLOR },
  },
  ({ everyone, me, setMyPresence }) => (
    <div className="ph-online-indicator">
      <div
        className="ph-online-indicator__row"
        aria-label={`${everyone.length} online`}
      >
        {everyone.map((person) => (
          <span
            key={person.pid}
            className={`ph-online-indicator__dot${person.isMe ? " is-me" : ""}`}
            style={{ background: person.presence?.color ?? person.color }}
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
            value={me.presence?.color ?? DEFAULT_COLOR}
            onChange={(event) => setMyPresence({ color: event.target.value })}
          />
        </label>
      </div>
    </div>
  ),
  { standalone: true },
);
