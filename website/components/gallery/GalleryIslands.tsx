// ABOUTME: The /gallery page's React pieces: the shared grid/index of sites and the class strip.
// ABOUTME: Clicks leave smudges in the clicker's cursor color, like the experiments wall.

import {
  type CSSProperties,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { PlayContext, withSharedState } from "@playhtml/react";
import {
  TraceRetentionMs,
  ExperimentsTracesElementId,
  experimentsTracesSource,
  getExperimentTraceIndexesToRemove,
  pruneExperimentTraces,
  type ExperimentTrace,
} from "../../utils/experimentsArchiveLogic";
import { type GalleryItem, useGallerySites } from "./gallerySites";

type GalleryView = "gallery" | "index";

const TilesShownAtFirst = 16;
const TraceNavigationDelayMs = 700;
const ClassStripTilts = [-2, 1.5, -1, 2, 1, -1.5, 2.5, -2];

function Slot({ id, children }: { id: string; children: ReactNode }) {
  const mount = document.getElementById(id);
  return mount ? createPortal(children, mount) : null;
}

function tracePlacement(traceId: string) {
  let hash = 0;
  for (let index = 0; index < traceId.length; index += 1) {
    hash = (hash * 31 + traceId.charCodeAt(index)) % 997;
  }
  return { y: 18 + (hash % 64), rotate: (hash % 34) - 17 };
}

function Smudges({ traces }: { traces: ExperimentTrace[] }) {
  if (traces.length === 0) return null;
  const now = Date.now();
  return (
    <span className="ph-gallery__prints" aria-hidden="true">
      {traces.map((trace) => {
        const placement = tracePlacement(trace.id);
        const age = Math.max(0, now - trace.createdAt);
        return (
          <i
            key={trace.id}
            style={
              {
                "--trace-color": trace.color,
                "--trace-opacity": Math.max(
                  0.08,
                  (1 - age / TraceRetentionMs) * 0.72,
                ),
                "--trace-rotate": `${placement.rotate}deg`,
                "--trace-x": `${trace.x * 100}%`,
                "--trace-y": `${placement.y}%`,
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}

function clickX(event: MouseEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  const raw = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;
  return Math.min(0.92, Math.max(0.08, raw));
}

function byline(item: GalleryItem) {
  return item.by ? `by ${item.by}` : item.hostname;
}

interface GalleryData {
  traces: ExperimentTrace[];
}

type TraceWriter = (mutator: (draft: GalleryData) => void) => void;

function addTrace(draft: GalleryData, trace: ExperimentTrace, now: number) {
  if (!Array.isArray(draft.traces)) draft.traces = [];
  getExperimentTraceIndexesToRemove(draft.traces, trace, now).forEach(
    (index) => {
      draft.traces.splice(index, 1);
    },
  );
  draft.traces.push(trace);
}

// Spencer's experiments keep their smudges on the homepage shelf, so the
// gallery reads and writes that shared element instead of its own data. This
// renders nothing visible; it hands the traces and a writer up to the grid.
const StudioTraces = withSharedState<
  GalleryData,
  any,
  {
    onTraces: (traces: ExperimentTrace[]) => void;
    writerRef: MutableRefObject<TraceWriter | null>;
  }
>(
  () => ({
    defaultData: { traces: [] },
    dataSource: experimentsTracesSource(),
  }),
  ({ data, setData }, { onTraces, writerRef }) => {
    useEffect(() => {
      writerRef.current = setData as TraceWriter;
    });
    useEffect(() => {
      onTraces(Array.isArray(data?.traces) ? data.traces : []);
    }, [data?.traces, onTraces]);
    // The consumer's id must match the source element's id, or its data is
    // kept under a generated id and never reaches the homepage room.
    return <span id={ExperimentsTracesElementId} hidden aria-hidden="true" />;
  },
);

const GalleryGrid = withSharedState<GalleryData>(
  { defaultData: { traces: [] } },
  ({ data, setData }) => {
    const { cursors } = useContext(PlayContext);
    const sites = useGallerySites();
    const [view, setView] = useState<GalleryView>("gallery");
    const [showAll, setShowAll] = useState(false);
    const [luckyId, setLuckyId] = useState<string | null>(null);
    const [previewId, setPreviewId] = useState<string | null>(null);
    const luckyRef = useRef<HTMLAnchorElement | null>(null);
    const studioWriterRef = useRef<TraceWriter | null>(null);
    const [studioTraces, setStudioTraces] = useState<ExperimentTrace[]>([]);
    const myColor = cursors.color || "#10d210";

    const tracesById = useMemo(() => {
      const grouped = new Map<string, ExperimentTrace[]>();
      const ownTraces = Array.isArray(data?.traces) ? data.traces : [];
      for (const trace of pruneExperimentTraces(
        [...ownTraces, ...studioTraces],
        Date.now(),
      )) {
        grouped.set(trace.rowId, [...(grouped.get(trace.rowId) ?? []), trace]);
      }
      return grouped;
    }, [data?.traces, studioTraces]);

    const items = sites.status === "ready" ? sites.items : [];
    const ordered = useMemo(() => {
      if (!luckyId) return items;
      const lucky = items.find((item) => item.id === luckyId);
      return lucky
        ? [lucky, ...items.filter((item) => item.id !== luckyId)]
        : items;
    }, [items, luckyId]);
    const tiles = showAll ? ordered : ordered.slice(0, TilesShownAtFirst);
    const preview =
      items.find((item) => item.id === previewId) ??
      items.find((item) => item.id === luckyId) ??
      items[0];

    useEffect(() => {
      if (luckyId) luckyRef.current?.scrollIntoView({ block: "nearest" });
    }, [luckyId, view]);

    const visit = useCallback(
      (item: GalleryItem, event: MouseEvent<HTMLAnchorElement>) => {
        const now = Date.now();
        const trace: ExperimentTrace = {
          id: `${item.id}-${now}-${Math.random().toString(36).slice(2)}`,
          rowId: item.id,
          color: myColor,
          createdAt: now,
          x: clickX(event),
        };
        const write = item.fromStudio ? studioWriterRef.current : setData;
        write?.((draft) => addTrace(draft, trace, now));

        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        window.setTimeout(() => {
          window.location.href = item.href;
        }, TraceNavigationDelayMs);
      },
      [myColor, setData],
    );

    const pickRandom = () => {
      const pool = items.filter((item) => item.id !== luckyId);
      if (pool.length === 0) return;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      setLuckyId(pick.id);
      setPreviewId(pick.id);
    };

    return (
      <section
        className="ph-gallery"
        id="gallery-index"
        aria-labelledby="projects-h"
      >
        <StudioTraces onTraces={setStudioTraces} writerRef={studioWriterRef} />
        <div className="ph-section-head">
          <h2 id="projects-h">Everyone's projects</h2>
        </div>
        <div className="ph-gallery__bar">
          <div className="ph-gallery__views" role="group" aria-label="View">
            {(["gallery", "index"] as const).map((option) => (
              <button
                type="button"
                key={option}
                aria-pressed={view === option}
                onClick={() => setView(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <span className="ph-gallery__count">
            {sites.status === "ready" ? `${items.length} sites` : ""}
          </span>
          <button
            type="button"
            className="ph-gallery__random"
            disabled={sites.status !== "ready"}
            onClick={pickRandom}
          >
            random site
          </button>
        </div>

        {sites.status === "failed" ? (
          <p className="ph-gallery__fallback">
            Couldn't load the gallery right now. The full list lives on{" "}
            <a href="https://www.are.na/spencer-chang/playhtml-sites">Are.na</a>
            .
          </p>
        ) : null}

        {sites.status === "loading" ? (
          <div className="ph-gallery__grid" aria-busy="true">
            {Array.from({ length: 8 }, (_, index) => (
              <span
                key={index}
                className="ph-site ph-site--placeholder"
                aria-hidden="true"
              >
                <span className="ph-site__shot" />
                <span className="ph-gallery__text">&nbsp;</span>
              </span>
            ))}
          </div>
        ) : null}

        {sites.status === "ready" && view === "gallery" ? (
          <div className="ph-gallery__grid">
            {tiles.map((item) => {
              const isLucky = item.id === luckyId;
              return (
                <a
                  key={item.id}
                  ref={isLucky ? luckyRef : undefined}
                  className={`ph-site ph-gallery__tile${isLucky ? " is-lucky" : ""}`}
                  href={item.href}
                  onClick={(event) => visit(item, event)}
                >
                  {isLucky ? (
                    <span className="ph-gallery__badge">random pick</span>
                  ) : null}
                  <span className="ph-site__shot">
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.imageAlt ?? `Screenshot of ${item.title}`}
                        loading="lazy"
                      />
                    ) : null}
                  </span>
                  <span className="ph-gallery__text">
                    <Smudges traces={tracesById.get(item.id) ?? []} />
                    <b>{item.title}</b>
                    <span>{byline(item)}</span>
                    {item.by ? (
                      <span className="ph-gallery__host">{item.hostname}</span>
                    ) : null}
                  </span>
                </a>
              );
            })}
          </div>
        ) : null}

        {sites.status === "ready" &&
        view === "gallery" &&
        !showAll &&
        ordered.length > TilesShownAtFirst ? (
          <button
            type="button"
            className="ph-btn ph-btn--small ph-gallery__more"
            onClick={() => setShowAll(true)}
          >
            show all {ordered.length}
          </button>
        ) : null}

        {sites.status === "ready" && view === "index" ? (
          <div className="ph-gallery__index">
            <div className="ph-gallery__rows">
              {ordered.map((item) => (
                <a
                  key={item.id}
                  ref={item.id === luckyId ? luckyRef : undefined}
                  className={`ph-gallery__row${
                    item.id === preview?.id ? " is-current" : ""
                  }`}
                  href={item.href}
                  onMouseEnter={() => setPreviewId(item.id)}
                  onFocus={() => setPreviewId(item.id)}
                  onClick={(event) => visit(item, event)}
                >
                  <Smudges traces={tracesById.get(item.id) ?? []} />
                  <b>{item.title}</b>
                  <span>{byline(item)}</span>
                </a>
              ))}
            </div>
            {preview ? (
              <aside className="ph-gallery__preview" aria-live="polite">
                <span className="ph-site__shot">
                  {preview.imageUrl ? (
                    <img
                      src={preview.imageUrl}
                      alt={preview.imageAlt ?? `Screenshot of ${preview.title}`}
                    />
                  ) : null}
                </span>
                <span className="ph-gallery__text">
                  <b>{preview.title}</b>
                  <span>{byline(preview)}</span>
                  <span className="ph-gallery__host">{preview.hostname}</span>
                </span>
              </aside>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  },
);

function ClassStrip() {
  const sites = useGallerySites();
  if (sites.status !== "ready" || sites.classSites.length === 0) return null;
  return (
    <>
      {sites.classSites.slice(0, ClassStripTilts.length).map((site, index) => (
        <a
          key={site.id}
          className="ph-class__shot"
          href={site.href}
          style={{ "--tilt": `${ClassStripTilts[index]}deg` } as CSSProperties}
        >
          {site.imageUrl ? (
            <img
              src={site.imageUrl}
              alt={site.imageAlt ?? `Screenshot of ${site.title}`}
              loading="lazy"
            />
          ) : null}
          <span>{site.title}</span>
        </a>
      ))}
    </>
  );
}

export function GalleryIslands() {
  return (
    <>
      <Slot id="gallery-mount">
        <GalleryGrid />
      </Slot>
      <Slot id="class-strip-mount">
        <ClassStrip />
      </Slot>
    </>
  );
}
