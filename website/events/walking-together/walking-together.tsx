import ReactDOM from "react-dom";
import React, { useState } from "react";
import { PlayProvider, withSharedState, usePlayerIdentity } from "@playhtml/react";
import { useStickyState } from "../../hooks/useStickyState";
import { resolveSessionId, sessionRoom, findSession } from "./sessions";
import { isAdmin } from "./admin";
import { PortraitOverlay } from "./PortraitOverlay";
import "./walking-together.scss";

interface CursorParty {
  color: string;
  count: number;
  name: string;
  setColor(color: string): void;
  setName(name: string): void;
}

declare global {
  interface Window {
    cursors?: CursorParty;
  }
}

interface SharedURL {
  url: string;
  userName: string;
  userColor: string;
  timestamp: number;
}

interface RosterEntry {
  pid: string;
  name: string;
  color: string;
}

const SESSION_ID = resolveSessionId(window.location.search);
const SESSION = findSession(SESSION_ID);
const IS_ARCHIVED = SESSION?.archived ?? false;

// Shared roster store id. Both the Roster writer and the AdminPanel reader
// target this same id so they share one Y.Map (the WordControls pattern in
// website/fridge.tsx: config-level `id` makes a durable named singleton).
const ROSTER_ID = "walking-together-roster";

const CURSOR_INSTRUCTIONS = [
  "Make a circle together",
  "Play tag with each other",
  "Stack all cursors in the center",
  "Make a zigzag together",
  "Coordinate by colors",
  "Split into your preferred corner",
  "Imagine your cursor as a falling rain drop",
];

// URL validation helper
function isValidUrl(url: string) {
  try {
    new URL(url);
    return url.startsWith("http://") || url.startsWith("https://");
  } catch {
    return false;
  }
}

export function UserSetup() {
  const { color: identityColor } = usePlayerIdentity();

  const [name, setName] = useStickyState<string | null>("username", null, (newName) => {
    window.cursors?.setName(newName ?? "");
  });

  // Color is seeded from playhtml identity (which the extension may inject) but
  // remains overridable via the picker.
  const [color, setInternalColor] = useState<string>(
    JSON.parse(localStorage.getItem("color") || "null") || identityColor || "#000000"
  );
  const setColor = (newColor: string) => {
    setInternalColor(newColor);
    window.cursors?.setColor(newColor);
  };

  // When the extension injects a color after mount, reflect it (unless the user
  // has already overridden via localStorage).
  React.useEffect(() => {
    const stored = JSON.parse(localStorage.getItem("color") || "null");
    if (!stored && identityColor && identityColor !== color) {
      setInternalColor(identityColor);
    }
  }, [identityColor]);

  return (
    <div className="user-setup">
      <input
        type="text"
        value={name ?? ""}
        onChange={(e) => setName(e.target.value)}
        placeholder="Enter your name"
      />
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* show a live cursor */}
        <img
          style={{
            width: "24px",
            height: "24px",
          }}
          src={`data:image/svg+xml,%3Csvg version='1.1' id='Layer_1' xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' x='0px' y='0px' viewBox='0 0 28 28' enable-background='new 0 0 28 28' xml:space='preserve'%3E%3Cpolygon fill='${encodeURIComponent(
            color
          )}' points='8.2,20.9 8.2,4.9 19.8,16.5 13,16.5 12.6,16.6 '/%3E%3Cpolygon fill='${encodeURIComponent(
            color
          )}' points='17.3,21.6 13.7,23.1 9,12 12.7,10.5 '/%3E%3Crect x='12.5' y='13.6' transform='matrix(0.9221 -0.3871 0.3871 0.9221 -5.7605 6.5909)' fill='${encodeURIComponent(
            color
          )}' width='2' height='8'/%3E%3Cpolygon fill='${encodeURIComponent(
            color
          )}' points='9.2,7.3 9.2,18.5 12.2,15.6 12.6,15.5 17.4,15.5 '/%3E%3C/svg%3E`}
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          title="Choose your cursor color"
        />
      </div>
    </div>
  );
}

/** Records the local participant into the shared session roster (keyed by PID).
 * Only extension users have a PID; everyone else simply isn't in the roster. */
const Roster = withSharedState(
  { id: ROSTER_ID, defaultData: { entries: [] as RosterEntry[] } },
  ({ data, setData }) => {
    const { pid, name, color } = usePlayerIdentity();

    React.useEffect(() => {
      if (!pid) return;
      const existing = data.entries.find((e) => e.pid === pid);
      const nextName = name ?? "Anonymous";
      const nextColor = color ?? "#000000";
      if (existing && existing.name === nextName && existing.color === nextColor) return;
      const others = data.entries.filter((e) => e.pid !== pid);
      setData({ entries: [...others, { pid, name: nextName, color: nextColor }] });
    }, [pid, name, color, data.entries]);

    return null;
  }
);

export const URLChat = withSharedState(
  {
    defaultData: { urls: [] as SharedURL[] },
  },
  ({ data, setData }) => {
    const [inputUrl, setInputUrl] = React.useState("");
    const urlListRef = React.useRef<HTMLDivElement>(null);

    // Scroll to top (since we're using column-reverse) when new URLs are added
    React.useEffect(() => {
      if (urlListRef.current) {
        urlListRef.current.scrollTop = 0;
      }
    }, [data.urls]);

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      if (!isValidUrl(inputUrl)) {
        alert("Please enter a valid URL starting with http:// or https://");
        return;
      }

      const newUrl: SharedURL = {
        url: inputUrl,
        userName: window.cursors?.name || "Anonymous",
        userColor: window.cursors?.color || "#000000",
        timestamp: Date.now(),
      };

      setData({ urls: [...data.urls, newUrl] });
      setInputUrl("");
    };

    const copyToClipboard = () => {
      const text = data.urls
        .map(({ userName, url }) => `${userName}: ${url}`)
        .join("\n");
      navigator.clipboard.writeText(text);
    };

    return (
      <div className="url-chat" id="url-chat">
        <div
          style={{
            position: "absolute",
            right: 0,
          }}
        >
          {data.urls.length > 0 && (
            <button
              style={{
                fontSize: "10px",
                fontFamily: "monospace",
              }}
              onClick={copyToClipboard}
            >
              COPY
            </button>
          )}
        </div>
        <div className="url-list" ref={urlListRef}>
          {[...data.urls].reverse().map((urlData, i) => (
            <div key={i} className="url-entry">
              <span className="timestamp">
                {new Date(urlData.timestamp).toLocaleTimeString()}
              </span>
              <span className="username" style={{ color: urlData.userColor }}>
                {urlData.userName}:
              </span>
              <a href={urlData.url} target="_blank" rel="noopener noreferrer">
                {urlData.url}
              </a>
            </div>
          ))}
        </div>
        {!IS_ARCHIVED && (
          <form onSubmit={handleSubmit}>
            <input
              type="url"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="Share a URL"
            />
            <button type="submit">Share</button>
          </form>
        )}
      </div>
    );
  }
);

export const GroupActivityDisplay = withSharedState(
  {
    defaultData: {
      currentInstructionIndex: 0,
      lastChangeTime: Date.now(),
    },
  },
  ({ data, setData }) => {
    const [timeLeft, setTimeLeft] = React.useState(30); // 30 seconds
    const { name, color } = usePlayerIdentity();

    React.useEffect(() => {
      const interval = setInterval(() => {
        const now = Date.now();
        const elapsed = Math.floor((now - data.lastChangeTime) / 1000);
        const remaining = 30 - elapsed;

        if (remaining <= 0) {
          // Archived sessions don't advance the activity — the timer just
          // resets visually so the page still feels alive.
          if (!IS_ARCHIVED) {
            setData({
              currentInstructionIndex:
                (data.currentInstructionIndex + 1) % CURSOR_INSTRUCTIONS.length,
              lastChangeTime: now,
            });
          }
          setTimeLeft(30);
        } else {
          setTimeLeft(remaining);
        }
      }, 1000);

      return () => clearInterval(interval);
    }, [data.lastChangeTime, data.currentInstructionIndex, setData]);

    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;

    const handleSkip = () => {
      setData({
        currentInstructionIndex:
          (data.currentInstructionIndex + 1) % CURSOR_INSTRUCTIONS.length,
        lastChangeTime: Date.now(),
      });
      setTimeLeft(30);
    };

    return (
      <div className="group-activity" id="group-activity">
        <h3>Current Activity:</h3>
        <p className="instruction">
          {CURSOR_INSTRUCTIONS[data.currentInstructionIndex]}
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1em",
            justifyContent: "center",
          }}
        >
          <p className="countdown">
            {minutes}:{seconds.toString().padStart(2, "0")}
          </p>
        </div>
        {!IS_ARCHIVED && isAdmin(name, color) && (
          <button
            onClick={handleSkip}
            style={{
              fontSize: "10px",
              padding: "2px 4px",
              fontFamily: "monospace",
              opacity: 0.5,
              marginTop: "-.5em",
              position: "absolute",
              transform: "translateX(-50%)",
            }}
          >
            SKIP
          </button>
        )}
      </div>
    );
  }
);

/** Admin-only panel: reads the roster and opens the portrait overlay. */
const AdminPanel = withSharedState(
  { id: ROSTER_ID, defaultData: { entries: [] as RosterEntry[] } },
  ({ data }) => {
    const { name, color } = usePlayerIdentity();
    const [showPortrait, setShowPortrait] = useState(false);

    if (!isAdmin(name, color)) return null;

    const pids = data.entries.map((e) => e.pid);

    return (
      <div className="admin-panel">
        <button onClick={() => setShowPortrait(true)} disabled={pids.length === 0}>
          Show portrait ({pids.length})
        </button>
        {showPortrait && (
          <PortraitOverlay pids={pids} onClose={() => setShowPortrait(false)} />
        )}
      </div>
    );
  }
);

function Main() {
  return (
    <PlayProvider
      initOptions={{ room: sessionRoom(SESSION_ID), cursors: { enabled: true } }}
    >
      <div className="walking-together">
        <UserSetup />
        <Roster />
        <URLChat />
        <GroupActivityDisplay />
        <AdminPanel />
      </div>
    </PlayProvider>
  );
}

ReactDOM.render(<Main />, document.getElementById("react"));
