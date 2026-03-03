import React from "react";
import browser from "webextension-polyfill";
import { PlayHTMLStatus } from "../types";

interface SiteStatusProps {
  currentTab: browser.Tabs.Tab | null;
  playhtmlStatus: PlayHTMLStatus;
}

export function SiteStatus({ currentTab, playhtmlStatus }: SiteStatusProps) {
  return (
    <section style={{ marginBottom: "16px" }}>
      <h3
        style={{ margin: "0 0 8px 0", fontSize: "14px", color: "#374151" }}
      >
        Current Site
      </h3>
      <div
        style={{
          background: "#f9fafb",
          padding: "8px",
          borderRadius: "6px",
          fontSize: "12px",
        }}
      >
        <div style={{ marginBottom: "4px" }}>
          <strong>URL:</strong>{" "}
          {currentTab?.url ? new URL(currentTab.url).hostname : "Unknown"}
        </div>
        <div>
          <strong>PlayHTML detected:</strong>{" "}
          {playhtmlStatus.checking
            ? "Checking..."
            : playhtmlStatus.detected
            ? `Yes (${playhtmlStatus.elementCount} elements)`
            : "No"}
        </div>
      </div>
    </section>
  );
}