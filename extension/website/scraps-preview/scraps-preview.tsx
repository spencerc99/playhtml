// ABOUTME: Renders ScrapCollage with synthetic image, button, svg-icon, and cursor scraps.
// ABOUTME: Network-free demo data by default; a picked "Internet Scraps.json" export swaps in real scraps.

import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ScrapCollage, type ScrapItem } from "@movement/components/ScrapCollage";
import { buildItems, DAY_MS, NOW } from "./demoScraps";

function PreviewPage() {
  const seed = Math.floor(NOW / DAY_MS);
  const [exported, setExported] = useState<ScrapItem[] | null>(null);

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
          {exported
            ? `${exported.length} scraps from an export`
            : "synthetic scraps: images, buttons, icons, cursors"}
        </p>
        <label style={{ pointerEvents: "auto", fontFamily: '"Martian Mono", monospace', fontSize: 9 }}>
          load export{" "}
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const parsed = JSON.parse(await file.text()) as { scraps?: ScrapItem[] };
              if (!Array.isArray(parsed.scraps)) {
                throw new Error("This file has no `scraps` list");
              }
              setExported(parsed.scraps);
            }}
          />
        </label>
      </header>
      <div style={{ position: "absolute", inset: "74px 20px 18px", zIndex: 2 }}>
        {/* Small target count so the preview pool exceeds what fits ashore and
            the tide rotation is exercisable here. */}
        <ScrapCollage
          items={exported ?? buildItems()}
          seed={seed}
          targetCount={exported ? undefined : 14}
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
