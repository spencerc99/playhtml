// ABOUTME: Full-tab extension page for browsing locally collected internet scraps.
// ABOUTME: Hosts the drifting browse collage and the create mode for making your own.

import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/lora/latin-600.css";
import "@fontsource/lora/latin-700.css";
import type { ScrapSource } from "@movement/utils/scrapPhotoGroups";
import { ExtensionPageNav } from "../../components/ExtensionPageNav";
import {
  COLLAGE_STYLES,
  ScrapCollage,
  type ScrapItem,
  type ScrapPosition,
} from "@movement/components/ScrapCollage";
import { useFeatureState } from "../../features/useFeatureAccess";
import { CollageStudio } from "./CollageStudio";
import { CollageHistory } from "./CollageHistory";
import { COLLAGE_STUDIO_STYLES } from "./collageStudioStyles";
import type { CollageRecord } from "./collageRecord";

interface ScrapRecordBase {
  sources?: ScrapSource[];
  encounterCount?: number;
  encounterDay?: string;
  id: string;
  key: string;
  pageTitle: string;
  faviconUrl?: string;
  domain: string;
  pageUrl: string;
  ts: number;
  position?: ScrapPosition;
}

type ScrapRecord = ScrapRecordBase &
  (
    | {
        kind: "image";
        src: string;
        contentHash?: string;
        alt?: string;
        naturalWidth: number;
        naturalHeight: number;
      }
    | {
        kind: "button";
        text: string;
        styles: Record<string, string>;
        innerSvg?: string;
        backdropColor?: string;
      }
    | {
        kind: "svg-icon";
        markup: string;
        width: number;
        height: number;
      }
    | {
        kind: "heading";
        text: string;
        level: 1 | 2 | 3;
        styles: Record<string, string>;
        backdropColor?: never;
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
    encounterCount: record.encounterCount,
    encounterDay: record.encounterDay,
    ...(record.sources ? { sources: record.sources } : {}),
    key: record.key,
    pageTitle: record.pageTitle,
    ...(record.faviconUrl !== undefined
      ? { faviconUrl: record.faviconUrl }
      : {}),
    domain: record.domain,
    pageUrl: record.pageUrl,
    ts: record.ts,
    ...(record.position ? { position: record.position } : {}),
  };

  switch (record.kind) {
    case "image":
      return {
        ...base,
        kind: record.kind,
        src: record.src,
        ...(record.contentHash ? { contentHash: record.contentHash } : {}),
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
        ...(record.backdropColor !== undefined
          ? { backdropColor: record.backdropColor }
          : {}),
      };
    case "svg-icon":
      return {
        ...base,
        kind: record.kind,
        markup: record.markup,
        width: record.width,
        height: record.height,
      };
    case "heading":
      return {
        ...base,
        kind: record.kind,
        text: record.text,
        level: record.level,
        styles: record.styles,
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

type ScrapsMode = "browse" | "create";

export function ScrapsPage() {
  const [items, setItems] = useState<ScrapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<ScrapsMode>("browse");
  const [editing, setEditing] = useState<CollageRecord | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  /** Bumped when a studio is opened, so each editing session starts fresh. */
  const [studioSession, setStudioSession] = useState(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const seed = useMemo(() => Math.floor(Date.now() / 86_400_000), []);
  const collagesFeature = useFeatureState("SCRAP_COLLAGES");
  const canCreate = collagesFeature.enabled;

  useEffect(() => {
    if (!canCreate && mode === "create") setMode("browse");
  }, [canCreate, mode]);

  useEffect(() => {
    const onMessage = (message: unknown) => {
      if (
        typeof message === "object" &&
        message !== null &&
        "type" in message &&
        message.type === "SCRAP_PHOTOS_UPDATED"
      ) {
        setRevision((value) => value + 1);
      }
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadScraps = async () => {
      try {
        const response = (await browser.runtime.sendMessage({
          type: "GET_SCRAPS",
          options: { limit: 5000 },
        })) as ScrapsResponse;
        if (!response || !Array.isArray(response.scraps)) {
          throw new Error("GET_SCRAPS returned an invalid response");
        }
        if (!cancelled) {
          setItems(response.scraps.map(toScrapItem));
          setError(null);
        }
      } catch (loadError) {
        const message =
          loadError instanceof Error ? loadError.message : String(loadError);
        if (!cancelled) setError(message);
        console.error("Failed to load internet scraps:", loadError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadScraps();
    return () => {
      cancelled = true;
    };
  }, [revision]);

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
      {canCreate && (
        <style>{`${COLLAGE_STYLES}${COLLAGE_STUDIO_STYLES}`}</style>
      )}
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

      <div
        style={{
          position: "absolute",
          top: 14,
          left: 20,
          right: 20,
          zIndex: 4,
          pointerEvents: "auto",
        }}
      >
        <ExtensionPageNav currentPage="scraps" />
      </div>

      <style>{`
        .scraps-heading { top: 14px; width: min(520px, calc(100vw - 320px)); }
        .scraps-stage { inset: 64px 0 0; }
        @media (max-width: 620px) {
          .scraps-heading { top: 48px; width: calc(100vw - 32px); }
          .scraps-stage { inset: 104px 0 0; }
        }
      `}</style>
      <header
        className="scraps-heading"
        style={{
          position: "absolute",
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
        {canCreate && (
          <div
            className="collage-mode-switch"
            style={{ marginTop: 8, pointerEvents: "auto" }}
          >
            <button
              type="button"
              className={`collage-chip${mode === "browse" ? " collage-chip--active" : ""}`}
              onClick={() => setMode("browse")}
            >
              browse
            </button>
            <button
              type="button"
              className={`collage-chip${mode === "create" ? " collage-chip--active" : ""}`}
              onClick={() => setMode("create")}
            >
              create
            </button>
          </div>
        )}
      </header>

      {mode === "browse" && !loading && !error && items.length > 0 && (
        <div
          className="scraps-stage"
          style={{
            position: "absolute",
            zIndex: 2,
          }}
        >
          <ScrapCollage items={items} seed={seed} showKindFilter={true} />
        </div>
      )}

      {mode === "create" && !loading && !error && (
        <div style={{ position: "absolute", inset: "96px 0 0", zIndex: 2 }}>
          {!studioOpen ? (
            <CollageHistory
              revision={savedRevision}
              onEdit={(record) => {
                setEditing(record);
                setStudioSession((value) => value + 1);
                setStudioOpen(true);
              }}
              onStartNew={() => {
                setEditing(null);
                setStudioSession((value) => value + 1);
                setStudioOpen(true);
              }}
            />
          ) : (
            <CollageStudio
              key={studioSession}
              scraps={items}
              editing={editing}
              onSaved={() => setSavedRevision((value) => value + 1)}
              onLeave={() => {
                setEditing(null);
                setStudioOpen(false);
              }}
            />
          )}
        </div>
      )}

      {loading && <div style={centeredMessageStyle}>gathering scraps...</div>}
      {!loading && error && (
        <div style={centeredMessageStyle}>scraps could not be gathered</div>
      )}
      {mode === "browse" && !loading && !error && items.length === 0 && (
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
