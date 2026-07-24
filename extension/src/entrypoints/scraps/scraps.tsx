// ABOUTME: Full-tab extension page for browsing locally collected internet scraps.
// ABOUTME: Loads scraps from the background and renders a daily seeded paper collage.

import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import {
  ScrapCollage,
  type ScrapItem,
} from "@movement/components/ScrapCollage";

interface ScrapRecordBase {
  id: string;
  key: string;
  pageTitle: string;
  faviconUrl?: string;
  domain: string;
  pageUrl: string;
  ts: number;
}

type ScrapRecord = ScrapRecordBase &
  (
    | {
        kind: "image";
        src: string;
        alt?: string;
        naturalWidth: number;
        naturalHeight: number;
      }
    | {
        kind: "button";
        text: string;
        styles: Record<string, string>;
        innerSvg?: string;
      }
    | {
        kind: "svg-icon";
        markup: string;
        width: number;
        height: number;
      }
    | {
        kind: "cursor";
        url: string;
        hotspotX?: number;
        hotspotY?: number;
      }
  );

interface ScrapsResponse {
  scraps: ScrapRecord[];
}

function toScrapItem(record: ScrapRecord): ScrapItem {
  const base = {
    id: record.id,
    key: record.key,
    pageTitle: record.pageTitle,
    ...(record.faviconUrl !== undefined
      ? { faviconUrl: record.faviconUrl }
      : {}),
    domain: record.domain,
    pageUrl: record.pageUrl,
    ts: record.ts,
  };

  switch (record.kind) {
    case "image":
      return {
        ...base,
        kind: record.kind,
        src: record.src,
        ...(record.alt !== undefined ? { alt: record.alt } : {}),
        naturalWidth: record.naturalWidth,
        naturalHeight: record.naturalHeight,
      };
    case "button":
      return {
        ...base,
        kind: record.kind,
        text: record.text,
        styles: record.styles,
        ...(record.innerSvg !== undefined ? { innerSvg: record.innerSvg } : {}),
      };
    case "svg-icon":
      return {
        ...base,
        kind: record.kind,
        markup: record.markup,
        width: record.width,
        height: record.height,
      };
    case "cursor":
      return {
        ...base,
        kind: record.kind,
        url: record.url,
        ...(record.hotspotX !== undefined ? { hotspotX: record.hotspotX } : {}),
        ...(record.hotspotY !== undefined ? { hotspotY: record.hotspotY } : {}),
      };
  }
}

const centeredMessageStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 3,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  color: "#827a72",
  fontFamily: '"Martian Mono", monospace',
  fontSize: 11,
  letterSpacing: "0.02em",
  textAlign: "center",
};

export function ScrapsPage() {
  const [items, setItems] = useState<ScrapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seed = useMemo(() => Math.floor(Date.now() / 86_400_000), []);

  useEffect(() => {
    const loadScraps = async () => {
      try {
        const response = (await browser.runtime.sendMessage({
          type: "GET_SCRAPS",
          options: { limit: 5000 },
        })) as ScrapsResponse;
        if (!response || !Array.isArray(response.scraps)) {
          throw new Error("GET_SCRAPS returned an invalid response");
        }
        setItems(response.scraps.map(toScrapItem));
      } catch (loadError) {
        const message =
          loadError instanceof Error ? loadError.message : String(loadError);
        setError(message);
        console.error("Failed to load internet scraps:", loadError);
      } finally {
        setLoading(false);
      }
    };

    void loadScraps();
  }, []);

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
      <svg
        width="100%"
        height="100%"
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          opacity: 0.7,
          pointerEvents: "none",
          mixBlendMode: "multiply",
        }}
      >
        <defs>
          <filter id="scraps-paper-noise">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves="3"
              stitchTiles="stitch"
            />
            <feColorMatrix
              type="matrix"
              values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 2 -1"
            />
          </filter>
          <filter id="scraps-paper-grain">
            <feTurbulence
              type="turbulence"
              baseFrequency="0.5"
              numOctaves="2"
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="discrete" tableValues="0 0.2 0.3 0.4" />
            </feComponentTransfer>
          </filter>
        </defs>
        <rect width="100%" height="100%" filter="url(#scraps-paper-noise)" />
        <rect
          width="100%"
          height="100%"
          filter="url(#scraps-paper-grain)"
          style={{ opacity: 0.3 }}
        />
      </svg>

      <span
        style={{
          position: "absolute",
          top: 14,
          left: 20,
          zIndex: 4,
          color: "#3d3833",
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
          width: "min(520px, calc(100vw - 320px))",
          textAlign: "center",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      >
        <h1
          style={{
            margin: 0,
            color: "#3d3833",
            fontFamily: '"Martian Mono", monospace',
            fontSize: 15,
            fontWeight: 500,
            letterSpacing: "0.04em",
          }}
        >
          internet scraps
        </h1>
        <p
          style={{
            margin: "5px 0 0",
            color: "#827a72",
            fontFamily: '"Martian Mono", monospace',
            fontSize: 9,
            letterSpacing: "0.02em",
          }}
        >
          images that washed up while you browsed
        </p>
      </header>

      {!loading && !error && items.length > 0 && (
        <div
          style={{
            position: "absolute",
            inset: "74px 20px 18px",
            zIndex: 2,
          }}
        >
          <ScrapCollage items={items} seed={seed} />
        </div>
      )}

      {loading && <div style={centeredMessageStyle}>gathering scraps...</div>}
      {!loading && error && (
        <div style={centeredMessageStyle}>scraps could not be gathered</div>
      )}
      {!loading && !error && items.length === 0 && (
        <div style={centeredMessageStyle}>
          nothing has washed up yet - browse a while
        </div>
      )}
    </main>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<ScrapsPage />);
}
