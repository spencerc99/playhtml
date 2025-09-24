import React from "react";
import { RainSprinkler } from "../../packages/react/examples/RainSprinkler";
import { ReactiveOrb } from "../../packages/react/examples/ReactiveOrb";
import { DataModes } from "../../packages/react/examples/DataModes";
import { ComponentStore } from "./ComponentStore";
import { ScheduledBehaviors } from "./ScheduledBehaviors";
import { Permissions } from "./Permissions";
import "./FeaturesGrid.scss";
import { withSharedState } from "@playhtml/react";
import { invertColor } from "../utils/color";
import { SharedLamp } from "../../packages/react/examples/SharedLamp";

interface ColorChange {
  color: string;
  timestamp: number;
}

interface ExperimentOneData {
  colors: ColorChange[];
}

// Component to fetch shared color data and make it available to parent
const SharedColorProvider = withSharedState<
  ExperimentOneData,
  undefined,
  { children: React.ReactNode }
>(
  {
    defaultData: { colors: [] as ColorChange[] },
    dataSource: "localhost:5173/experiments/one/#main", // Links to the same data source as experiments/one
  },
  ({ data }, { children }) => {
    // Get the latest color, fallback to white
    const latestColor = data.colors[data.colors.length - 1]?.color || "#ffffff";

    // Pass the color data to children via React.cloneElement and ensure a DOM wrapper
    // so playhtml can attach `can-play` and `data-source` attributes.
    return (
      <div>
        {React.cloneElement(children as React.ReactElement, {
          sharedColor: latestColor,
        })}
      </div>
    );
  }
);

// Portal window to personal website
function PersonalSitePortal() {
  return (
    <div className="portal-window">
      <div className="portal-header">
        <div className="portal-controls">
          <div className="control-dot red"></div>
          <div className="control-dot yellow"></div>
          <div className="control-dot green"></div>
        </div>
        <div className="portal-url">
          🌐 <a href="https://spencer.place">spencer.place</a>
        </div>
      </div>
      <div className="portal-content">
        <SharedLamp
          dataSource="localhost:4321#lamp-akari"
          src="/lamps/Akari-1N.png"
          id="lamp-akari"
        />
      </div>
    </div>
  );
}

export function SharedElements() {
  return (
    <div className="shared-elements-container">
      <PersonalSitePortal />
    </div>
  );
}

// Default feature card component
const FeatureCard = ({
  title,
  description,
  comingSoon = false,
  children,
  sharedColor,
}: {
  title: string;
  description?: string;
  comingSoon?: boolean;
  children?: React.ReactNode;
  sharedColor?: string;
}) => {
  const cardStyle = sharedColor
    ? {
        backgroundColor: `${sharedColor}90`,
        position: "relative" as const,
        color: `${invertColor(sharedColor, true)}`,
      }
    : {};

  return (
    <div
      className={`feature-card ${comingSoon ? "coming-soon" : ""}`}
      style={cardStyle}
    >
      {sharedColor && (
        <>
          {/* Sync indicator in corner */}
          <div className="sync-indicator">
            color from{" "}
            <a href="/experiments/one/" style={{ color: "inherit" }}>
              experiments/one
            </a>
          </div>
        </>
      )}
      <div className="card-content">
        <h3>
          {title}{" "}
          {comingSoon && <span className="coming-soon-badge">coming soon</span>}
        </h3>
        {description && <p>{description}</p>}
      </div>
      <div className="interactive-elements">{children}</div>
    </div>
  );
};

function highlightElements(capability) {
  document.querySelectorAll(`[${capability}]`).forEach((ele) => {
    ele.classList.add("highlighted");
  });
}

function unhighlightElements(capability) {
  document.querySelectorAll(`[${capability}]`).forEach((ele) => {
    ele.classList.remove("highlighted");
  });
}

// Rain and orb components moved to examples package

export default function FeaturesGrid() {
  return (
    <section className="features-section">
      <h2>features</h2>
      <div className="features-grid">
        {/* Reactive Data - Implemented */}
        <div className="feature-card-wrapper">
          <FeatureCard
            title="Reactive Data"
            description="Live, persistent state per-element"
          >
            <pre
              style={{
                margin: 0,
              }}
            >
              {`{
  defaultData: { clicks: 0 },
  onClick: () => {
    setData({ 
      clicks: data.clicks + 1 
    });
  },
}`}
            </pre>
            <p style={{ margin: 0 }}>
              see{" "}
              <a href="https://github.com/spencerc99/playhtml/blob/main/packages/react/examples/ReactiveOrb.tsx">
                example
              </a>
            </p>
            <ReactiveOrb className="orb-1" colorOffset={0} />
            <ReactiveOrb className="orb-2" colorOffset={120} />
            <ReactiveOrb className="orb-3" colorOffset={240} />
          </FeatureCard>
        </div>

        {/* Data Modes - Awareness vs Persistent */}
        <div className="feature-card-wrapper">
          <FeatureCard
            title="Flexible Persistence"
            description="Real-time presence and persistent data"
          >
            <DataModes />
            <p style={{ marginBottom: 0, marginTop: ".5em" }}>
              see{" "}
              <a href="https://github.com/spencerc99/playhtml/blob/main/packages/react/examples/DataModes.tsx">
                example
              </a>
            </p>
          </FeatureCard>
        </div>

        <div className="feature-card-wrapper">
          <FeatureCard
            title="plug-and-play capabilities"
            description="If you want to write the least code, you can use our available templated capabilities to create shared elements with a single attribute on HTML."
          >
            <ol className="capabilities" style={{ marginBottom: 0 }}>
              <li
                onMouseEnter={() => highlightElements("can-play")}
                onMouseLeave={() => unhighlightElements("can-play")}
              >
                can-play (custom capabilities{" "}
                <a href="https://github.com/spencerc99/playhtml#can-play">
                  with your code
                </a>
                !)
              </li>
              <li
                onMouseEnter={() => highlightElements("can-move")}
                onMouseLeave={() => unhighlightElements("can-move")}
              >
                can-move
                <img className="code" src="/playhtml-sign.png" />
              </li>
              <li
                onMouseEnter={() => highlightElements("can-toggle")}
                onMouseLeave={() => unhighlightElements("can-toggle")}
              >
                can-toggle{" "}
                <img className="code" src="/playhtml-can-toggle.png" />
              </li>
              <li>can-duplicate</li>
              <li
                onMouseEnter={() => highlightElements("can-spin")}
                onMouseLeave={() => unhighlightElements("can-spin")}
              >
                can-spin <img className="code" src="/playhtml-can-spin.png" />
              </li>
              <li
                onMouseEnter={() => highlightElements("can-grow")}
                onMouseLeave={() => unhighlightElements("can-grow")}
              >
                can-grow
              </li>
              <li>
                <a href="https://github.com/spencerc99/playhtml/pulls">
                  add-your-own!
                </a>
              </li>
            </ol>
          </FeatureCard>
        </div>

        {/* Custom Events */}
        <div className="feature-card-wrapper">
          <FeatureCard
            title="Custom Events"
            description="Trigger global events from anywhere"
          >
            <div
              className="rain-sprinkler-container"
              style={{
                position: "absolute",
                top: "-50px",
                right: "10px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <RainSprinkler
                style={{
                  height: "150px",
                  width: "100%",
                  backgroundImage: "url(/fire-hydrant.png)",
                  backgroundSize: "contain",
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "center",
                  cursor: "pointer",
                }}
              />
              <span style={{ fontSize: "0.8em" }}>click to make it rain!</span>
            </div>
            <p style={{ marginTop: "auto", marginBottom: 0 }}>
              see{" "}
              <a href="https://github.com/spencerc99/playhtml/blob/main/packages/react/examples/RainSprinkler.tsx">
                example
              </a>
            </p>
          </FeatureCard>
        </div>

        {/* Plug-and-Play ↔ Customization */}
        {/* <FeatureCard
          title="Flexible Architecture"
          description="From magical single attributes to full customization"
        >
          <div className="placeholder-visual">⚡ ⚙️</div>
        </FeatureCard> */}

        {/* Traveling elements? like a cat wandeirng around & traveling between pages */}

        {/* Cross-Page State Sharing */}
        <div className="feature-card-wrapper">
          <SharedColorProvider>
            <FeatureCard
              title="Shared Elements"
              description="Create interconnected website networks that share element state across pages and domains."
            >
              <SharedElements />
              <p style={{ marginBottom: 0, marginTop: ".5em" }}>
                see{" "}
                <a
                  style={{ color: "inherit" }}
                  href="https://github.com/spencerc99/playhtml/blob/main/packages/react/examples/SharedElements.tsx"
                >
                  example
                </a>
              </p>
            </FeatureCard>
          </SharedColorProvider>
        </div>

        {/* Web Components - Coming Soon */}
        <FeatureCard
          title="Component Store & Gallery"
          description="Plug-and-play collaborative elements as web components"
          comingSoon={true}
        >
          <ComponentStore />
        </FeatureCard>

        {/* Permissions - Coming Soon */}
        <FeatureCard
          title="Permissions"
          description="Fine-grained access control for behaviors"
          comingSoon={true}
        >
          <Permissions />
        </FeatureCard>

        {/* Scheduled Behaviors - Coming Soon */}
        <FeatureCard
          title="Scheduled Behaviors"
          description="Cron-like triggering of behaviors"
          comingSoon={true}
        >
          <ScheduledBehaviors />
        </FeatureCard>
      </div>
    </section>
  );
}
