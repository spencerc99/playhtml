import React from "react";
import { RainSprinkler } from "../../packages/react/examples/RainSprinkler";
import { ReactiveOrbs } from "../../packages/react/examples/ReactiveOrbs";
import { DataModes } from "../../packages/react/examples/DataModes";
import "./FeaturesGrid.scss";
import { withSharedState } from "@playhtml/react";

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
    dataSource: "localhost:5173/experiments/one#main", // Links to the same data source as experiments/one
  },
  ({ data }, { children }) => {
    console.log("data", data);
    // Get the latest color, fallback to white
    const latestColor = data.colors[data.colors.length - 1]?.color || "#ffffff";

    // Pass the color data to children via React.cloneElement
    return React.cloneElement(children as React.ReactElement, {
      sharedColor: latestColor,
    });
  }
);

const SharedLamp = withSharedState(
  { defaultData: { on: false }, dataSource: "localhost:4321#lamp-akari" },
  ({ data }) => {
    return (
      <img
        className={`lamp ${data.on ? "clicked" : ""}`}
        id="lamp-akari"
        src="/lamps/Akari-1N.png"
        data-source="localhost:4321#lamp-akari"
      />
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
        <SharedLamp />
      </div>
    </div>
  );
}

export function SharedElements() {
  return (
    <div className="shared-elements-container">
      <div className="portal-section">
        <PersonalSitePortal />
      </div>
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
  description: string;
  comingSoon?: boolean;
  children?: React.ReactNode;
  sharedColor?: string;
}) => {
  const cardStyle = sharedColor
    ? {
        backgroundColor: `${sharedColor}90`, // 20 = 12% opacity for subtle tint
        position: "relative" as const,
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
          <div className="sync-indicator">🔗 experiments/one</div>
        </>
      )}
      <div className="card-content">
        <h3>
          {title}{" "}
          {comingSoon && <span className="coming-soon-badge">coming soon</span>}
        </h3>
        <p>{description}</p>
      </div>
      <div className="interactive-elements">{children}</div>
    </div>
  );
};

// Rain and orb components moved to examples package

export default function FeaturesGrid() {
  return (
    <section className="features-section">
      <h2>What makes playhtml special</h2>
      <div className="features-grid">
        {/* Reactive Data - Implemented */}
        <div className="feature-card-wrapper">
          <FeatureCard
            title="Reactive Data"
            description="Live, persistent state per-element"
          >
            <ReactiveOrbs />
          </FeatureCard>
        </div>

        {/* Data Modes - Awareness vs Persistent */}
        <div className="feature-card-wrapper">
          <FeatureCard
            title="Flexible Persistence"
            description="Live presence and persistent data"
          >
            <DataModes />
          </FeatureCard>
        </div>

        {/* Custom Events */}
        <div className="feature-card-wrapper">
          <FeatureCard
            title="Custom Events"
            description="Imperative logic with event system"
          >
            <RainSprinkler />
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
              title="State Sharing"
              description="Share state across pages and domains"
            >
              <SharedElements />
            </FeatureCard>
          </SharedColorProvider>
        </div>

        {/* Web Components - Coming Soon */}
        <FeatureCard
          title="Component Store & Gallery"
          description="Plug-and-play collaborative elements as web components"
          comingSoon={true}
        >
          {/* a bunch of lamps / other objects all toggling various states */}
        </FeatureCard>

        {/* Permissions - Coming Soon */}
        <FeatureCard
          title="Permissions"
          description="Fine-grained access control for behaviors"
          comingSoon={true}
        >
          {/* TODO: Lock/key combinations */}
        </FeatureCard>

        {/* Scheduled Behaviors - Coming Soon */}
        <FeatureCard
          title="Scheduled Behaviors"
          description="Cron-like triggering of behaviors"
          comingSoon={true}
        >
          {/* TODO: a clock ticking up to number and ringing / shaking */}
        </FeatureCard>

        {/* Custom Data Sources - Coming Soon */}
        {/* <FeatureCard
          title="Custom Data Sources"
          description="External APIs, databases, and file integrations"
          comingSoon={true}
        >
        </FeatureCard> */}
      </div>
    </section>
  );
}
