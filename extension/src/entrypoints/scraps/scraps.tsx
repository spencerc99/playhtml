// ABOUTME: Full-tab extension page for browsing locally collected internet scraps.
// ABOUTME: Hosts the drifting browse collage and the create mode for making your own.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/lora/latin-400-italic.css";
import "@fontsource/lora/latin-600.css";
import "@fontsource/lora/latin-700.css";
import { groupPhotoEncounters } from "@movement/utils/scrapPhotoGroups";
import { ExtensionPageNav } from "../../components/ExtensionPageNav";
import {
  canonicalScrapKey,
  COLLAGE_STYLES,
  ScrapCollage,
  type ScrapItem,
} from "@movement/components/ScrapCollage";
import { toScrapItem, type ScrapRecord } from "./scrapItems";
import { useSettledFeatureState } from "../../features/useFeatureAccess";
import { parsePlaceHash, placeHash, type ScrapsPlace } from "./scrapsPlace";
import type { CollageRecord } from "./collageRecord";
import {
  inBackground,
  keepCollageImages,
  serveLocalScrapImages,
} from "./localScrapImages";

serveLocalScrapImages();

interface ScrapsResponse {
  scraps: ScrapRecord[];
  nextCursor: { ts: number; id: string } | null;
  error?: string;
}

function isScrapsResponse(
  response: ScrapsResponse | undefined,
): response is ScrapsResponse {
  return (
    !!response &&
    Array.isArray(response.scraps) &&
    !response.error &&
    (response.nextCursor === null ||
      (Number.isFinite(response.nextCursor?.ts) &&
        typeof response.nextCursor.id === "string"))
  );
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
const SCRAPS_PAGE_SIZE = 500;
const HISTORY_PAGE_SIZE = 1_000;

export function ScrapsPage() {
  const [records, setRecords] = useState<ScrapRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<ScrapsResponse["nextCursor"]>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState<ScrapsMode>("browse");
  const [editing, setEditing] = useState<CollageRecord | null>(null);
  const [studioOpen, setStudioOpen] = useState(false);
  /** Bumped when a studio is opened, so each editing session starts fresh. */
  const [studioSession, setStudioSession] = useState(0);
  const [savedRevision, setSavedRevision] = useState(0);
  const requestGeneration = useRef(0);
  const items = useMemo(
    () =>
      groupPhotoEncounters(records)
        .sort((a, b) => b.ts - a.ts)
        .map(toScrapItem),
    [records],
  );
  /**
   * Deletes every stored encounter of these scraps. The collage folds repeat
   * encounters into one scrap, so each is matched back to all of its records.
   */
  const deleteScraps = useCallback(
    async (doomed: ScrapItem[]) => {
      const canonicalKeys = new Set(doomed.map(canonicalScrapKey));
      const itemKeys = new Set(doomed.map((item) => item.key));
      const ids = records
        .filter((record) => {
          const item = toScrapItem(record);
          return (
            canonicalKeys.has(canonicalScrapKey(item)) || itemKeys.has(item.key)
          );
        })
        .map((record) => record.id);
      if (ids.length === 0) return;
      const response = (await browser.runtime.sendMessage({
        type: "DELETE_SCRAPS",
        ids,
      })) as { deleted?: number; error?: string } | undefined;
      if (!response || response.error || typeof response.deleted !== "number") {
        throw new Error(response?.error ?? "DELETE_SCRAPS returned no response");
      }
      const removed = new Set(ids);
      setRecords((current) =>
        current.filter((record) => !removed.has(record.id)),
      );
    },
    [records],
  );
  // Deleting before the whole archive has loaded would miss older encounters
  // of the same scrap, which would then reappear once they arrive.
  const archiveComplete = !loading && !error && nextCursor === null && !historyError;
  const [createMode, setCreateMode] = useState<
    typeof import("./CreateMode") | null
  >(null);
  const [createError, setCreateError] = useState(false);
  const seed = useMemo(() => Math.floor(Date.now() / 86_400_000), []);
  const collagesFeature = useSettledFeatureState("SCRAP_COLLAGES");
  const canCreate = collagesFeature?.enabled ?? false;
  /** The saved collage open in the studio, once it has an id to name. */
  const [openCollageId, setOpenCollageId] = useState<string | null>(null);
  /**
   * False until the place the URL named has been restored, and while a place
   * is being applied, so the URL is not rewritten from a half-set page.
   */
  const [placeSettled, setPlaceSettled] = useState(false);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (collagesFeature && !canCreate && mode === "create") setMode("browse");
  }, [collagesFeature, canCreate, mode]);

  const openStudio = (record: CollageRecord | null) => {
    if (record) inBackground(keepCollageImages(record));
    setEditing(record);
    setOpenCollageId(record?.id ?? null);
    setStudioSession((value) => value + 1);
    setStudioOpen(true);
  };

  const closeStudio = () => {
    setEditing(null);
    setOpenCollageId(null);
    setStudioOpen(false);
  };

  /** Puts the page where a URL says, loading a named collage first. */
  const applyPlace = useCallback(async (place: ScrapsPlace, creatable: boolean) => {
    if (place.mode === "browse" || !creatable) {
      setMode("browse");
      closeStudio();
      return;
    }
    setMode("create");
    if (place.collage === null) {
      closeStudio();
      return;
    }
    if (place.collage === "new") {
      openStudio(null);
      return;
    }
    const { loadCollage } = await import("./collageStore");
    const record = await loadCollage(place.collage.id);
    if (!record) {
      console.warn(`No collage ${place.collage.id} to reopen; showing the list`);
      closeStudio();
      return;
    }
    openStudio(record);
  }, []);

  // Once it is known whether collages can be made, go back to where the URL
  // says the page was.
  useEffect(() => {
    if (!collagesFeature || restoredRef.current) return;
    restoredRef.current = true;
    const wanted = parsePlaceHash(window.location.hash);
    applyPlace(wanted, collagesFeature.enabled)
      .catch((placeError: unknown) => {
        console.error("Could not restore the scraps page place:", placeError);
      })
      .finally(() => setPlaceSettled(true));
  }, [applyPlace, collagesFeature]);

  // Back and forward move between places like any other page.
  useEffect(() => {
    const onPop = () => {
      setPlaceSettled(false);
      applyPlace(parsePlaceHash(window.location.hash), canCreate)
        .catch((placeError: unknown) => {
          console.error("Could not move the scraps page:", placeError);
        })
        .finally(() => setPlaceSettled(true));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [applyPlace, canCreate]);

  const place: ScrapsPlace =
    mode === "browse"
      ? { mode: "browse" }
      : !studioOpen
        ? { mode: "create", collage: null }
        : openCollageId
          ? { mode: "create", collage: { id: openCollageId } }
          : { mode: "create", collage: "new" };
  const hash = placeHash(place);

  useEffect(() => {
    if (!placeSettled || hash === window.location.hash) return;
    const url = hash || `${window.location.pathname}${window.location.search}`;
    // A new collage that has just been saved is the same place under its
    // id, so it replaces the entry rather than adding a step to go back to.
    // This reads the live hash so it also holds after a reload of #create/new.
    if (window.location.hash === placeHash({ mode: "create", collage: "new" }) && hash.startsWith("#create/")) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", url);
    }
  }, [hash, placeSettled]);

  useEffect(() => {
    if (!canCreate || mode !== "create" || createMode) return;
    let cancelled = false;
    import("./CreateMode")
      .then((module) => {
        if (!cancelled) {
          setCreateMode(module);
          setCreateError(false);
        }
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setCreateError(true);
          console.error("Failed to load collage create mode:", loadError);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [canCreate, mode, createMode]);

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
    requestGeneration.current += 1;
    setLoading(true);
    setHistoryError(null);
    setRecords([]);
    setNextCursor(null);
    const loadScraps = async () => {
      try {
        const response = (await browser.runtime.sendMessage({
          type: "GET_SCRAPS",
          options: { limit: SCRAPS_PAGE_SIZE },
        })) as ScrapsResponse;
        if (!isScrapsResponse(response)) {
          throw new Error("GET_SCRAPS returned an invalid response");
        }
        if (!cancelled) {
          setRecords(response.scraps);
          setNextCursor(response.nextCursor);
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

  // The first page paints quickly; the rest of the archive follows in the
  // background so the count, collage, search, and filters cover everything.
  useEffect(() => {
    if (!nextCursor || loading || historyError) return;
    let cancelled = false;
    const generation = requestGeneration.current;

    const loadHistory = async () => {
      const olderRecords: ScrapRecord[] = [];
      let cursor: ScrapsResponse["nextCursor"] = nextCursor;
      try {
        while (cursor && !cancelled && generation === requestGeneration.current) {
          const response = (await browser.runtime.sendMessage({
            type: "GET_SCRAPS",
            options: { limit: HISTORY_PAGE_SIZE, cursor },
          })) as ScrapsResponse;
          if (!isScrapsResponse(response)) {
            throw new Error("GET_SCRAPS returned an invalid response");
          }
          olderRecords.push(...response.scraps);
          cursor = response.nextCursor;
        }
        if (!cancelled && generation === requestGeneration.current) {
          setRecords((current) => [...current, ...olderRecords]);
          setNextCursor(cursor);
          setHistoryError(null);
        }
      } catch (loadError) {
        if (!cancelled && generation === requestGeneration.current) {
          setHistoryError(
            loadError instanceof Error ? loadError.message : String(loadError),
          );
        }
      }
    };

    void loadHistory();
    return () => {
      cancelled = true;
    };
  }, [nextCursor, loading, historyError]);

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
      {canCreate && <style>{COLLAGE_STYLES}</style>}
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
        .collage-chip {
          padding: 3px 7px;
          border: 1px solid rgba(61, 56, 51, 0.18);
          border-radius: 3px;
          background: transparent;
          color: #827a72;
          font-family: "Martian Mono", monospace;
          font-size: 9px;
          letter-spacing: 0.03em;
          cursor: pointer;
        }
        .collage-chip:hover {
          border-color: rgba(61, 56, 51, 0.35);
          color: #3d3833;
        }
        .collage-chip--active {
          background: rgba(61, 56, 51, 0.08);
          border-color: rgba(61, 56, 51, 0.4);
          color: #3d3833;
        }
        .collage-mode-switch {
          display: inline-flex;
          gap: 3px;
          padding: 3px;
          border: 1px solid rgba(61, 56, 51, 0.16);
          border-radius: 4px;
          background: rgba(245, 240, 232, 0.9);
        }
        .scraps-heading { top: 14px; width: min(520px, calc(100vw - 320px)); }
        .scraps-stage { inset: 64px 0 0; }
        .scraps-history-error { position: absolute; top: 80px; right: 16px; z-index: 5; color: #827a72; font-size: 11px; }
        @media (max-width: 620px) {
          .scraps-heading { top: 48px; width: calc(100vw - 32px); }
          .scraps-stage { inset: 104px 0 0; }
          .scraps-history-error { top: 120px; }
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
          <ScrapCollage
            items={items}
            seed={seed}
            showKindFilter={true}
            onDeleteScraps={archiveComplete ? deleteScraps : undefined}
          />
        </div>
      )}

      {historyError && (
        <div role="alert" className="scraps-history-error">
          older scraps could not be gathered
        </div>
      )}

      {mode === "create" && !loading && !error && createMode && (
        <createMode.CreateMode
          items={items}
          editing={editing}
          studioOpen={studioOpen}
          studioSession={studioSession}
          savedRevision={savedRevision}
          onEdit={(record) => openStudio(record)}
          onStartNew={() => openStudio(null)}
          onSaved={(record) => {
            inBackground(keepCollageImages(record));
            setOpenCollageId(record.id);
            setSavedRevision((value) => value + 1);
          }}
          onLeave={closeStudio}
        />
      )}
      {mode === "create" && !loading && !error && !createMode && (
        <div style={centeredMessageStyle}>
          {createError ? "collage tools could not be opened" : "opening collage tools..."}
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
