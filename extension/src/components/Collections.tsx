// ABOUTME: Data collection settings screen for managing collector modes (off/local/shared)
// ABOUTME: Also handles keyboard privacy level and filter substring settings

import React, { useState, useEffect, useMemo, useRef } from "react";
import browser from "webextension-polyfill";
import { isExtensionPageUrl } from "../utils/extensionPage";
import { getValidEventTypes } from "@playhtml/extension-types";
import type { CollectionEvent } from "@playhtml/extension-types";
import { CollectorIcon } from "./icons";
import {
  collectionModeStorageKey,
  collectionModesFor,
  normalizeCollectionMode,
  type CollectionMode,
} from "../collectors/modes";
import { triggerDownload } from "../utils/portraitExport";
import { EXPORT_PAGE_SIZE, gzipExport } from "../utils/dataTransfer";
import {
  getPublicPlayerIdentity,
  getStoredPlayerIdentity,
} from "../storage/playerIdentity";
import {
  estimateRemainingMs,
  formatRemaining,
  readExportFiles,
  readExportHeader,
  type ExportContents,
} from "../utils/importStream";
import {
  browserName,
  eventSection,
  exportedCollages,
  exportedImages,
  importCollage,
  importIdentity,
  importImage,
  picturesToExport,
  readableCollageIds,
} from "../utils/transferSections";
import {
  ExportPicker,
  ExportProgress,
  ExportReady,
  ImportPreview,
  exportSummary,
  type ExportCounts,
  type ExportProgressRow,
  type IdentityPreview,
  type ImportWho,
  type SectionChoices,
} from "./TransferPanels";
import type { StatsRebuildProgress } from "../storage/LocalEventStore";
import {
  LEGIBILITY_KEY,
  DEFAULT_LEGIBILITY,
  parseLegibility,
  redactWithLegibility,
} from "../utils/keyboardRedaction";
import { useVisibleCollectorTypes } from "./useVisibleCollectorTypes";
import { DEV_MODE_KEY } from "../features/debugModes/debugModes";
import "./Collections.scss";

interface CollectionsProps {
  onBack?: () => void;
  visibleSection?: "all" | "data" | "your-data" | "developer";
}

const PRIVACY_LEVEL_KEY = LEGIBILITY_KEY;
const FILTER_SUBSTRINGS_KEY = "collection_keyboard_filter_substrings";

interface StorageStats {
  totalEvents: number;
  estimatedSizeBytes: number;
  estimatedSizeBytesByType?: Record<string, number>;
  localUsageBytes: number | null;
  oldestEvent: number;
  newestEvent?: number;
  countsByType: Record<string, number>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatCompactCount(count: number): string {
  if (count < 1000) return String(count);

  const formatDecimal = (value: number) =>
    (Math.floor(value * 10) / 10).toFixed(1);

  if (count < 10000) return `${formatDecimal(count / 1000)}K`;
  if (count < 1000000) return `${Math.floor(count / 1000)}K`;
  if (count < 10000000) return `${formatDecimal(count / 1000000)}M`;
  if (count < 1000000000) return `${Math.floor(count / 1000000)}M`;
  if (count < 10000000000) return `${formatDecimal(count / 1000000000)}B`;
  return `${Math.floor(count / 1000000000)}B`;
}

function formatAge(ts: number): string {
  if (!ts) return "";
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

interface ImportProgress {
  phase: "reading" | "finishing";
  bytesRead: number;
  totalBytes: number;
  eventsRead: number;
  startedAt: number;
  stats?: StatsProgress;
  /** One row per section, when the file says what it holds. */
  rows?: ExportProgressRow[];
}

interface StatsProgress {
  step: StatsRebuildProgress["step"];
  done: number;
  total: number;
  /** When this step began, for its time estimate. */
  stepStartedAt: number;
}

const STATS_STEP_ORDER: StatsRebuildProgress["step"][] = [
  "adding",
  "saving",
  "days",
];

function statsProgressLabel(stats: StatsProgress | undefined): {
  share: number | null;
  text: string;
} {
  if (!stats) return { share: null, text: "updating stats" };
  const number = STATS_STEP_ORDER.indexOf(stats.step) + 1;
  const prefix = `updating stats (${number} of ${STATS_STEP_ORDER.length})`;
  if (stats.total <= 0 || stats.step === "saving")
    return { share: null, text: prefix };
  const share = Math.min(stats.done / stats.total, 1);
  const remainingMs = estimateRemainingMs(
    Date.now() - stats.stepStartedAt,
    stats.done,
    stats.total,
  );
  return {
    share,
    text:
      `${prefix} · ${Math.floor(share * 100)}%` +
      (remainingMs === null ? "" : ` · ${formatRemaining(remainingMs)}`),
  };
}

/** Section rows, plus a stats row once every section is read. */
function importRowsWithStats(progress: ImportProgress): ExportProgressRow[] {
  const rows = progress.rows ?? [];
  if (progress.phase !== "finishing") return rows;
  const stats = statsProgressLabel(progress.stats);
  return [
    ...rows.map((row) => ({ ...row, state: "done" as const })),
    {
      label: "Updating stats",
      written: progress.stats?.done ?? 0,
      total: stats.share === null ? null : (progress.stats?.total ?? null),
      state: "packing",
      note: stats.text.replace(/^updating stats ?/, "").replace(/^· /, ""),
    },
  ];
}

function ImportProgressBar({ progress }: { progress: ImportProgress }) {
  let share: number | null;
  let label: string;
  if (progress.phase === "finishing") {
    const stats = statsProgressLabel(progress.stats);
    share = stats.share;
    label = stats.text;
  } else {
    share =
      progress.totalBytes > 0 ? progress.bytesRead / progress.totalBytes : 0;
    const remainingMs = estimateRemainingMs(
      Date.now() - progress.startedAt,
      progress.bytesRead,
      progress.totalBytes,
    );
    label =
      `${progress.eventsRead.toLocaleString()} events · ${Math.floor(
        share * 100,
      )}%` + (remainingMs === null ? "" : ` · ${formatRemaining(remainingMs)}`);
  }
  return (
    <div className="collections__import-progress" role="status">
      <div
        className={`collections__import-bar${
          share === null ? " collections__import-bar--waiting" : ""
        }`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={share === null ? undefined : Math.floor(share * 100)}
      >
        <div style={{ width: `${(share ?? 1) * 100}%` }} />
      </div>
      <span>{label}</span>
    </div>
  );
}

function getEventTypeCounts(countsByType: Record<string, number>) {
  const orderedTypes = getValidEventTypes();
  return orderedTypes
    .filter((type) => (countsByType[type] ?? 0) > 0)
    .map((type) => ({
      type,
      count: formatCompactCount(countsByType[type] ?? 0),
    }));
}

// ── Shared collector list UI ──────────────────────────────────────────────────
// Renders collector cards with off/local/shared radio controls and the keyboard
// privacy level sub-setting. Used by both Collections and SetupPage.

interface CollectorListProps {
  modes: Record<string, CollectionMode>;
  onModeChange: (type: string, mode: CollectionMode) => void;
  keyboardLegibilityPct: number;
  onKeyboardLegibilityChange: (pct: number) => void;
}

const COLLECTOR_DESCRIPTIONS: Record<string, string> = {
  cursor: "Captures cursor movement, clicks, holds, and cursor style changes",
  keyboard: "Captures typing frequency and location",
  viewport: "Captures scroll position and viewport changes",
  navigation: "Captures page navigation and session timing",
  element:
    "Captures small scraps like images, buttons, icons, and cursors from pages you visit",
};

// ── Keyboard legibility preview ──────────────────────────────────────────────
// Shows a before/after so users can see how legibility % maps to recorded text.
// The sample contains an email so the always-on PII redaction stays visible.

const SAMPLE_TYPED_TEXT = "email hi@spencer.place with feedback!";

const LEGIBILITY_STOPS = [
  { value: 0, label: "Cadence only" },
  { value: 50, label: "Partial" },
  { value: 100, label: "Full text" },
] as const;

function legibilityLabel(pct: number): string {
  if (pct <= 0) return "Cadence only";
  if (pct >= 100) return "Full text";
  if (pct === 50) return "Partial";
  return `${pct}% legible`;
}

function legibilityDescription(pct: number): string {
  if (pct <= 0) return "Typing frequency and location only (no text)";
  if (pct >= 100) return "Typed text recorded (emails, phones, SSNs redacted)";
  return `About ${pct}% of characters kept; the rest redacted (PII always redacted)`;
}

function KeyboardLegibilityPreview({ pct }: { pct: number }) {
  // Seed stays stable across renders for a given preview so the pattern
  // doesn't flicker while the user drags the slider.
  const output = useMemo(
    () => redactWithLegibility(SAMPLE_TYPED_TEXT, pct, 1),
    [pct],
  );
  return (
    <div className="collector-card__privacy-preview">
      <div className="collector-card__privacy-preview-row">
        <span className="collector-card__privacy-preview-label">You type</span>
        <span className="collector-card__privacy-preview-value">
          {SAMPLE_TYPED_TEXT}
        </span>
      </div>
      <div className="collector-card__privacy-preview-row">
        <span className="collector-card__privacy-preview-label">We record</span>
        <span className="collector-card__privacy-preview-value collector-card__privacy-preview-value--recorded">
          {output}
        </span>
      </div>
    </div>
  );
}

export function CollectorList({
  modes,
  onModeChange,
  keyboardLegibilityPct,
  onKeyboardLegibilityChange,
}: CollectorListProps) {
  const types = useVisibleCollectorTypes();
  return (
    <div className="collections__collector-list">
      {types.map((type) => {
        const mode = modes[type] ?? "off";
        const isActive = mode !== "off";
        const availableModes = collectionModesFor(type);
        const modifier =
          mode === "shared"
            ? " collector-card--shared"
            : mode === "local"
              ? " collector-card--local"
              : "";
        return (
          <div key={type} className={`collector-card${modifier}`}>
            <div className="collector-card__row">
              <div className="collector-card__title-row">
                <span aria-hidden className="collector-card__icon">
                  <CollectorIcon type={type} />
                </span>
                <h3 className="collector-card__name">{type}</h3>
              </div>
              <div className="collector-card__modes">
                {availableModes.map((opt) => (
                  <label key={opt}>
                    <input
                      type="radio"
                      name={`mode-${type}`}
                      value={opt}
                      checked={
                        normalizeCollectionMode(type, modes[type]) === opt
                      }
                      onChange={() => onModeChange(type, opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
            <p className="collector-card__description">
              {COLLECTOR_DESCRIPTIONS[type] ?? ""}
            </p>
            {type === "keyboard" && isActive && (
              <div className="collector-card__privacy-section">
                <div className="collector-card__privacy-header">
                  <div>
                    <label className="collector-card__privacy-label">
                      Keyboard legibility —{" "}
                      {legibilityLabel(keyboardLegibilityPct)}
                    </label>
                    <p className="collector-card__privacy-desc">
                      {legibilityDescription(keyboardLegibilityPct)}
                    </p>
                  </div>
                </div>
                <div className="collector-card__legibility-slider">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={keyboardLegibilityPct}
                    onChange={(e) =>
                      onKeyboardLegibilityChange(Number(e.target.value))
                    }
                    list="legibility-stops"
                    aria-label="Keyboard legibility"
                  />
                  <datalist id="legibility-stops">
                    {LEGIBILITY_STOPS.map((s) => (
                      <option key={s.value} value={s.value} label={s.label} />
                    ))}
                  </datalist>
                  <div className="collector-card__legibility-stops">
                    {LEGIBILITY_STOPS.map((s) => (
                      <button
                        key={s.value}
                        type="button"
                        className={
                          "collector-card__legibility-stop" +
                          (keyboardLegibilityPct === s.value
                            ? " collector-card__legibility-stop--active"
                            : "")
                        }
                        onClick={() => onKeyboardLegibilityChange(s.value)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <KeyboardLegibilityPreview pct={keyboardLegibilityPct} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function Collections({
  onBack,
  visibleSection = "all",
}: CollectionsProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyboardLegibilityPct, setKeyboardLegibilityPct] =
    useState<number>(DEFAULT_LEGIBILITY);
  const [filterSubstrings, setFilterSubstrings] = useState<string[]>([]);
  const [newFilterSubstring, setNewFilterSubstring] = useState("");
  const [modes, setModes] = useState<Record<string, CollectionMode>>({});
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [transferStatus, setTransferStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportChoices, setExportChoices] = useState<SectionChoices | null>(
    null,
  );
  const [exportCollageCount, setExportCollageCount] = useState<number | null>(
    null,
  );
  const [youPreview, setYouPreview] = useState<IdentityPreview | null>(null);
  const [exportRows, setExportRows] = useState<ExportProgressRow[] | null>(
    null,
  );
  const [exportReady, setExportReady] = useState<{
    fileName: string;
    bytes: number;
    summary: string;
  } | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    files: File[];
    title: string;
    packedOn: string | null;
    contents: ExportContents | null;
    choices: SectionChoices;
    who: ImportWho;
  } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null,
  );
  const [isRestoring, setIsRestoring] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visibleSection === "all") loadCollectors();
    else setIsLoading(false);
    if (
      visibleSection === "all" ||
      visibleSection === "data" ||
      visibleSection === "your-data"
    ) {
      loadPrivacyLevel();
      loadFilterSubstrings();
      loadModes();
    }
    if (visibleSection === "all" || visibleSection === "your-data") {
      loadStorageStats();
    }
    if (
      visibleSection === "all" ||
      visibleSection === "your-data" ||
      visibleSection === "developer"
    ) {
      loadDevMode();
    }
  }, [visibleSection]);

  useEffect(() => {
    const handleStorageChange = (
      changes: Record<string, browser.Storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName === "local" && changes[DEV_MODE_KEY]) {
        setDevMode(Boolean(changes[DEV_MODE_KEY].newValue));
      }
    };
    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  const loadDevMode = async () => {
    try {
      const result = await browser.storage.local.get([DEV_MODE_KEY]);
      setDevMode(Boolean(result[DEV_MODE_KEY]));
    } catch {
      setDevMode(false);
    }
  };

  const toggleDevMode = async (enabled: boolean) => {
    try {
      await browser.storage.local.set({ [DEV_MODE_KEY]: enabled });
      setDevMode(enabled);
    } catch (e) {
      console.error("Failed to update dev mode:", e);
    }
  };

  const [clearConfirmPending, setClearConfirmPending] = useState(false);

  const clearAllData = async () => {
    if (!clearConfirmPending) {
      setClearConfirmPending(true);
      // Auto-reset after 3 seconds if user doesn't confirm
      setTimeout(() => setClearConfirmPending(false), 3000);
      return;
    }
    setClearConfirmPending(false);
    try {
      const response = await browser.runtime.sendMessage({
        type: "CLEAR_ALL_EVENTS",
      });
      if (response?.success) {
        await loadStorageStats();
      } else {
        alert("Failed to clear data. Please try again.");
      }
    } catch {
      alert("Failed to clear data. Please try again.");
    }
  };

  const loadStorageStats = async () => {
    try {
      const response = await browser.runtime.sendMessage({
        type: "GET_STORAGE_STATS",
      });
      if (response?.success && response.stats) {
        setStorageStats(response.stats);
      }
    } catch {
      // Non-fatal; stats pane just won't show
    }
  };

  const loadModes = async () => {
    try {
      const types = getValidEventTypes();
      // Every valid type is read so a dev-enabled collector keeps its saved
      // mode, but only the visible ones are rendered.
      const keys = types.map((t) => collectionModeStorageKey(t));
      const result = await browser.storage.local.get(keys);
      const next: Record<string, CollectionMode> = {};
      for (const t of types) {
        next[t] = normalizeCollectionMode(
          t,
          result[collectionModeStorageKey(t)],
        );
      }
      setModes(next);
      const toSet: Record<string, string> = {};
      for (const t of types) {
        if (result[collectionModeStorageKey(t)] !== next[t])
          toSet[collectionModeStorageKey(t)] = next[t];
      }
      if (Object.keys(toSet).length > 0) await browser.storage.local.set(toSet);
    } catch (e) {
      // ignore
    }
  };

  const updateMode = async (type: string, mode: CollectionMode) => {
    try {
      await browser.storage.local.set({
        [collectionModeStorageKey(type)]: mode,
      });
      setModes((prev) => ({ ...prev, [type]: mode }));

      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id && (!tab.url || !isExtensionPageUrl(tab.url))) {
        if (mode === "off") {
          await browser.tabs.sendMessage(tab.id, {
            type: "DISABLE_COLLECTOR",
            collectorType: type,
          });
        } else {
          await browser.tabs.sendMessage(tab.id, {
            type: "ENABLE_COLLECTOR",
            collectorType: type,
          });
        }
      }
    } catch (e) {
      alert("Failed to update mode. Please try again.");
    }
  };

  const loadPrivacyLevel = async () => {
    try {
      const result = await browser.storage.local.get([PRIVACY_LEVEL_KEY]);
      const raw = result[PRIVACY_LEVEL_KEY];
      const pct = parseLegibility(raw);
      setKeyboardLegibilityPct(pct);
      if (typeof raw !== "number") {
        await browser.storage.local.set({ [PRIVACY_LEVEL_KEY]: pct });
      }
    } catch (error) {
      console.error("Failed to load keyboard legibility:", error);
      setKeyboardLegibilityPct(DEFAULT_LEGIBILITY);
    }
  };

  const updatePrivacyLevel = async (pct: number) => {
    try {
      const clamped = Math.max(0, Math.min(100, Math.round(pct)));
      await browser.storage.local.set({ [PRIVACY_LEVEL_KEY]: clamped });
      setKeyboardLegibilityPct(clamped);
    } catch (error) {
      console.error("Failed to update keyboard legibility:", error);
      alert("Failed to update keyboard legibility. Please try again.");
    }
  };

  const loadFilterSubstrings = async () => {
    try {
      const result = await browser.storage.local.get([FILTER_SUBSTRINGS_KEY]);
      const substrings = result[FILTER_SUBSTRINGS_KEY];
      if (Array.isArray(substrings)) {
        setFilterSubstrings(substrings);
      } else {
        // Default to empty array if not set
        setFilterSubstrings([]);
        await browser.storage.local.set({ [FILTER_SUBSTRINGS_KEY]: [] });
      }
    } catch (error) {
      console.error("Failed to load filter substrings:", error);
      setFilterSubstrings([]);
    }
  };

  const addFilterSubstring = async () => {
    const trimmed = newFilterSubstring.trim();
    if (!trimmed) {
      alert("Please enter a substring to filter");
      return;
    }

    if (filterSubstrings.includes(trimmed)) {
      alert("This substring is already in the filter list");
      return;
    }

    try {
      const updated = [...filterSubstrings, trimmed];
      await browser.storage.local.set({ [FILTER_SUBSTRINGS_KEY]: updated });
      setFilterSubstrings(updated);
      setNewFilterSubstring("");
    } catch (error) {
      console.error("Failed to add filter substring:", error);
      alert("Failed to add filter substring. Please try again.");
    }
  };

  const removeFilterSubstring = async (substring: string) => {
    try {
      const updated = filterSubstrings.filter((s) => s !== substring);
      await browser.storage.local.set({ [FILTER_SUBSTRINGS_KEY]: updated });
      setFilterSubstrings(updated);
    } catch (error) {
      console.error("Failed to remove filter substring:", error);
      alert("Failed to remove filter substring. Please try again.");
    }
  };

  const exportOpen = !!(exportChoices || exportRows || exportReady);
  const importOpen = !!(pendingImport || importProgress);

  const loadYouPreview = () => {
    getPublicPlayerIdentity()
      .then((identity) =>
        setYouPreview(
          identity
            ? {
                color: identity.playerStyle.colorPalette[0] ?? "#b5aea5",
                id: identity.publicKey,
                name: identity.name,
              }
            : null,
        ),
      )
      .catch(() => {});
  };

  const openExportPicker = async () => {
    setTransferStatus(null);
    setExportReady(null);
    setExportChoices({ history: true, scraps: true, collages: true, you: false });
    setExportCollageCount(null);
    readableCollageIds()
      .then((ids) => setExportCollageCount(ids.length))
      .catch(() => setExportCollageCount(null));
    loadYouPreview();
  };

  const exportCounts = (): ExportCounts => {
    const counts = storageStats?.countsByType ?? {};
    const scraps = counts.element ?? 0;
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return { history: total - scraps, scraps, collages: exportCollageCount };
  };

  const handleExport = async (choices: SectionChoices) => {
    setExportChoices(null);
    setIsExporting(true);
    setTransferStatus(null);
    const counts = exportCounts();
    const withEvents = choices.history || choices.scraps;
    try {
      const collageIds = choices.collages ? await readableCollageIds() : [];
      const pictures = await picturesToExport(choices.scraps, choices.collages);
      const you = choices.you ? await getStoredPlayerIdentity() : null;
      const contents: ExportContents = {
        ...(choices.history ? { history: counts.history } : {}),
        ...(choices.scraps ? { scraps: counts.scraps } : {}),
        ...(choices.collages ? { collages: collageIds.length } : {}),
        ...(pictures.size > 0 ? { pictures: pictures.size } : {}),
        ...(you
          ? {
              you: true,
              youColor: you.public.playerStyle.colorPalette[0],
              youId: you.public.publicKey,
              ...(you.public.name ? { youName: you.public.name } : {}),
            }
          : {}),
      };

      type RowKey = "events" | "images" | "collages";
      const rowOrder: { key: RowKey; label: string; total: number }[] = [];
      if (withEvents)
        rowOrder.push({
          key: "events",
          label:
            choices.history && choices.scraps
              ? "Browsing history and scraps"
              : choices.history
                ? "Browsing history"
                : "Scraps",
          total:
            (choices.history ? counts.history : 0) +
            (choices.scraps ? counts.scraps : 0),
        });
      if (pictures.size > 0)
        rowOrder.push({ key: "images", label: "Saved pictures", total: pictures.size });
      if (choices.collages)
        rowOrder.push({ key: "collages", label: "Collages", total: collageIds.length });
      const written: Record<RowKey, number> = { events: 0, images: 0, collages: 0 };
      let current = 0;
      const showRows = () =>
        setExportRows(
          rowOrder.map((row, index) => ({
            label: row.label,
            written: written[row.key],
            total: row.total,
            state: index < current ? "done" : index === current ? "packing" : "waiting",
          })),
        );
      showRows();

      let afterId: string | null = null;
      let done = !withEvents;
      const readPage = async (): Promise<CollectionEvent[] | null> => {
        if (done) return null;
        const response = await browser.runtime.sendMessage({
          type: "EXPORT_EVENT_PAGE",
          afterId,
          limit: EXPORT_PAGE_SIZE,
        });
        if (!response?.success)
          throw new Error(response?.error ?? "Export failed");
        afterId = response.nextAfterId ?? null;
        if (afterId === null) done = true;
        return (response.events as CollectionEvent[]).filter(
          (event) => choices[eventSection(event.type)],
        );
      };
      const advanceTo = (key: RowKey) => {
        const index = rowOrder.findIndex((row) => row.key === key);
        if (index > current) current = index;
      };
      async function* tracked<T>(key: RowKey, items: AsyncIterable<T>) {
        advanceTo(key);
        showRows();
        yield* items;
      }

      const blob = await gzipExport({
        exportedAt: Date.now(),
        contents,
        packedIn: browserName(navigator.userAgent),
        readEventPage: readPage,
        images:
          pictures.size > 0
            ? tracked("images", exportedImages(pictures))
            : undefined,
        collages: choices.collages
          ? tracked("collages", exportedCollages(collageIds))
          : undefined,
        identity: await getPublicPlayerIdentity(),
        you,
        onProgress: (section, count) => {
          written[section] = count;
          advanceTo(section);
          showRows();
        },
      });
      current = rowOrder.length;
      showRows();

      const date = new Date().toISOString().slice(0, 10);
      const fileName = `we-were-online-${date}.json.gz`;
      triggerDownload(blob, fileName);
      setExportReady({
        fileName,
        bytes: blob.size,
        summary: exportSummary(choices, {
          scraps: counts.scraps,
          collages: written.collages,
        }),
      });
    } catch (e: any) {
      setTransferStatus({
        type: "error",
        message: `Export failed: ${e.message}`,
      });
    } finally {
      setIsExporting(false);
      setExportRows(null);
    }
  };

  const handleRestoreFromServer = async () => {
    setIsRestoring(true);
    setTransferStatus(null);
    try {
      const response = await browser.runtime.sendMessage({
        type: "RESTORE_FROM_SERVER",
      });
      if (!response?.success) {
        throw new Error(response?.error ?? "Restore failed");
      }
      const counts = response.countsByType as
        | Record<string, number>
        | undefined;
      const countDetail = counts
        ? Object.entries(counts)
            .filter(([, n]) => n > 0)
            .map(([t, n]) => `${n} ${t}`)
            .join(", ")
        : "";
      setTransferStatus({
        type: "success",
        message: `Restored ${response.imported.toLocaleString()} events${
          countDetail ? ` (${countDetail})` : ""
        }.`,
      });
      await loadStorageStats();
    } catch (e: any) {
      setTransferStatus({
        type: "error",
        message: `Restore failed: ${e.message}`,
      });
    } finally {
      setIsRestoring(false);
    }
  };

  const listenForStatsProgress = () => {
    const listener = (message: any) => {
      if (message?.type !== "IMPORT_STATS_PROGRESS") return;
      const { step, done, total } = message as StatsRebuildProgress;
      setImportProgress((current) => {
        if (!current) return current;
        const stepStartedAt =
          current.stats?.step === step
            ? current.stats.stepStartedAt
            : Date.now();
        return { ...current, stats: { step, done, total, stepStartedAt } };
      });
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  };

  const previewImport = async (files: File[]) => {
    setTransferStatus(null);
    setExportReady(null);
    try {
      const headers = await Promise.all(files.map(readExportHeader));
      // Older files say nothing about what they hold.
      const described = headers.every((header) => header.contents);
      const contents: ExportContents | null = described
        ? headers.reduce<ExportContents>((sum, header) => {
            const c = header.contents ?? {};
            return {
              history: (sum.history ?? 0) + (c.history ?? 0),
              scraps: (sum.scraps ?? 0) + (c.scraps ?? 0),
              collages: (sum.collages ?? 0) + (c.collages ?? 0),
              pictures: (sum.pictures ?? 0) + (c.pictures ?? 0),
              you: sum.you || c.you,
              youColor: sum.youColor ?? c.youColor,
              youId: sum.youId ?? c.youId,
              youName: sum.youName ?? c.youName,
            };
          }, {})
        : null;
      const first = headers[0];
      const packedOn =
        files.length === 1 && first.exportedAt
          ? new Date(first.exportedAt).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year:
                new Date(first.exportedAt).getFullYear() ===
                new Date().getFullYear()
                  ? undefined
                  : "numeric",
            }) + (first.packedIn ? ` in ${first.packedIn}` : "")
          : null;
      loadYouPreview();
      setPendingImport({
        files,
        title: files.length === 1 ? files[0].name : `${files.length} files`,
        packedOn,
        contents,
        choices: { history: true, scraps: true, collages: true, you: true },
        who: "file",
      });
    } catch (e: any) {
      setTransferStatus({
        type: "error",
        message: `Import failed: ${e.message}`,
      });
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  const handleImportFiles = async (
    files: File[],
    choices: SectionChoices = {
      history: true,
      scraps: true,
      collages: true,
      you: false,
    },
    contents: ExportContents | null = null,
  ) => {
    setPendingImport(null);
    let stopStatsProgress = () => {};
    setIsImporting(true);
    setTransferStatus(null);
    const startedAt = Date.now();
    let imported = 0;
    let alreadyHeld = 0;
    let scrapsAdded = false;
    let collagesAdded = 0;
    let becameYou = false;
    let readAll = false;

    // Rows follow the file's order: events, then pictures, then collages.
    type RowKey = "events" | "images" | "collages";
    const rowOrder: { key: RowKey; label: string; total: number }[] = [];
    if (contents) {
      const history = choices.history && (contents.history ?? 0) > 0;
      const scraps = choices.scraps && (contents.scraps ?? 0) > 0;
      if (history || scraps)
        rowOrder.push({
          key: "events",
          label:
            history && scraps
              ? "Browsing history and scraps"
              : history
                ? "Browsing history"
                : "Scraps",
          total:
            (history ? (contents.history ?? 0) : 0) +
            (scraps ? (contents.scraps ?? 0) : 0),
        });
      if ((choices.scraps || choices.collages) && (contents.pictures ?? 0) > 0)
        rowOrder.push({
          key: "images",
          label: "Saved pictures",
          total: contents.pictures ?? 0,
        });
      if (choices.collages && (contents.collages ?? 0) > 0)
        rowOrder.push({
          key: "collages",
          label: "Collages",
          total: contents.collages ?? 0,
        });
    }
    const rowsRead: Record<RowKey, number> = {
      events: 0,
      images: 0,
      collages: 0,
    };
    let currentRow = 0;
    const advanceRowTo = (key: RowKey) => {
      const index = rowOrder.findIndex((row) => row.key === key);
      if (index > currentRow) currentRow = index;
    };
    const progressRows = (): ExportProgressRow[] | undefined =>
      contents
        ? rowOrder.map((row, index) => ({
            label: row.label,
            written: rowsRead[row.key],
            total: row.total,
            state:
              index < currentRow
                ? "done"
                : index === currentRow
                  ? "packing"
                  : "waiting",
          }))
        : undefined;

    setImportProgress({
      phase: "reading",
      bytesRead: 0,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      eventsRead: 0,
      startedAt,
      rows: progressRows(),
    });
    // Count everything stored so far in the stats. The background skips the
    // rebuild when nothing is waiting to be counted.
    const finishImport = async () => {
      setImportProgress((current) =>
        current ? { ...current, phase: "finishing" } : current,
      );
      stopStatsProgress = listenForStatsProgress();
      const response = await browser.runtime.sendMessage({
        type: "FINISH_IMPORT",
        scrapsAdded,
      });
      if (!response?.success)
        throw new Error(response?.error ?? "Import failed");
    };
    try {
      await readExportFiles(
        files,
        async (batch, progress) => {
          const events = batch.filter(
            (event) => choices[eventSection(event.type)],
          );
          rowsRead.events += events.length;
          if (events.length > 0) {
            const response = await browser.runtime.sendMessage({
              type: "IMPORT_EVENT_BATCH",
              events,
            });
            if (!response?.success)
              throw new Error(response?.error ?? "Import failed");
            imported += response.imported;
            alreadyHeld += response.alreadyHeld;
            scrapsAdded ||= response.scrapsAdded;
          }
          setImportProgress({
            phase: "reading",
            ...progress,
            startedAt,
            rows: progressRows(),
          });
        },
        async (item, progress) => {
          if (item.section === "images") {
            if (choices.scraps || choices.collages) {
              advanceRowTo("images");
              await importImage(item.value);
              rowsRead.images++;
            }
          } else if (item.section === "collages") {
            if (choices.collages) {
              advanceRowTo("collages");
              if ((await importCollage(item.value)) === "added") collagesAdded++;
              rowsRead.collages++;
            }
          } else if (item.section === "you") {
            if (choices.you) becameYou = await importIdentity(item.value);
          }
          setImportProgress({
            phase: "reading",
            ...progress,
            startedAt,
            rows: progressRows(),
          });
        },
      );
      readAll = true;
      await finishImport();
      setImportProgress(null);
      setTransferStatus({
        type: "success",
        message:
          `Imported ${imported.toLocaleString()} events` +
          (alreadyHeld > 0
            ? ` (${alreadyHeld.toLocaleString()} already here)`
            : "") +
          (collagesAdded > 0
            ? ` and ${collagesAdded.toLocaleString()} ${collagesAdded === 1 ? "collage" : "collages"}`
            : "") +
          "." +
          (becameYou
            ? " You're the same you here now. Reload open tabs to see it."
            : ""),
      });
      await loadStorageStats();
    } catch (e: any) {
      // Reading stopped partway: still count the batches already saved.
      if (!readAll && imported > 0) {
        await finishImport()
          .then(loadStorageStats)
          .catch((finishError) =>
            console.error("Counting imported events failed:", finishError),
          );
      }
      setTransferStatus({
        type: "error",
        message:
          `Import failed: ${e.message}` +
          (imported > 0
            ? ` (${imported.toLocaleString()} saved; import again to continue)`
            : ""),
      });
    } finally {
      stopStatsProgress();
      setIsImporting(false);
      setImportProgress(null);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  /**
   * Checks that the active tab's content script answers, so the full view can
   * say when it is open on a page the extension cannot reach.
   */
  const loadCollectors = async () => {
    try {
      const [tab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        throw new Error("No active tab found");
      }

      // Check if tab URL is accessible (not chrome:// or extension://)
      if (
        tab.url &&
        (tab.url.startsWith("chrome://") || isExtensionPageUrl(tab.url))
      ) {
        throw new Error("Content script not available on this page");
      }

      const response = await browser.tabs.sendMessage(tab.id, {
        type: "GET_COLLECTOR_STATUSES",
      });

      if (response?.error) {
        console.warn("Collector manager not initialized:", response.error);
      }
      setError(null);
    } catch (error: any) {
      console.error("Failed to load collectors:", error);
      setError(
        "Unable to connect to content script. Make sure you're on a regular webpage (not chrome:// pages).",
      );
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading && visibleSection === "all") {
    return <div className="collections__loading">Loading collections...</div>;
  }

  const eventTypeCounts = storageStats
    ? getEventTypeCounts(storageStats.countsByType)
    : [];
  const scrapSizeBytes = storageStats?.estimatedSizeBytesByType?.element;
  const hasActiveCollection = Object.values(modes).some(
    (mode) => mode !== "off",
  );

  return (
    <div className="collections">
      {visibleSection === "all" && (
        <header className="collections__header">
          {onBack && (
            <button onClick={onBack} className="back-btn">
              ← back
            </button>
          )}
          <h1>Data Collection Settings</h1>
          <p className="collections__header-desc">
            Control what's collected and whether it's shared
          </p>
        </header>
      )}

      <main className="collections__main">
        {(visibleSection === "all" || visibleSection === "data") && (
          <>
            {visibleSection === "all" && error && (
              <div className="collections__error">
                <strong>△ {error}</strong>
                <br />
                <span>
                  Try refreshing the page or navigating to a regular website.
                </span>
              </div>
            )}

            <div className="collections__context">
              {Object.values(modes).some((m) => m === "shared") ? (
                <>
                  <strong>Participating in</strong>{" "}
                  <a
                    href="https://spencer.place/creation/internet-movement"
                    target="_blank"
                    rel="noreferrer"
                    className="collections__context-link"
                  >
                    Internet Movement
                  </a>
                  <br />
                  <span>
                    Thank you for contributing to a living, collective portrait
                    of the internet.
                  </span>
                </>
              ) : (
                <>
                  <strong>Not participating in</strong>{" "}
                  <a
                    href="https://spencer.place/creation/internet-movement"
                    target="_blank"
                    rel="noreferrer"
                    className="collections__context-link"
                  >
                    Internet Movement
                  </a>
                  <br />
                  <span>Your browsing data is only staying local.</span>
                </>
              )}
            </div>

            <CollectorList
              modes={modes}
              onModeChange={updateMode}
              keyboardLegibilityPct={keyboardLegibilityPct}
              onKeyboardLegibilityChange={updatePrivacyLevel}
            />

            {/* Filter substrings — only when keyboard is active and any text is legible */}
            {(modes["keyboard"] ?? "local") !== "off" &&
              keyboardLegibilityPct > 0 && (
                <div className="collector-card__filter-section">
                  <label className="collector-card__filter-label">
                    Filter Sensitive Text
                  </label>
                  <p className="collector-card__filter-desc">
                    Sequences containing these substrings will be redacted
                  </p>
                  <div className="collector-card__filter-input-row">
                    <input
                      type="text"
                      value={newFilterSubstring}
                      onChange={(e) => setNewFilterSubstring(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === "Enter") addFilterSubstring();
                      }}
                      placeholder="Enter substring..."
                    />
                    <button onClick={addFilterSubstring}>Add</button>
                  </div>
                  {filterSubstrings.length > 0 && (
                    <div className="collector-card__filter-tags">
                      {filterSubstrings.map((substring) => (
                        <div
                          key={substring}
                          className="collector-card__filter-tag"
                        >
                          <span>{substring}</span>
                          <button
                            onClick={() => removeFilterSubstring(substring)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {filterSubstrings.length === 0 && (
                    <p className="collector-card__filter-empty">
                      No filters added yet
                    </p>
                  )}
                </div>
              )}

            <div className="collections__privacy-notice">
              {keyboardLegibilityPct > 0 &&
              (modes["keyboard"] ?? "local") !== "off" ? (
                <>
                  Keyboard legibility is above 0, so some typed text is
                  recorded. Use filters above to redact sensitive content. All
                  other data is anonymous.{" "}
                  <a href="mailto:hi@spencer.place">hi@spencer.place</a>
                </>
              ) : (
                <>
                  All data is anonymous & no personal info is collected. Pause
                  collection anytime. Questions?{" "}
                  <a href="mailto:hi@spencer.place">hi@spencer.place</a>
                </>
              )}
            </div>
          </>
        )}

        {(visibleSection === "all" || visibleSection === "your-data") && (
          <>
            {storageStats && hasActiveCollection && (
              <div className="collections__storage-summary">
                <h3 className="collections__storage-title">Local database</h3>
                <div className="collections__stats">
                  <div className="collections__stat">
                    <span className="collections__stat-value">
                      {storageStats.localUsageBytes === null
                        ? "unknown"
                        : formatSize(storageStats.localUsageBytes)}
                    </span>
                    <span className="collections__stat-label">
                      local storage
                    </span>
                  </div>
                  <div className="collections__stat">
                    <span className="collections__stat-value">
                      {formatCompactCount(storageStats.totalEvents)}
                    </span>
                    <span className="collections__stat-label">events</span>
                  </div>
                  <div className="collections__stat">
                    <span className="collections__stat-value">
                      {formatSize(storageStats.estimatedSizeBytes)}
                    </span>
                    <span className="collections__stat-label">event data</span>
                  </div>
                  {scrapSizeBytes !== undefined && (
                    <div className="collections__stat">
                      <span className="collections__stat-value">
                        {formatSize(scrapSizeBytes)}
                      </span>
                      <span className="collections__stat-label">
                        internet scraps
                      </span>
                    </div>
                  )}
                  {storageStats.oldestEvent > 0 && (
                    <div className="collections__stat">
                      <span className="collections__stat-value">
                        {formatAge(storageStats.oldestEvent)}
                      </span>
                      <span className="collections__stat-label">
                        collecting
                      </span>
                    </div>
                  )}
                </div>
                {eventTypeCounts.length > 0 && (
                  <div className="collections__stats-detail">
                    {eventTypeCounts.map(({ type, count }) => (
                      <span
                        key={type}
                        className="collections__stats-detail-item"
                        aria-label={`${type} events: ${count}`}
                        title={`${type} events: ${count}`}
                      >
                        <span
                          aria-hidden
                          className="collections__stats-detail-icon"
                        >
                          <CollectorIcon type={type} size={10} />
                        </span>
                        <span className="collections__stats-detail-count">
                          {count}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="collections__transfer">
              <div className="collections__transfer-buttons">
                <button
                  className={`collections__transfer-btn${
                    exportOpen ? " collections__transfer-btn--active" : ""
                  }`}
                  aria-pressed={exportOpen}
                  onClick={() => {
                    setPendingImport(null);
                    if (exportOpen) {
                      setExportChoices(null);
                      setExportReady(null);
                    } else openExportPicker();
                  }}
                  disabled={isExporting || isImporting}
                >
                  {isExporting ? "Exporting…" : "Export data"}
                </button>
                <button
                  className={`collections__transfer-btn${
                    importOpen ? " collections__transfer-btn--active" : ""
                  }`}
                  aria-pressed={importOpen}
                  onClick={() => {
                    setExportChoices(null);
                    setExportReady(null);
                    if (pendingImport) setPendingImport(null);
                    else importInputRef.current?.click();
                  }}
                  disabled={isExporting || isImporting}
                >
                  {isImporting ? "Importing…" : "Import data"}
                </button>
                {devMode && (
                  <button
                    className="collections__transfer-btn"
                    onClick={handleRestoreFromServer}
                    disabled={isExporting || isImporting || isRestoring}
                    title="Fetch your shared events from the server and merge into local store"
                  >
                    {isRestoring ? "Restoring…" : "Restore from server"}
                  </button>
                )}
              </div>
              <input
                ref={importInputRef}
                type="file"
                accept=".json.gz"
                multiple
                style={{ display: "none" }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) previewImport(files);
                }}
              />
              {exportChoices && !isExporting && (
                <ExportPicker
                  counts={exportCounts()}
                  choices={exportChoices}
                  onChange={setExportChoices}
                  onExport={() => handleExport(exportChoices)}
                  onCancel={() => setExportChoices(null)}
                  you={youPreview}
                />
              )}
              {exportRows && <ExportProgress rows={exportRows} />}
              {exportReady && (
                <ExportReady
                  {...exportReady}
                  onDone={() => setExportReady(null)}
                />
              )}
              {pendingImport && !isImporting && (
                <ImportPreview
                  title={pendingImport.title}
                  packedOn={pendingImport.packedOn}
                  contents={pendingImport.contents}
                  choices={pendingImport.choices}
                  onChange={(choices) =>
                    setPendingImport({ ...pendingImport, choices })
                  }
                  who={pendingImport.who}
                  onWhoChange={(who) =>
                    setPendingImport({ ...pendingImport, who })
                  }
                  here={youPreview}
                  onImport={() =>
                    handleImportFiles(
                      pendingImport.files,
                      {
                        ...pendingImport.choices,
                        you: pendingImport.who === "file",
                      },
                      pendingImport.contents,
                    )
                  }
                  onCancel={() => setPendingImport(null)}
                />
              )}
              {importProgress &&
                (importProgress.rows ? (
                  <ExportProgress
                    title="Importing…"
                    rows={importRowsWithStats(importProgress)}
                  />
                ) : (
                  <ImportProgressBar progress={importProgress} />
                ))}
              {transferStatus && (
                <p
                  className={`collections__transfer-status collections__transfer-status--${transferStatus.type}`}
                >
                  {transferStatus.message}
                </p>
              )}
            </div>

            <button className="collections__clear-btn" onClick={clearAllData}>
              {clearConfirmPending
                ? "Click again to confirm — this cannot be undone"
                : "Clear all local data"}
            </button>
          </>
        )}

        {(visibleSection === "all" || visibleSection === "developer") && (
          <div className="collections__dev-mode">
            <label className="collections__dev-mode-label">
              <input
                type="checkbox"
                checked={devMode}
                onChange={(e) => toggleDevMode(e.target.checked)}
                className="collections__dev-mode-checkbox"
              />
              <div>
                <span className="collections__dev-mode-title">
                  Developer mode
                </span>
                <span className="collections__dev-mode-desc">
                  Shows advanced controls in the movement overlay
                </span>
              </div>
            </label>
          </div>
        )}
      </main>
    </div>
  );
}

export function DataCollectionSection() {
  return <Collections visibleSection="data" />;
}

export function YourDataSection() {
  return <Collections visibleSection="your-data" />;
}

export function DeveloperModeSection() {
  return <Collections visibleSection="developer" />;
}
