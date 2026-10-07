// ABOUTME: Loads a real "Internet Scraps.json" export and packs it at each scrap's own size.
// ABOUTME: Tuning sliders, full-width and drawer-width fields, and visit outlines for judging the feel.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  COLLAGE_STYLES,
  ScrapContent,
  type ScrapItem,
} from "@movement/components/ScrapCollage";
import {
  DEFAULT_PACK_OPTIONS,
  packScraps,
  type PackOptions,
} from "@movement/utils/scrapPacking";

const DB_NAME = "scraps-packing";
const STORE = "exports";
const EXPORT_KEY = "latest";
const DRAWER_WIDTH = 360;
const OVERSCAN = 800;
const SEED = 7;
/** Where scraps whose picture no longer loads are remembered between visits. */
const DEAD_STORAGE_KEY = "scraps-packing-dead";
/** How long to gather newly dead scraps before re-packing without them. */
const REPACK_DELAY_MS = 500;

function readDead(): ReadonlySet<string> {
  try {
    const saved = localStorage.getItem(DEAD_STORAGE_KEY);
    return new Set(saved ? (JSON.parse(saved) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeDead(dead: ReadonlySet<string>) {
  try {
    localStorage.setItem(DEAD_STORAGE_KEY, JSON.stringify([...dead]));
  } catch {
    // Remembering is a convenience; the next visit just finds them again.
  }
}

/** Measures text with the browser's own font rendering, for tight button boxes. */
const measureCanvas = document.createElement("canvas").getContext("2d");
function measureText(text: string, font: string): number {
  if (!measureCanvas) throw new Error("No 2D canvas to measure text with");
  measureCanvas.font = font;
  return measureCanvas.measureText(text).width;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveExport(text: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(text, EXPORT_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadSavedExport(): Promise<string | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(EXPORT_KEY);
    request.onsuccess = () => resolve(request.result as string | undefined);
    request.onerror = () => reject(request.error);
  });
}

function parseExport(text: string): ScrapItem[] {
  const parsed = JSON.parse(text) as { scraps?: ScrapItem[] };
  if (!Array.isArray(parsed.scraps)) {
    throw new Error("This file has no `scraps` list");
  }
  return [...parsed.scraps].sort((a, b) => b.ts - a.ts);
}

const SLIDERS: {
  key: Exclude<keyof typeof DEFAULT_PACK_OPTIONS, "placement">;
  label: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "scale", label: "scale", min: 0.3, max: 2.5, step: 0.05 },
  { key: "squash", label: "squash", min: 0.4, max: 1, step: 0.02 },
  { key: "maxEdge", label: "max edge", min: 80, max: 520, step: 10 },
  { key: "minEdge", label: "min edge", min: 8, max: 80, step: 2 },
  { key: "gap", label: "gap in visit", min: 0, max: 24, step: 1 },
  { key: "visitGap", label: "gap between visits", min: 0, max: 60, step: 2 },
  { key: "backtrack", label: "backtrack", min: 0, max: 400, step: 10 },
  { key: "tilt", label: "tilt", min: 0, max: 12, step: 0.5 },
];

function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return width;
}

function useScroll(): { top: number; height: number } {
  const [scroll, setScroll] = useState(() => ({
    top: window.scrollY,
    height: window.innerHeight,
  }));
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setScroll({ top: window.scrollY, height: window.innerHeight }),
      );
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return scroll;
}

function visitLabel(items: ScrapItem[]): string {
  const first = items[0];
  const when = new Date(first.ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${first.domain} · ${when} · ${items.length}`;
}

function PackingPage() {
  const [items, setItems] = useState<ScrapItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tuning, setTuning] = useState(DEFAULT_PACK_OPTIONS);
  const [drawer, setDrawer] = useState(false);
  const [outlines, setOutlines] = useState(true);
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  /** Scraps whose picture failed to load, hidden at once. */
  const [broken, setBroken] = useState<ReadonlySet<string>>(readDead);
  /** The dead scraps the current packing leaves out; trails `broken` a little. */
  const [dead, setDead] = useState<ReadonlySet<string>>(readDead);
  const fieldRef = useRef<HTMLDivElement>(null);
  const windowWidth = useWindowWidth();
  const scroll = useScroll();

  useEffect(() => {
    loadSavedExport()
      .then((text) => {
        if (text) setItems(parseExport(text));
      })
      .catch((cause: unknown) => setError(String(cause)));
  }, []);

  const readFile = async (file: File) => {
    try {
      const text = await file.text();
      setItems(parseExport(text));
      setError(null);
      await saveExport(text);
    } catch (cause) {
      setError(String(cause));
    }
  };

  // Dead scraps arrive one at a time as pictures fail, so they are gathered
  // briefly and the field re-packed once for the batch.
  useEffect(() => {
    if (broken.size === dead.size) return;
    const timer = window.setTimeout(() => {
      setDead(broken);
      writeDead(broken);
    }, REPACK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [broken, dead]);

  const living = useMemo(
    () => items?.filter((item) => !dead.has(item.key)) ?? null,
    [items, dead],
  );

  const fieldWidth = drawer ? DRAWER_WIDTH : Math.max(320, windowWidth - 48);
  const options: PackOptions = {
    ...tuning,
    width: fieldWidth,
    seed: SEED,
    measureText,
  };

  const { packing, ms } = useMemo(() => {
    if (!living) return { packing: null, ms: 0 };
    const started = performance.now();
    const result = packScraps(living, options);
    return { packing: result, ms: performance.now() - started };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [living, tuning, fieldWidth]);

  const fieldTop = fieldRef.current
    ? fieldRef.current.getBoundingClientRect().top + window.scrollY
    : 0;
  const viewTop = scroll.top - fieldTop - OVERSCAN;
  const viewBottom = scroll.top - fieldTop + scroll.height + OVERSCAN;
  const visibleScraps = packing
    ? packing.scraps.filter(
        (scrap) =>
          !broken.has(scrap.item.key) &&
          scrap.y + scrap.height >= viewTop &&
          scrap.y <= viewBottom,
      )
    : [];
  const visibleVisits = packing
    ? packing.visits.filter(
        (visit) => visit.y + visit.height >= viewTop && visit.y <= viewBottom,
      )
    : [];

  return (
    <main
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) void readFile(file);
      }}
      style={{ minHeight: "100vh", fontFamily: '"Martian Mono", monospace' }}
    >
      <style>{COLLAGE_STYLES}</style>
      <style>{`
        .packing-panel {
          position: sticky; top: 0; z-index: 500;
          display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center;
          padding: 10px 24px; font-size: 10px;
          background: rgba(250, 247, 242, 0.94);
          border-bottom: 1px solid rgba(61, 56, 51, 0.12);
        }
        .packing-panel label { display: flex; gap: 6px; align-items: center; }
        .packing-panel input[type=range] { width: 90px; }
        .packing-visit {
          position: absolute; pointer-events: none;
          border: 1px dashed rgba(61, 56, 51, 0.22); border-radius: 6px;
        }
        .packing-visit span {
          position: absolute; left: 0; top: -13px; white-space: nowrap;
          font-size: 8px; color: #8a8279;
        }
        .packing-field .scrap-collage__button {
          overflow: hidden; text-overflow: ellipsis;
        }
      `}</style>

      <div className="packing-panel">
        <strong style={{ fontWeight: 500 }}>scrap packing</strong>
        <label>
          export
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
            }}
          />
        </label>
        {SLIDERS.map((slider) => (
          <label key={slider.key}>
            {slider.label}
            <input
              type="range"
              min={slider.min}
              max={slider.max}
              step={slider.step}
              value={tuning[slider.key]}
              onChange={(event) =>
                setTuning({
                  ...tuning,
                  [slider.key]: Number(event.target.value),
                })
              }
            />
            <span style={{ width: 30 }}>{tuning[slider.key]}</span>
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={tuning.placement === "pieces"}
            onChange={(event) =>
              setTuning({
                ...tuning,
                placement: event.target.checked ? "pieces" : "visits",
              })
            }
          />
          place pieces one by one
        </label>
        <label>
          <input
            type="checkbox"
            checked={drawer}
            onChange={(event) => setDrawer(event.target.checked)}
          />
          drawer width
        </label>
        <label>
          <input
            type="checkbox"
            checked={outlines}
            onChange={(event) => setOutlines(event.target.checked)}
          />
          visit outlines
        </label>
        <button type="button" onClick={() => setTuning(DEFAULT_PACK_OPTIONS)}>
          reset
        </button>
        {packing && items && (
          <span style={{ color: "#8a8279" }}>
            {living?.length} scraps ({dead.size} dead links left out) ·{" "}
            {packing.visits.length} visits · packed in{" "}
            {ms.toFixed(0)}ms
          </span>
        )}
      </div>

      {error && <p style={{ padding: 24, color: "#c4724e" }}>{error}</p>}
      {!items && !error && (
        <p style={{ padding: 24, fontSize: 12 }}>
          Drop your Internet Scraps.json here, or pick it above. It stays in
          this browser for next time.
        </p>
      )}

      {packing && (
        <div
          ref={fieldRef}
          className="packing-field"
          style={{
            position: "relative",
            width: fieldWidth,
            height: packing.height + 40,
            margin: "28px 24px",
            outline: drawer ? "1px solid rgba(61, 56, 51, 0.15)" : undefined,
          }}
        >
          {outlines &&
            visibleVisits.map((visit) => (
              <div
                key={`${visit.items[0].key}-${visit.y}`}
                className="packing-visit"
                style={{
                  left: visit.x - 4,
                  top: visit.y - 4,
                  width: visit.width + 8,
                  height: visit.height + 8,
                }}
              >
                {!drawer && <span>{visitLabel(visit.items)}</span>}
              </div>
            ))}
          {visibleScraps.map((scrap) => (
            <a
              key={scrap.item.id}
              className="scrap-collage__tile"
              href={scrap.item.pageUrl}
              target="_blank"
              rel="noreferrer"
              title={`${scrap.item.pageTitle}\n${scrap.item.domain}\n${new Date(scrap.item.ts).toLocaleString()}`}
              style={
                {
                  left: scrap.x,
                  top: scrap.y,
                  width: scrap.width,
                  height: scrap.height,
                  "--scrap-rotation": `${scrap.rotation}deg`,
                } as React.CSSProperties
              }
            >
              <ScrapContent
                item={scrap.item}
                loaded={loaded.has(scrap.item.key)}
                onLoad={() =>
                  setLoaded((previous) => new Set(previous).add(scrap.item.key))
                }
                onError={() =>
                  setBroken((previous) => new Set(previous).add(scrap.item.key))
                }
                tileWidth={scrap.width}
              />
            </a>
          ))}
        </div>
      )}
    </main>
  );
}

const container = document.getElementById("reactContent");
if (container) {
  createRoot(container).render(<PackingPage />);
}
