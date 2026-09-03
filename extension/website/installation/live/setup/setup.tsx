// ABOUTME: Generates and operates the field and follower links for a live installation.
// ABOUTME: Keeps the screen count explicit while participant assignment remains automatic.

import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { buildLiveInstallationScreens } from "../../../shared/utils/installationUrls";

const buttonStyle: React.CSSProperties = {
  border: "1px solid rgba(61, 56, 51, 0.2)",
  borderRadius: 4,
  padding: "6px 10px",
  background: "#fdfcf9",
  color: "#3d3833",
  cursor: "pointer",
};

const LiveInstallationSetup = () => {
  const [followerCount, setFollowerCount] = useState(4);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const screens = useMemo(
    () => buildLiveInstallationScreens(window.location.origin, followerCount),
    [followerCount],
  );

  const copy = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    window.setTimeout(
      () => setCopiedUrl((current) => (current === url ? null : current)),
      1500,
    );
  };

  return (
    <main
      style={{
        width: "min(920px, calc(100% - 40px))",
        margin: "0 auto",
        padding: "56px 0",
        fontFamily: "'Source Serif 4', Georgia, serif",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 38, fontStyle: "italic", fontWeight: 300 }}>
        live installation setup
      </h1>
      <p style={{ maxWidth: 620, color: "#726b64", lineHeight: 1.5 }}>
        Open the field on the main screen and one numbered follower on each close-up
        screen. Each follower owns a different set of people automatically.
      </p>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "28px 0 18px",
          fontFamily: "'Martian Mono', monospace",
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        <span>Follower screens</span>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => setFollowerCount((count) => Math.max(1, count - 1))}
          aria-label="Remove one follower screen"
        >
          −
        </button>
        <strong style={{ minWidth: 20, textAlign: "center" }}>{followerCount}</strong>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => setFollowerCount((count) => Math.min(32, count + 1))}
          aria-label="Add one follower screen"
        >
          +
        </button>
        <button
          type="button"
          style={{ ...buttonStyle, marginLeft: "auto" }}
          onClick={() => screens.forEach((screen) => window.open(screen.url, "_blank"))}
        >
          open all
        </button>
      </div>

      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {screens.map((screen) => (
          <li
            key={screen.label}
            style={{
              display: "grid",
              gridTemplateColumns: "110px minmax(0, 1fr) auto auto",
              alignItems: "center",
              gap: 10,
              padding: "10px 0",
              borderTop: "1px solid rgba(61, 56, 51, 0.1)",
            }}
          >
            <span
              style={{
                fontFamily: "'Martian Mono', monospace",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: screen.role === "master" ? "#c4724e" : "#4a9a8a",
              }}
            >
              {screen.label}
            </span>
            <code
              title={screen.url}
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                padding: "7px 9px",
                borderRadius: 4,
                background: "#f5f0e8",
                color: "#5b8db8",
              }}
            >
              {screen.url}
            </code>
            <button type="button" style={buttonStyle} onClick={() => copy(screen.url)}>
              {copiedUrl === screen.url ? "copied" : "copy"}
            </button>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => window.open(screen.url, "_blank", "noopener")}
            >
              open
            </button>
          </li>
        ))}
      </ol>
    </main>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<LiveInstallationSetup />);
