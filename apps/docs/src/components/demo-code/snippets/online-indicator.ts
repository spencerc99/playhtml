// ABOUTME: Copyable source for the online indicator: one colored dot per reader on the page.
// ABOUTME: Each reader's color is live per-user state, so it clears when they leave.
import { indent } from "../indent";
import type { DemoSnippet } from "../types";

const css = `.dots {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.dot {
  width: 42px;
  height: 42px;
  border: 1.5px solid #1c1c1c;
  border-radius: 50%;
}
/* Your own dot glows. */
.dot.me {
  box-shadow: 0 0 0 3px white, 0 0 0 5px #1c1c1c,
    0 0 22px 6px rgba(245, 169, 15, 0.7);
}`;

export const onlineIndicatorSnippet: DemoSnippet = {
  html: `<div id="online">
  <div class="dots"></div>
  <p class="count"></p>
</div>
<label>
  your color
  <input id="my-color" type="color" value="#4a6a3e" />
</label>

<style>
${indent(css)}
</style>

<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml@latest";

  // \`live\` is your value for this element. It never persists, and every
  // reader's current value arrives in \`users\` next to their identity.
  const online = playhtml.register("online", {
    live: { color: "#4a6a3e" },
    update: ({ element, users }) => {
      element.querySelector(".dots").replaceChildren(
        ...users.map(({ user, live }) => {
          const dot = document.createElement("span");
          dot.className = user.isMe ? "dot me" : "dot";
          dot.style.background = live.color;
          return dot;
        }),
      );
      const people = users.length === 1 ? "person" : "people";
      element.querySelector(".count").textContent =
        \`\${users.length} \${people} here\`;
    },
  });

  document.getElementById("my-color").addEventListener("input", (event) => {
    online.setLive({ color: event.target.value });
  });

  playhtml.init();
</script>`,
  react: `import { withSharedState } from "@playhtml/react";

// \`live\` is your value for this element. It never persists, and every
// reader's current value arrives in \`users\` next to their identity.
export const OnlineIndicator = withSharedState(
  { id: "online", defaultData: {}, live: { color: "#4a6a3e" } },
  ({ live, setLive, users }) => (
    <div>
      <div className="dots">
        {users.map(({ user, live }) => (
          <span
            key={user.pid}
            className={user.isMe ? "dot me" : "dot"}
            style={{ background: live.color }}
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
          value={live.color}
          onChange={(event) => setLive({ color: event.target.value })}
        />
      </label>
    </div>
  ),
);`,
  reactCss: css,
};
