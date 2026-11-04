// ABOUTME: Provides the copy-paste React source for the online indicator recipe.
// ABOUTME: Reads every reader's color from `everyone` and sets yours with setMyPresence.
import { onlineIndicatorCss } from "../demo-shared";
import { appShell } from "./app-shell";

export const onlineIndicatorReactSource = `import { PlayProvider, withSharedState } from "@playhtml/react";

const DEFAULT_COLOR = "#4a6a3e";

// Each person here has a presence on this element: a value everyone can
// see, gone when they leave. Yours starts at \`defaultPresence\`, and
// \`everyone\` lists each person (name, color, isMe) with theirs.
const OnlineIndicator = withSharedState(
  { id: "online", defaultData: {}, defaultPresence: { color: DEFAULT_COLOR } },
  ({ everyone, me, setMyPresence }) => (
    <div>
      <div className="dots">
        {everyone.map((person) => (
          <span
            key={person.pid}
            className={person.isMe ? "dot me" : "dot"}
            style={{ background: person.presence.color }}
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
          value={me.presence.color}
          onChange={(event) => setMyPresence({ color: event.target.value })}
        />
      </label>
    </div>
  ),
);

${appShell("OnlineIndicator", onlineIndicatorCss)}`;
