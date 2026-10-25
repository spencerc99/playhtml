// ABOUTME: Provides the copy-paste React source for the online indicator recipe.
// ABOUTME: Reads every reader's live color from `users` and sets your own with setLive.
import { onlineIndicatorCss } from "../demo-shared";
import { appShell } from "./app-shell";

export const onlineIndicatorReactSource = `import { PlayProvider, withSharedState } from "@playhtml/react";

const DEFAULT_COLOR = "#4a6a3e";

// \`live\` is your value for this element. It never persists, and every
// reader's current value arrives in \`users\` next to their identity.
const OnlineIndicator = withSharedState(
  { id: "online", defaultData: {}, live: { color: DEFAULT_COLOR } },
  ({ live, setLive, users }) => (
    <div>
      <div className="dots">
        {users.map(({ user, live }) => (
          <span
            key={user.pid}
            className={user.isMe ? "dot me" : "dot"}
            style={{ background: live?.color ?? user.color }}
          />
        ))}
      </div>
      <p>
        {users.length} {users.length === 1 ? "person" : "people"} here
      </p>
      <label>
        your color
        <input
          type="color"
          value={live?.color ?? DEFAULT_COLOR}
          onChange={(event) => setLive({ color: event.target.value })}
        />
      </label>
    </div>
  ),
);

${appShell("OnlineIndicator", onlineIndicatorCss)}`;
