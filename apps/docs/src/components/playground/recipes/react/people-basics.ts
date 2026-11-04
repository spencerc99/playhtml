// ABOUTME: Provides the copy-paste React sources for the People page recipes.
// ABOUTME: Both read people with usePeople; names and colors are set on playhtml.people.me.
import { pageStatusCss, yourNameCss } from "../demo-shared";
import { appShell } from "./app-shell";

export const yourNameReactSource = `import { PlayProvider, playhtml, usePeople } from "@playhtml/react";

// <input type="color"> only takes hex, but default colors are hsl()
function toHex(color: string) {
  const context = document.createElement("canvas").getContext("2d")!;
  context.fillStyle = color;
  return context.fillStyle;
}

function YourNameAndColor() {
  // Re-renders when anyone joins, leaves, or changes their name or color.
  const { me } = usePeople();

  // Setting me.name or me.color saves it for your next visit and shows it
  // to everyone.
  return (
    <div>
      <p className="me">
        <span className="dot" style={{ background: me.color }} />
        <span>{me.name || "anonymous"}</span>
      </p>
      <label>
        name
        <input
          value={me.name ?? ""}
          placeholder="your name"
          onChange={(event) => (playhtml.people.me.name = event.target.value)}
        />
      </label>
      <label>
        color
        <input
          type="color"
          value={me.color ? toHex(me.color) : "#000000"}
          onChange={(event) => (playhtml.people.me.color = event.target.value)}
        />
      </label>
    </div>
  );
}

${appShell("YourNameAndColor", yourNameCss)}`;

export const pageStatusReactSource = `import { PlayProvider, usePeople } from "@playhtml/react";

const STATUSES = ["reading", "coding", "taking a break"];

function StatusBoard() {
  // Re-renders when someone joins, leaves, renames, or changes their status.
  const { everyone, me, setMyPresence } = usePeople("status");
  const mine = me.presence.status;

  return (
    <div>
      <div className="picker">
        {STATUSES.map((status) => (
          <button
            key={status}
            aria-pressed={mine === status}
            // Picking your current status again clears it (null removes the key).
            onClick={() => setMyPresence("status", mine === status ? null : status)}
          >
            {status}
          </button>
        ))}
      </div>
      <ul className="people">
        {everyone.map((person) => (
          <li key={person.pid}>
            <span className="dot" style={{ background: person.color }} />
            <span>
              {person.name ?? "anonymous"}
              {person.isMe ? " (you)" : ""}
            </span>
            <span className="status">{String(person.presence.status ?? "…")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

${appShell("StatusBoard", pageStatusCss)}`;
