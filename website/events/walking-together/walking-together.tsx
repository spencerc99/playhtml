import ReactDOM from "react-dom";
import React, { useState } from "react";
import {
  PlayProvider,
  withSharedState,
  usePlayerIdentity,
} from "@playhtml/react";
import { useStickyState } from "../../hooks/useStickyState";
import {
  resolveSession,
  roomForSession,
  type SubtitleSegment,
  type WorkshopSession,
} from "./sessions";
import { isAdmin } from "./admin";
import { PortraitOverlay } from "./PortraitOverlay";
import {
  rosterPids,
  rosterEntryIsCurrent,
  type Roster,
  type RosterEntry,
} from "./roster";
import "./walking-together.scss";

// playhtml exposes `window.cursors` with `name`/`color` as settable
// properties (getters + setters), not setName/setColor methods. Assigning an
// empty string to `color` throws — we only ever assign a real picker value.
interface CursorParty {
  color: string;
  name: string | undefined;
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

// Resolve the session from ?session=<id>. An absent or unknown session sends
// the visitor back to the home list rather than silently joining some room.
const SESSION = resolveSession(window.location.search);
if (!SESSION) {
  window.location.replace("./index.html");
}
const IS_ARCHIVED = SESSION?.archived ?? false;

// Element id for the shared roster store. Set as an explicit `id` on the
// RosterAdmin element so the core library uses a stable id instead of hashing
// outerHTML (which varies per render and would break cross-client sync).
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

/** How long each group activity runs before advancing, in seconds. */
const ACTIVITY_DURATION_S = 30;

/** Whole seconds elapsed since a shared timestamp (ms). */
function elapsedSince(timestampMs: number): number {
  return Math.floor((Date.now() - timestampMs) / 1000);
}

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
  // Cursor color is owned by the extension (injected via playhtml identity).
  // The name stays a manual input.
  const [name, setName] = useStickyState<string | null>(
    "username",
    null,
    (newName) => {
      if (window.cursors) window.cursors.name = newName ?? "";
    },
  );

  return (
    <div className="user-setup">
      <input
        type="text"
        value={name ?? ""}
        onChange={(e) => setName(e.target.value)}
        placeholder="Enter your name"
      />
    </div>
  );
}

/** Owns the shared session roster and the admin portrait trigger in one store.
 *
 * Roster reads and writes live in a single withSharedState component (one
 * element id) so they share one Y.Map — two separate components can't share a
 * store, since the element id derives from the rendered child and can't be
 * duplicated across DOM nodes. The component:
 *  - upserts the local participant { pid, name, color } when a PID is present,
 *    keeping the roster keyed by unique pid (extension users only; others
 *    simply aren't in the roster), and
 *  - renders the admin "Show portrait" control to the admin only.
 *
 * The rendered element carries an explicit id so the core library uses a
 * stable element id rather than hashing outerHTML (which differs per render). */
const RosterAdmin = withSharedState(
  // The roster lives under `participants` as a keyed map. This is a fresh field
  // (NOT the original `entries`, which some rooms persisted as an array under
  // the first roster implementation). A fresh always-a-map field avoids the
  // array→map type conflict entirely: keyed writes are always clean, no
  // in-place migration needed. Any legacy `entries` array is simply abandoned.
  { defaultData: { participants: {} as Roster } },
  ({ data, setData }) => {
    const { pid, name, color } = usePlayerIdentity();
    const [showPortrait, setShowPortrait] = useState(false);

    // Read the latest roster through a ref so the upsert effect keys ONLY on
    // the local identity (pid/name/color), not on the shared map. Depending on
    // the shared map would re-run this on every change from any client.
    const rosterRef = React.useRef(data.participants);
    rosterRef.current = data.participants;

    React.useEffect(() => {
      if (!pid) return;
      const mine: RosterEntry = {
        pid,
        name: name ?? "Anonymous",
        color: color ?? "#000000",
      };
      // Skip a redundant write when our entry already matches.
      if (rosterEntryIsCurrent(rosterRef.current, mine)) return;
      // Keyed mutator write: assigning participants[pid] overwrites in place,
      // so this is idempotent and merge-safe — re-running it (or two clients
      // racing) can never duplicate.
      setData((draft) => {
        // A room persisted before this field existed (e.g. the legacy roster
        // used `entries`) has no `participants` — defaultData only seeds brand
        // new elements. Initialize it before keying in.
        if (!draft.participants) draft.participants = {};
        draft.participants[pid] = mine;
      });
    }, [pid, name, color, setData]);

    const admin = isAdmin(name, color);
    const pids = rosterPids(data.participants);

    return (
      <div className="admin-panel" id={ROSTER_ID}>
        {admin && (
          <>
            {/* Deliberately unlabeled icon button — discreet during screen
             * shares. Hover title still shows the participant count. */}
            <button
              className="portrait-trigger"
              onClick={() => setShowPortrait(true)}
              disabled={pids.length === 0}
              title={`Show portrait (${pids.length})`}
              aria-label={`Show portrait (${pids.length})`}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="3" width="16" height="18" rx="1" />
                <circle cx="12" cy="10" r="3" />
                <path d="M7 18c1.2-2.4 3-3.5 5-3.5s3.8 1.1 5 3.5" />
              </svg>
            </button>
            {showPortrait && (
              <PortraitOverlay
                pids={pids}
                onClose={() => setShowPortrait(false)}
              />
            )}
          </>
        )}
      </div>
    );
  },
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
  },
);

export const GroupActivityDisplay = withSharedState(
  {
    defaultData: {
      currentInstructionIndex: 0,
      lastChangeTime: Date.now(),
    },
  },
  ({ data, setData }) => {
    const { name, color } = usePlayerIdentity();
    const admin = isAdmin(name, color);

    // The countdown animates LOCALLY for everyone, derived from the shared
    // `lastChangeTime` — no per-tick writes. The shared state is the source of
    // truth (a new joiner reads it and animates from the same baseline). Only
    // ONE client (the admin) performs the advance write when the timer hits
    // zero, so clients can't race each other into skipping multiple activities.
    const [timeLeft, setTimeLeft] = React.useState(() =>
      Math.max(0, ACTIVITY_DURATION_S - elapsedSince(data.lastChangeTime)),
    );

    // Keep the latest shared state and identity in refs so the ticking effect
    // does NOT re-subscribe on every data change (which would stutter/restart
    // the countdown). It is set up once and reads current values per tick.
    const stateRef = React.useRef({ data, admin });
    stateRef.current = { data, admin };
    // The lastChangeTime we last advanced from. Prevents the admin from firing
    // the advance write repeatedly in the ~CRDT-round-trip window before the
    // new lastChangeTime propagates back into `data`.
    const advancedFromRef = React.useRef<number | null>(null);

    React.useEffect(() => {
      const tick = () => {
        const { data: d, admin: isAdminNow } = stateRef.current;
        const remaining = ACTIVITY_DURATION_S - elapsedSince(d.lastChangeTime);

        if (remaining > 0) {
          setTimeLeft(remaining);
          return;
        }

        // Timer expired. Show 0 locally for everyone; only the admin advances
        // the shared activity (archived sessions never advance).
        setTimeLeft(0);
        if (
          isAdminNow &&
          !IS_ARCHIVED &&
          advancedFromRef.current !== d.lastChangeTime
        ) {
          advancedFromRef.current = d.lastChangeTime;
          setData({
            currentInstructionIndex:
              (d.currentInstructionIndex + 1) % CURSOR_INSTRUCTIONS.length,
            lastChangeTime: Date.now(),
          });
        }
      };
      tick();
      const interval = setInterval(tick, 250);
      return () => clearInterval(interval);
      // Set up once — refs supply the latest values each tick.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [setData]);

    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;

    const handleSkip = () => {
      setData({
        currentInstructionIndex:
          (data.currentInstructionIndex + 1) % CURSOR_INSTRUCTIONS.length,
        lastChangeTime: Date.now(),
      });
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
  },
);

function Main({ session }: { session: WorkshopSession }) {
  return (
    <PlayProvider
      initOptions={{
        room: roomForSession(session),
        cursors: { enabled: true, coordinateMode: "relative" },
      }}
    >
      <div className="walking-together">
        <UserSetup />
        <URLChat />
        <GroupActivityDisplay />
        <RosterAdmin />
      </div>
    </PlayProvider>
  );
}

/** Renders a session's configurable credits line. Plain segments are text;
 * object segments render as links. */
function SessionSubtitle({ segments }: { segments: SubtitleSegment[] }) {
  return (
    <>
      {segments.map((seg, i) =>
        typeof seg === "string" ? (
          <React.Fragment key={i}>{seg}</React.Fragment>
        ) : (
          <a key={i} href={seg.href}>
            {seg.text}
          </a>
        ),
      )}
    </>
  );
}

// Only mount when a valid session resolved; otherwise the redirect above is
// already navigating away.
if (SESSION) {
  ReactDOM.render(<Main session={SESSION} />, document.getElementById("react"));

  const subtitleRoot = document.getElementById("session-subtitle");
  if (subtitleRoot) {
    ReactDOM.render(
      <SessionSubtitle segments={SESSION.subtitle} />,
      subtitleRoot,
    );
  }
}
