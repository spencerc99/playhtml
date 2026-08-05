// ABOUTME: Renders ScrapCollage with synthetic image, button, svg-icon, and cursor scraps.
// ABOUTME: Network-free demo data for visually checking mixed-media collage rendering.

import React from "react";
import { createRoot } from "react-dom/client";
import { ScrapCollage } from "@movement/components/ScrapCollage";
import { buildItems, DAY_MS, NOW } from "./demoScraps";

function PreviewPage() {
  const seed = Math.floor(NOW / DAY_MS);

  return (
    <main
      style={{
        position: "relative",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#faf9f6",
        color: "#3d3833",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 14,
          left: 20,
          zIndex: 4,
          fontFamily: "'Source Serif 4', Georgia, serif",
          fontSize: 20,
          fontStyle: "italic",
          fontWeight: 200,
          pointerEvents: "none",
        }}
      >
        we were online
      </span>
      <header
        style={{
          position: "absolute",
          top: 14,
          left: "50%",
          zIndex: 4,
          textAlign: "center",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      >
        <h1
          style={{
            margin: 0,
            fontFamily: '"Martian Mono", monospace',
            fontSize: 15,
            fontWeight: 500,
            letterSpacing: "0.04em",
          }}
        >
          internet scraps (preview data)
        </h1>
        <p
          style={{
            margin: "5px 0 0",
            color: "#827a72",
            fontFamily: '"Martian Mono", monospace',
            fontSize: 9,
          }}
        >
          synthetic scraps: images, buttons, icons, cursors
        </p>
      </header>
      <div style={{ position: "absolute", inset: "74px 20px 18px", zIndex: 2 }}>
        <ScrapCollage
          items={buildItems()}
          seed={seed}
          showKindFilter={true}
        />
      </div>
    </main>
  );
}

const container = document.getElementById("reactContent");
if (container) {
  createRoot(container).render(<PreviewPage />);
}
