import ReactDOM from "react-dom";
import React, { useState } from "react";
import { PlayProvider, withSharedState } from "@playhtml/react";
import { useStickyState } from "../../hooks/useStickyState";
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

function shuffleArray<T>(array: T[]): T[] {
  return array.sort(() => Math.random() - 0.5);
}

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
  const [name, setName] = useStickyState<string | null>(
    "username",
    null,
    (newName) => {
      window.cursors?.setName(newName);
    }
  );

  const [color, setInternalColor] = useState(
    JSON.parse(localStorage.getItem("color") || "null") || window.cursors?.color
  );
  const setColor = (newColor: string) => {
    setInternalColor(newColor);
    window.cursors?.setColor(newColor);
  };

  const [cursorsLoaded, setCursorsLoaded] = React.useState(false);

  // Check for cursors availability
  React.useEffect(() => {
    const checkCursors = () => {
      if (window.cursors) {
        setCursorsLoaded(true);
      }
    };

    checkCursors();
    // Check every second for 10 seconds
    const interval = setInterval(checkCursors, 1000);
    const timeout = setTimeout(() => clearInterval(interval), 10000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [name, color]);

  if (!cursorsLoaded) {
    return <div>Loading cursor party...</div>;
  }

  return (
    <div className="user-setup">
      <input
        type="text"
        value={name}
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
        <form onSubmit={handleSubmit}>
          <input
            type="url"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            placeholder="Share a URL"
          />
          <button type="submit">Share</button>
        </form>
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

    React.useEffect(() => {
      const interval = setInterval(() => {
        const now = Date.now();
        const elapsed = Math.floor((now - data.lastChangeTime) / 1000);
        const remaining = 30 - elapsed;

        if (remaining <= 0) {
          // Update to next instruction
          setData({
            currentInstructionIndex:
              (data.currentInstructionIndex + 1) % CURSOR_INSTRUCTIONS.length,
            lastChangeTime: now,
          });
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

    const isAdmin =
      window.cursors?.name === "Kristoffer" ||
      window.cursors?.name === "spencer";

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
        {isAdmin && (
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

function Main() {
  return (
    <PlayProvider>
      <div className="walking-together">
        <UserSetup />
        <URLChat />
        <GroupActivityDisplay />
      </div>
    </PlayProvider>
  );
}

ReactDOM.render(<Main />, document.getElementById("react"));
