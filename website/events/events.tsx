import { withSharedState } from "@playhtml/react";
import randomColor from "randomcolor";
import React, { useEffect } from "react";
import "./events.scss";

const NumCursors = 50;

export function Cursors() {
  return (
    <div>
      {Array.from({ length: NumCursors }).map((_, i) => {
        const distanceX =
          Math.random() * 400 + 200 * (Math.random() > 0.5 ? 1 : -1);
        const distanceY =
          Math.random() * 400 + 200 * (Math.random() > 0.5 ? 1 : -1);
        // scale duration with distance
        const duration = Math.sqrt(distanceX ** 2 + distanceY ** 2) * 0.03;
        const color = randomColor({
          luminosity: "bright",
          format: "hsla",
          alpha: 0.8,
        });
        return (
          <img
            key={i}
            className="cursor"
            style={{
              "--bg-color": color,
              "--starting-x": `${Math.random() * 100}vw`,
              "--starting-y": `${Math.random() * 100}vh`,
              "--distance-x": `${distanceX}px`,
              "--distance-y": `${distanceY}px`,
              "--duration": `${duration}s`,
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
        );
      })}
    </div>
  );
}

export const Timer = withSharedState(
  {
    defaultData: { time: 0, isRunning: false },
  },
  ({ data, setData }) => {
    const { time, isRunning } = data;

    useEffect(() => {
      let interval;
      if (isRunning) {
        interval = setInterval(() => {
          setData({ time: time + 1, isRunning });
        }, 1000);
      } else if (!isRunning && time !== 0) {
        clearInterval(interval);
      }
      return () => clearInterval(interval);
    }, [isRunning, time, setData]);

    const handleStartPause = () => {
      setData({ time, isRunning: !isRunning });
    };

    const handleReset = () => {
      setData({ time: 0, isRunning: false });
    };

    const formatTime = (time) => {
      const hours = String(Math.floor(time / 3600)).padStart(2, "0");
      const minutes = String(Math.floor((time % 3600) / 60)).padStart(2, "0");
      const seconds = String(time % 60).padStart(2, "0");
      return `${hours}:${minutes}:${seconds}`;
    };

    return (
      <div id="timer" className="retro-timer">
        <h2>{formatTime(time)}</h2>
        <div className="buttons">
          <button onClick={handleStartPause}>
            {isRunning ? "Pause" : "Start"}
          </button>
          <button onClick={handleReset}>Reset</button>
        </div>
      </div>
    );
  }
);

export function PlayhtmlToolBox() {
  return (
    <div id="playhtml-tools">
      <div
        id="timerWrapper"
        can-move=""
        style={{
          width: "fit-content",
          position: "absolute",
          right: 0,
        }}
      >
        <Timer />
        {/* <div id="scratchpad" style={{
          display: "flex",
          flexDirection: "column",
          gap: "1em",
        }}>

        </div> */}
      </div>
    </div>
  );
}

interface GuestbookEntry {
  name?: string;
  from?: string;
  color?: string;
  message: string;
  timestamp: number;
}

export const Guestbook = withSharedState(
  { defaultData: [] as GuestbookEntry[] },
  ({ data, setData }, { name, from }: { name?: string; from?: string }) => {
    const [message, setMessage] = React.useState("");

    const handleSubmit = () => {
      if (message.trim()) {
        setData([
          ...data,
          {
            name: name,
            from,
            color: window?.cursors?.color || undefined,
            message,
            timestamp: Date.now(),
          },
        ]);
        setMessage("");
      }
    };

    return (
      <div id="guestbook">
        <div
          className="guestbook-actions"
          style={{
            display: "flex",
            flexDirection: "column",
            marginBottom: "1em",
          }}
        >
          <span>
            <b
              style={{
                color: window?.cursors.color || "black",
              }}
            >
              {name || "Anonymous"}
            </b>
            {from ? ` (${from})` : ""} says...
          </span>
          <textarea
            maxLength={800}
            placeholder="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
          />
          <button type="submit" onClick={handleSubmit}>
            Send
          </button>
        </div>
        <hr />
        {data.reverse().map((entry, i) => (
          <div
            key={i}
            className="guestbook-entry"
            style={{
              display: "flex",
              flexDirection: "column",
              marginBottom: "1em",
              fontSize: "80%",
            }}
          >
            <div>
              <b
                style={{
                  color: entry.color || "black",
                }}
              >
                {entry.name || "Anonymous"}
              </b>{" "}
              {entry.from && `(from ${entry.from})`}
              <div
                style={{
                  float: "right",
                  fontSize: "50%",
                }}
              >
                {new Date(entry.timestamp).toLocaleString()}
              </div>
            </div>
            <div style={{}}>{entry.message}</div>
          </div>
        ))}
      </div>
    );
  }
);

interface SharedURL {
  url: string;
  userName: string;
  userColor: string;
  timestamp: number;
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
      <div className="url-chat">
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
        {data.urls.length > 0 && (
          <button onClick={copyToClipboard} style={{ marginTop: "0.5em" }}>
            Copy All URLs
          </button>
        )}
      </div>
    );
  }
);
