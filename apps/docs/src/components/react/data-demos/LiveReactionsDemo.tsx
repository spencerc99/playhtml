import React from "react";
import { LiveReactions } from "../../../../../../packages/react/examples/LiveReactions";

/** Docs chrome wrapper — behavior lives in `packages/react/examples/LiveReactions`. */
export function LiveReactionsDemo(): React.ReactElement {
  return (
    <LiveReactions
      eventType="docs-live-reaction"
      emoji="❤️"
      emojiOptions={["❤️", "✨", "🔥", "🎉"]}
      className="ph-live-reactions-root"
    />
  );
}
