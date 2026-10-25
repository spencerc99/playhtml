// ABOUTME: Provides the copy-paste React source for the online indicator recipe.
// ABOUTME: Reads every reader's color from `everyone` and sets your own with setMyPresence.
import { onlineIndicatorCss } from "../demo-shared";
import { appShell } from "./app-shell";

export const onlineIndicatorReactSource = `import { PlayProvider, withSharedState } from "@playhtml/react";

const DEFAULT_COLOR = "#4a6a3e";

// \`presence\` is your value for this element. It never persists, and every
// reader's current value arrives in \`everyone\` next to their identity.
const OnlineIndicator = withSharedState(
  { id: "online", defaultData: {}, presence: { color: DEFAULT_COLOR } },
  ({ myPresence, setMyPresence, everyone }) => (
    <div>
      <div className="dots">
        {everyone.map(({ user, presence }) => (
          <span
            key={user.pid}
            className={user.isMe ? "dot me" : "dot"}
            style={{ background: presence?.color ?? user.color }}
          />
        ))}
      </div>
      <p>
        {everyone.length} {everyone.length === 1 ? "person" : "people"} here
      </p>
      <label>
        your color
        <input
          type="color"
          value={myPresence?.color ?? DEFAULT_COLOR}
          onChange={(event) => setMyPresence({ color: event.target.value })}
        />
      </label>
    </div>
  ),
);

${appShell("OnlineIndicator", onlineIndicatorCss)}`;
