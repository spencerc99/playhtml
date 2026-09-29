// ABOUTME: Renders the real new-tab scraps card from a local export with live count and size sliders.
// ABOUTME: Reads ./local-scraps.json (gitignored) or a dropped-in export file.

import React, { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { createRoot } from "react-dom/client";
import { ScrapsLaunchCardView } from "@extension/announcements/ScrapsLaunchCard";
import type { ScrapRecord } from "@extension/entrypoints/scraps/scrapItems";

const MIN_COUNT = 4;
const MAX_COUNT = 60;
const DEFAULT_COUNT = 20;
const DEFAULT_PILE_HEIGHT = 240;

function newestFirst(scraps: ScrapRecord[]): ScrapRecord[] {
  return [...scraps].sort((first, second) => second.ts - first.ts);
}

function readExport(json: unknown): ScrapRecord[] {
  const scraps = (json as { scraps?: unknown })?.scraps;
  if (!Array.isArray(scraps)) {
    throw new Error("export has no scraps array");
  }
  return newestFirst(scraps as ScrapRecord[]);
}

function DevPage() {
  const [scraps, setScraps] = useState<ScrapRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [width, setWidth] = useState(1100);
  const [pileHeight, setPileHeight] = useState(DEFAULT_PILE_HEIGHT);
  const [textDismissed, setTextDismissed] = useState(false);
  const newest = useMemo(() => scraps?.slice(0, count) ?? [], [scraps, count]);

  useEffect(() => {
    fetch("./local-scraps.json")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((json) => setScraps(readExport(json)))
      .catch((loadError: unknown) =>
        setError(
          `no local-scraps.json here (${String(loadError)}). pick an export file below.`,
        ),
      );
  }, []);

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        setScraps(readExport(JSON.parse(text)));
        setError(null);
      })
      .catch((readError: unknown) => setError(String(readError)));
  };

  const kinds = useMemo(() => {
    const tally = new Map<string, number>();
    for (const scrap of scraps ?? []) {
      tally.set(scrap.kind, (tally.get(scrap.kind) ?? 0) + 1);
    }
    return [...tally].map(([kind, total]) => `${kind} ${total}`).join(" · ");
  }, [scraps]);

  return (
    <main style={{ maxWidth: width, margin: "0 auto", padding: "32px 24px" }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 24,
          alignItems: "center",
          marginBottom: 24,
          fontFamily: "'Martian Mono', monospace",
          fontSize: 12,
        }}
      >
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          pieces
          <input
            type="range"
            min={MIN_COUNT}
            max={MAX_COUNT}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            style={{ width: 240 }}
          />
          <strong style={{ minWidth: 24 }}>{count}</strong>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          card width
          <input
            type="range"
            min={360}
            max={1600}
            step={20}
            value={width}
            onChange={(event) => setWidth(Number(event.target.value))}
            style={{ width: 160 }}
          />
          <strong>{width}px</strong>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          pile height
          <input
            type="range"
            min={120}
            max={480}
            step={10}
            value={pileHeight}
            onChange={(event) => setPileHeight(Number(event.target.value))}
            style={{ width: 140 }}
          />
          <strong>{pileHeight}px</strong>
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="checkbox"
            checked={textDismissed}
            onChange={(event) => setTextDismissed(event.target.checked)}
          />
          text dismissed
        </label>
        <input type="file" accept="application/json" onChange={onFile} />
        <span style={{ color: "#8a8279" }}>{kinds}</span>
      </div>

      {error ? <p style={{ color: "#c4724e" }}>{error}</p> : null}

      {scraps ? (
        <div
          style={
            { "--scraps-pile-height": `${pileHeight}px` } as React.CSSProperties
          }
        >
          <ScrapsLaunchCardView
            key={count}
            scraps={newest}
            total={scraps.length}
            textDismissed={textDismissed}
            scrapsHref="#"
            onDismiss={() => setTextDismissed(true)}
          />
        </div>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<DevPage />);
