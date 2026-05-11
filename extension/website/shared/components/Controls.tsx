// ABOUTME: Controls panel component for the Internet Movement visualization
// ABOUTME: Provides UI for adjusting visualization settings and displaying stats
import React, { useState, useEffect, useRef, memo, useMemo } from "react";
import { CollectionEvent, Trail } from "../types";
import { VISUALIZATIONS } from "./registry";
import { TRAIL_RENDERERS } from "../styles";
import { CLICK_DEFAULTS } from "./clickDefaults";
import {
  collectEventCategories,
  computeHotspots,
  computeOverallStats,
  pickStripBucketMs,
  rankSustainedWindows,
} from "../utils/hotspots";
import { buildShareUrl } from "../utils/shareUrl";
import { parseCleanFromUrl } from "../config";
import {
  addSavedConfig,
  buildAutoName,
  loadSavedConfigs,
  subscribeSavedConfigs,
  type SavedConfig,
} from "../utils/savedConfigs";
import { DEFAULT_SETTINGS } from "./settingsDefaults";

interface ControlsProps {
  visible: boolean;
  settings: any;
  setSettings: React.Dispatch<React.SetStateAction<any>>;
  loading: boolean;
  error: string | null;
  events: CollectionEvent[];
  /** Count of events after the time-range filter is applied (what the
   * canvas is actually drawing). Falls back to events.length when no range
   * is selected. */
  filteredEventCount?: number;
  trails: Trail[];
  availableDomains: string[];
  fetchEvents: () => void;
  timeRange: { min: number; max: number; duration: number };
  activeVisualizations: string[];
  onSetActiveVisualizations: (vizIds: string[]) => void;
  /** When non-null, the canvas is scoped to this absolute-time window. */
  selectedTimeRange?: { startMs: number; endMs: number } | null;
  /** Set/clear the canvas time-range filter from the Hotspots panel. */
  onSelectTimeRange?: (
    range: { startMs: number; endMs: number } | null,
  ) => void;
}

const WINDOW_LENGTH_OPTIONS: Array<{ label: string; ms: number }> = [
  { label: "5 min", ms: 5 * 60 * 1000 },
  { label: "15 min", ms: 15 * 60 * 1000 },
  { label: "30 min", ms: 30 * 60 * 1000 },
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "2 hours", ms: 2 * 60 * 60 * 1000 },
  { label: "6 hours", ms: 6 * 60 * 60 * 1000 },
];

/** Top-of-panel share + save section.
 *
 * - "Copy URL" → minimal share URL to clipboard (via `buildShareUrl`).
 * - "Save" + optional title → persists current config to localStorage.
 *   When the title is blank, an auto-name is derived from the active
 *   vizs / domain / path / trail style / time range (see
 *   `buildAutoName`).
 * - List of saved configs (newest first). Click a row to navigate to
 *   the saved URL (full reload reapplies settings). × deletes.
 *
 * Hoisted to module scope for stable component identity (same reason as
 * `CollapsibleSection` and `PathFilterInput`). */
const ShareConfigSection: React.FC<{
  settings: Record<string, unknown>;
  activeVisualizations: string[];
  selectedTimeRange: { startMs: number; endMs: number } | null;
}> = ({ settings, activeVisualizations, selectedTimeRange }) => {
  const [copyFeedback, setCopyFeedback] = useState<"idle" | "ok" | "err">(
    "idle",
  );
  const [titleDraft, setTitleDraft] = useState("");
  const [saved, setSaved] = useState<SavedConfig[]>(() => loadSavedConfigs());

  const buildCurrentUrl = () =>
    buildShareUrl({
      settings,
      defaults: DEFAULT_SETTINGS as unknown as Record<string, unknown>,
      activeVisualizations,
      selectedTimeRange,
      // Preserve whichever clean tier the page is currently in (set via
      // URL). If someone tweaks controls inside `?clean=2` and copies the
      // URL, the next person should land in the same print mode.
      clean: parseCleanFromUrl(),
    });

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildCurrentUrl());
      setCopyFeedback("ok");
    } catch {
      setCopyFeedback("err");
    }
    window.setTimeout(() => setCopyFeedback("idle"), 1500);
  };

  const onSave = () => {
    const title = titleDraft.trim();
    const autoName = buildAutoName({
      activeVisualizations,
      domainFilter: (settings.domainFilter as string | undefined) ?? "",
      pathFilter: (settings.pathFilter as string | undefined) ?? "",
      pidFilter: (settings.pidFilter as string | undefined) ?? "",
      trailStyle: settings.trailStyle as string | undefined,
      trailStyleIsDefault:
        (settings.trailStyle as string | undefined) ===
        DEFAULT_SETTINGS.trailStyle,
      selectedTimeRange,
    });
    const name = title || autoName;
    const url = buildCurrentUrl();
    setSaved((prev) => addSavedConfig(prev, { name, url }));
    setTitleDraft("");
  };

  // Cross-tab sync: when the management page (or another tab) edits the
  // list, this panel updates without a manual reload.
  useEffect(() => {
    const unsub = subscribeSavedConfigs((next) => setSaved(next));
    return unsub;
  }, []);

  const onRestore = (cfg: SavedConfig) => {
    // Always-new-tab so the dev session in this tab is preserved.
    window.open(cfg.url, "_blank", "noopener");
  };

  const PANEL_RECENT_LIMIT = 8;
  const recent = saved.slice(0, PANEL_RECENT_LIMIT);
  const hasMore = saved.length > PANEL_RECENT_LIMIT;

  const copyLabel =
    copyFeedback === "ok"
      ? "Copied!"
      : copyFeedback === "err"
        ? "Copy failed"
        : "Copy URL";

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <button
          type="button"
          onClick={onCopy}
          title="Copy a minimal URL that reproduces this configuration"
          style={{
            flex: 1,
            padding: "6px 10px",
            fontSize: "11px",
            fontWeight: 600,
            fontFamily: "'Martian Mono', 'Space Mono', monospace",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            background: copyFeedback === "ok" ? "#e6f4f1" : "#faf9f6",
            color: copyFeedback === "err" ? "#c4724e" : "#3d3833",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 3,
            cursor: "pointer",
          }}
        >
          {copyLabel}
        </button>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        <input
          type="text"
          value={titleDraft}
          placeholder="Optional title (blank = auto-name)"
          onChange={(e) => setTitleDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSave();
            }
          }}
          style={{
            flex: 1,
            fontSize: 11,
            padding: "5px 8px",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 3,
          }}
        />
        <button
          type="button"
          onClick={onSave}
          title="Save this configuration to localStorage"
          style={{
            padding: "5px 10px",
            fontSize: "11px",
            fontWeight: 600,
            fontFamily: "'Martian Mono', 'Space Mono', monospace",
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            background: "#faf9f6",
            color: "#3d3833",
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 3,
            cursor: "pointer",
          }}
        >
          Save
        </button>
      </div>

      {saved.length > 0 && (
        <div
          style={{
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 3,
            background: "#fdfcf9",
            maxHeight: 180,
            overflowY: "auto",
          }}
        >
          {recent.map((cfg, idx) => (
            <button
              key={cfg.id}
              type="button"
              onClick={() => onRestore(cfg)}
              title={`Open in new tab — ${cfg.url}`}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "none",
                border: "none",
                borderBottom:
                  idx < recent.length - 1
                    ? "1px solid rgba(0,0,0,0.05)"
                    : "none",
                padding: "5px 8px",
                cursor: "pointer",
                color: "#3d3833",
                fontSize: 11,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {cfg.name}
            </button>
          ))}
        </div>
      )}

      {(hasMore || saved.length > 0) && (
        <div style={{ marginTop: 6, textAlign: "right" }}>
          <a
            href="/portrait/saved.html"
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 10,
              color: "#5b8db8",
              textDecoration: "none",
              fontFamily: "'Martian Mono', monospace",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
            }}
          >
            {hasMore
              ? `View all ${saved.length} →`
              : "Manage saved configs →"}
          </a>
        </div>
      )}
    </div>
  );
};

/** Split a free-form filter string into `{ domain, pathPrefix }`. Accepts
 * full URLs, hostname/path combos, bare paths, or bare hostnames.
 *
 *   "https://google.com/maps?q=x" → { domain: "google.com", pathPrefix: "/maps" }
 *   "google.com/maps"             → { domain: "google.com", pathPrefix: "/maps" }
 *   "google.com"                  → { domain: "google.com", pathPrefix: "" }
 *   "/maps"                       → { domain: "",           pathPrefix: "/maps" }
 *   "maps"                        → { domain: "",           pathPrefix: "/maps" }
 *
 * The "has a dot before the first slash" heuristic decides whether the
 * leading segment is a hostname or part of the path. Strips protocol,
 * `www.`, query string, and hash. */
function splitFilterInput(raw: string): { domain: string; pathPrefix: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { domain: "", pathPrefix: "" };

  // Try as a real URL first when a protocol is present.
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const domain = u.hostname.replace(/^www\./, "");
      const pathPrefix = u.pathname && u.pathname !== "/" ? u.pathname : "";
      return { domain, pathPrefix };
    } catch {
      // fall through to manual split
    }
  }

  // Strip query/hash for manual cases.
  const cleaned = trimmed.replace(/[?#].*$/, "");
  const slashIdx = cleaned.indexOf("/");
  const head = slashIdx === -1 ? cleaned : cleaned.slice(0, slashIdx);
  const tail = slashIdx === -1 ? "" : cleaned.slice(slashIdx); // includes "/"

  // Leading segment is a hostname iff it contains a "." (e.g. "google.com").
  if (head.includes(".")) {
    const domain = head.replace(/^www\./, "");
    return { domain, pathPrefix: tail };
  }

  // No dot in head — treat the whole input as a path. Prepend "/" if missing.
  if (!cleaned) return { domain: "", pathPrefix: "" };
  const pathPrefix = cleaned.startsWith("/") ? cleaned : `/${cleaned}`;
  return { domain: "", pathPrefix };
}

/** Path-filter input with two affordances:
 *   1. Local draft state with a 350ms debounce — typing doesn't thrash
 *      the visualization (every keystroke would otherwise re-run all
 *      hooks and re-fire the worker fetch via the domain-sync chain).
 *   2. Smart split on commit — if the typed/pasted value parses as
 *      `domain[/path]`, the domain part is routed to `setDomainFilter`
 *      and the path remains in `pathFilter`. Pasting `google.com/maps`
 *      fills both fields in one action.
 *
 * Hoisted to module scope alongside CollapsibleSection for the same
 * reason — stable component identity prevents focus loss. */
const PathFilterInput: React.FC<{
  pathFilter: string;
  domainFilter: string;
  setSettings: React.Dispatch<React.SetStateAction<any>>;
}> = ({ pathFilter, domainFilter, setSettings }) => {
  // Local draft so typing stays responsive even if upstream re-renders.
  // Initialize from prop and reset whenever the prop changes from outside
  // (e.g. another control or URL nav).
  const [draft, setDraft] = useState(pathFilter ?? "");
  const lastPropRef = useRef(pathFilter ?? "");
  useEffect(() => {
    if (pathFilter !== lastPropRef.current) {
      lastPropRef.current = pathFilter;
      setDraft(pathFilter ?? "");
    }
  }, [pathFilter]);

  // Debounce-commit: write to settings (which triggers all the downstream
  // hook re-runs) only after the user pauses typing.
  useEffect(() => {
    if (draft === (pathFilter ?? "")) return;
    const t = window.setTimeout(() => {
      const { domain, pathPrefix } = splitFilterInput(draft);
      setSettings((s: any) => {
        // Only set domain when smart-paste extracted one — otherwise
        // typing into the path field would clobber an already-set domain.
        const next: any = { ...s, pathFilter: pathPrefix };
        if (domain) next.domainFilter = domain;
        return next;
      });
      lastPropRef.current = pathPrefix;
      // Reflect the normalized value in the input (keeps display tidy
      // when user pasted "https://google.com/maps?q=x" — they'll see
      // "/maps" after the debounce fires).
      if (draft !== pathPrefix) setDraft(pathPrefix);
    }, 350);
    return () => window.clearTimeout(t);
  }, [draft, pathFilter, setSettings]);

  const clear = () => {
    setDraft("");
    setSettings((s: any) => ({ ...s, pathFilter: "" }));
  };

  return (
    <div className="control-group">
      <label htmlFor="path-filter">Path Filter</label>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          id="path-filter"
          type="text"
          value={draft}
          placeholder="/maps  or  google.com/maps"
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: 1 }}
        />
        {(draft || pathFilter) && (
          <button
            onClick={clear}
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              cursor: "pointer",
            }}
            title="Clear path filter"
          >
            Clear
          </button>
        )}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#8a8279",
          marginTop: 4,
          fontStyle: "italic",
        }}
      >
        Prefix-matches event URL path. Paste a full URL (e.g.
        <code>google.com/maps</code>) to fill domain + path together.
        {domainFilter && !pathFilter ? (
          <>
            {" "}Currently scoped to <strong>{domainFilter}</strong>.
          </>
        ) : null}
      </div>
    </div>
  );
};

/** Exact-string filter on `event.meta.pid` (the persistent ECDSA-derived
 * player ID). Debounced like PathFilterInput so typing stays responsive
 * even while all the downstream viz hooks re-run on commit. No
 * smart-paste — pids are opaque, no value in trying to split them. */
const UserFilterInput: React.FC<{
  pidFilter: string;
  setSettings: React.Dispatch<React.SetStateAction<any>>;
}> = ({ pidFilter, setSettings }) => {
  const [draft, setDraft] = useState(pidFilter ?? "");
  const lastPropRef = useRef(pidFilter ?? "");
  useEffect(() => {
    if (pidFilter !== lastPropRef.current) {
      lastPropRef.current = pidFilter;
      setDraft(pidFilter ?? "");
    }
  }, [pidFilter]);

  useEffect(() => {
    if (draft === (pidFilter ?? "")) return;
    const t = window.setTimeout(() => {
      const trimmed = draft.trim();
      setSettings((s: any) => ({ ...s, pidFilter: trimmed }));
      lastPropRef.current = trimmed;
      if (draft !== trimmed) setDraft(trimmed);
    }, 350);
    return () => window.clearTimeout(t);
  }, [draft, pidFilter, setSettings]);

  const clear = () => {
    setDraft("");
    setSettings((s: any) => ({ ...s, pidFilter: "" }));
  };

  return (
    <div className="control-group">
      <label htmlFor="user-filter">User Filter</label>
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          id="user-filter"
          type="text"
          value={draft}
          placeholder="pk_… (player ID)"
          onChange={(e) => setDraft(e.target.value)}
          style={{ flex: 1, fontFamily: "'Martian Mono', monospace", fontSize: 10 }}
        />
        {(draft || pidFilter) && (
          <button
            onClick={clear}
            style={{
              padding: "4px 8px",
              fontSize: "11px",
              cursor: "pointer",
            }}
            title="Clear user filter"
          >
            Clear
          </button>
        )}
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#8a8279",
          marginTop: 4,
          fontStyle: "italic",
        }}
      >
        Show only events from this player ID. Right-click a trail to copy
        its pid (coming soon), or paste one you already have.
      </div>
    </div>
  );
};

/** Hoisted out of `Controls` so its component identity is stable across
 * renders. When this lived inside `Controls` as a closure, every parent
 * re-render minted a new function value, which React treated as a different
 * component type and remounted the entire subtree on each keystroke into
 * any input — including blowing away input focus. Keep this at module
 * scope and pass section state in via props. */
const CollapsibleSection: React.FC<{
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, expanded, onToggle, children }) => (
  <div
    style={{
      borderBottom: "1px solid #eee",
      paddingBottom: "8px",
      marginBottom: "8px",
    }}
  >
    <button
      type="button"
      onClick={onToggle}
      style={{
        width: "100%",
        textAlign: "left",
        background: "none",
        border: "none",
        padding: "8px 0",
        cursor: "pointer",
        fontSize: "13px",
        fontWeight: "600",
        color: "#333",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span>{title}</span>
      <span style={{ fontSize: "12px", opacity: 0.6 }}>
        {expanded ? "▼" : "▶"}
      </span>
    </button>
    {expanded && <div style={{ marginTop: "8px" }}>{children}</div>}
  </div>
);

export const Controls: React.FC<ControlsProps> = memo(
  ({
    visible,
    settings,
    setSettings,
    loading,
    error,
    events,
    filteredEventCount,
    trails,
    availableDomains,
    fetchEvents,
    timeRange,
    activeVisualizations,
    onSetActiveVisualizations,
    selectedTimeRange,
    onSelectTimeRange,
  }) => {
    // All sections expanded by default
    const [expandedSections, setExpandedSections] = useState<
      Record<string, boolean>
    >({
      filters: true,
      cursorVisualizers: true,
      cursorSettings: true,
      clickSettings: true,
      keyboard: true,
      scroll: true,
      navigation: true,
      sound: false,
      hotspots: true,
    });

    // Hotspot analysis: sliding-window length + per-event-type filter.
    // Defaults skew toward "show me the densest 30-min windows" — that's the
    // most useful artifact length for showcase loops.
    const [windowLengthMs, setWindowLengthMs] = useState(30 * 60 * 1000);
    const [hotspotTypes, setHotspotTypes] = useState<Set<string>>(new Set());
    const [hotspotLimit, setHotspotLimit] = useState(10);

    const allCategories = useMemo(
      () => collectEventCategories(events),
      [events],
    );

    const overallStats = useMemo(
      () => computeOverallStats(events),
      [events],
    );

    // Rank sustained-density windows. The sub-bucket size needs to be small
    // enough that "sustained" means something but large enough that each
    // sub-bucket has a real shot at catching multiple unique people. With
    // archival cursor sampling at ~250ms and an event burst on focus, ~5min
    // sub-buckets are a sweet spot: a sustained window has ~6 sub-buckets
    // for a 30-min target and the "min unique people across sub-buckets"
    // floor stays meaningful instead of collapsing to 0.
    const rankedHotspots = useMemo(() => {
      if (events.length === 0) return [];
      const targetSubBucketsPerWindow = 6;
      const subBucketMs = Math.max(
        60 * 1000,
        Math.round(windowLengthMs / targetSubBucketsPerWindow),
      );
      const subBuckets = computeHotspots(events, {
        bucketMs: subBucketMs,
        allowedTypes: hotspotTypes.size > 0 ? hotspotTypes : undefined,
      });
      return rankSustainedWindows(subBuckets, windowLengthMs, hotspotLimit);
    }, [events, windowLengthMs, hotspotTypes, hotspotLimit]);

    const toggleHotspotType = (cat: string) => {
      setHotspotTypes((prev) => {
        const next = new Set(prev);
        if (next.has(cat)) next.delete(cat);
        else next.add(cat);
        return next;
      });
    };

    const formatRangeLabel = (startMs: number, endMs: number) => {
      const start = new Date(startMs);
      const end = new Date(endMs);
      const sameDay = start.toDateString() === end.toDateString();
      const dateStr = start.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      const startTime = start.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      const endTime = end.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      return sameDay
        ? `${dateStr} ${startTime}–${endTime}`
        : `${dateStr} ${startTime} → ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${endTime}`;
    };

    const toggleSection = (section: string) => {
      setExpandedSections((prev) => ({
        ...prev,
        [section]: !prev[section],
      }));
    };

    if (!visible) return null;

    return (
      <div
        className="controls"
        style={{
          maxHeight: "calc(100vh - 40px)",
          overflowY: "auto",
          width: 320,
          maxWidth: 320,
          boxSizing: "border-box",
        }}
      >
        <ShareConfigSection
          settings={settings}
          activeVisualizations={activeVisualizations}
          selectedTimeRange={selectedTimeRange ?? null}
        />

        {/* Randomize Colors at the very top */}
        <div className="control-group" style={{ marginBottom: "12px" }}>
          <label htmlFor="randomize-colors">
            <input
              id="randomize-colors"
              type="checkbox"
              checked={settings.randomizeColors}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  randomizeColors: e.target.checked,
                }))
              }
              style={{ marginRight: "8px" }}
            />
            Randomize Colors (Test Mode)
          </label>
        </div>

        {/* Visualizations multiselect and domain filter */}
        <CollapsibleSection
          title="Visualizations"
          expanded={!!expandedSections["filters"]}
          onToggle={() => toggleSection("filters")}
        >
          <div className="control-group">
            <label
              style={{
                fontSize: "12px",
                fontWeight: "600",
                marginBottom: "4px",
                display: "block",
              }}
            >
              Active Layers
            </label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                marginTop: "4px",
              }}
            >
              {VISUALIZATIONS.map((viz) => {
                const isActive = activeVisualizations.includes(viz.id);
                return (
                  <React.Fragment key={viz.id}>
                    <label
                      style={{
                        fontSize: "12px",
                        fontWeight: "normal",
                        textTransform: "none",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isActive}
                        onChange={(e) => {
                          if (e.target.checked) {
                            onSetActiveVisualizations([
                              ...activeVisualizations,
                              viz.id,
                            ]);
                          } else {
                            onSetActiveVisualizations(
                              activeVisualizations.filter((id) => id !== viz.id),
                            );
                          }
                        }}
                        style={{ marginRight: "6px" }}
                      />
                      {viz.label}
                    </label>
                    {/* Cursor event sub-filters when a cursor-based viz is active */}
                    {isActive &&
                      viz.requiredEvents.includes("cursor") &&
                      viz.id === "trails" && (
                        <div
                          style={{
                            marginLeft: "20px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                          }}
                        >
                          {(
                            [
                              ["move", "Move"],
                              ["click", "Click"],
                              ["hold", "Hold"],
                              ["cursor_change", "Cursor Change"],
                            ] as const
                          ).map(([key, label]) => (
                            <label
                              key={key}
                              style={{
                                fontSize: "11px",
                                fontWeight: "normal",
                                textTransform: "none",
                                opacity: 0.9,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={settings.eventFilter[key]}
                                onChange={(e) =>
                                  setSettings((s: any) => ({
                                    ...s,
                                    eventFilter: {
                                      ...s.eventFilter,
                                      [key]: e.target.checked,
                                    },
                                  }))
                                }
                                style={{ marginRight: "6px" }}
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      )}
                    {/* Viewport event sub-filters when scrolling viz is active */}
                    {isActive && viz.id === "scrolling" && (
                      <div
                        style={{
                          marginLeft: "20px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "4px",
                        }}
                      >
                        {(
                          [
                            ["scroll", "Scroll"],
                            ["resize", "Resize"],
                            ["zoom", "Zoom"],
                          ] as const
                        ).map(([key, label]) => (
                          <label
                            key={key}
                            style={{
                              fontSize: "11px",
                              fontWeight: "normal",
                              textTransform: "none",
                              opacity: 0.9,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={
                                settings.viewportEventFilter?.[key] ?? true
                              }
                              onChange={(e) =>
                                setSettings((s: any) => ({
                                  ...s,
                                  viewportEventFilter: {
                                    ...s.viewportEventFilter,
                                    [key]: e.target.checked,
                                  },
                                }))
                              }
                              style={{ marginRight: "6px" }}
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>

          <div className="control-group">
            <label htmlFor="domain-filter">Domain Filter</label>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <select
                id="domain-filter"
                value={settings.domainFilter}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    domainFilter: e.target.value,
                  }))
                }
                style={{ flex: 1 }}
              >
                <option value="">All Domains</option>
                {availableDomains.map((domain) => (
                  <option key={domain} value={domain}>
                    {domain}
                  </option>
                ))}
              </select>
              {settings.domainFilter && (
                <button
                  onClick={() =>
                    setSettings((s: any) => ({ ...s, domainFilter: "" }))
                  }
                  style={{
                    padding: "4px 8px",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                  title="Clear filter"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <PathFilterInput
            pathFilter={settings.pathFilter ?? ""}
            domainFilter={settings.domainFilter ?? ""}
            setSettings={setSettings}
          />

          <UserFilterInput
            pidFilter={settings.pidFilter ?? ""}
            setSettings={setSettings}
          />
        </CollapsibleSection>

        {/* Cursor Settings - merged from Appearance and Animation */}
        <CollapsibleSection
          title="Cursor Settings"
          expanded={!!expandedSections["cursorSettings"]}
          onToggle={() => toggleSection("cursorSettings")}
        >
          <div className="control-group">
            <label htmlFor="trail-visual-style">Visual Style</label>
            <select
              id="trail-visual-style"
              value={settings.trailVisualStyle ?? "color"}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  trailVisualStyle: e.target.value,
                }))
              }
            >
              {TRAIL_RENDERERS.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          {/* Appearance settings */}
          <div className="control-group">
            <label htmlFor="trail-opacity">Trail Opacity</label>
            <input
              id="trail-opacity"
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={settings.trailOpacity}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  trailOpacity: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.trailOpacity.toFixed(1)}</span>
          </div>

          <div className="control-group">
            <label htmlFor="stroke-width">Stroke Width</label>
            <input
              id="stroke-width"
              type="range"
              min="0.5"
              max="20"
              step="0.5"
              value={settings.strokeWidth}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  strokeWidth: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.strokeWidth.toFixed(1)}px</span>
          </div>

          <div className="control-group">
            <label htmlFor="trail-style">Trail Style</label>
            <select
              id="trail-style"
              value={settings.trailStyle}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  trailStyle: e.target.value as
                    | "straight"
                    | "smooth"
                    | "organic"
                    | "chaotic",
                }))
              }
            >
              <option value="straight">Straight (Geometric)</option>
              <option value="smooth">Smooth (Curved)</option>
              <option value="organic">Organic (Subtle Variation)</option>
              <option value="chaotic">Chaotic (Sketchy)</option>
            </select>
          </div>

          {settings.trailStyle === "chaotic" && (
            <div className="control-group">
              <label htmlFor="chaos-intensity">Chaos Intensity</label>
              <input
                id="chaos-intensity"
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={settings.chaosIntensity || 1.0}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    chaosIntensity: parseFloat(e.target.value),
                  }))
                }
              />
              <span>{(settings.chaosIntensity || 1.0).toFixed(1)}x</span>
            </div>
          )}

          {/* Animation settings */}
          <div className="control-group">
            <label htmlFor="animation-speed">Animation Speed</label>
            <input
              id="animation-speed"
              type="range"
              min="0.1"
              max="10"
              step="0.1"
              value={settings.animationSpeed}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  animationSpeed: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.animationSpeed.toFixed(1)}x</span>
          </div>

          <div className="control-group">
            <label htmlFor="max-concurrent">Max Concurrent Trails</label>
            <input
              id="max-concurrent"
              type="range"
              min="1"
              max="40"
              step="1"
              value={settings.maxConcurrentTrails}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  maxConcurrentTrails: parseInt(e.target.value, 10),
                }))
              }
            />
            <span>{settings.maxConcurrentTrails}</span>
          </div>

          <div className="control-group">
            <label htmlFor="animation-mode">Animation Mode</label>
            <select
              id="animation-mode"
              value={settings.trailAnimationMode}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  trailAnimationMode: e.target.value as "natural" | "stagger",
                }))
              }
            >
              <option value="natural">Natural (Actual Timestamps)</option>
              <option value="stagger">Stagger (Choreographed)</option>
            </select>
          </div>

          {settings.trailAnimationMode === "stagger" && (
            <>
              <div className="control-group">
                <label htmlFor="overlap-factor">Overlap Factor</label>
                <input
                  id="overlap-factor"
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.overlapFactor}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      overlapFactor: parseFloat(e.target.value),
                    }))
                  }
                />
                <span>{settings.overlapFactor.toFixed(1)}</span>
              </div>

              <div className="control-group">
                <label htmlFor="min-gap">Min Gap Between Trails</label>
                <input
                  id="min-gap"
                  type="range"
                  min="0.1"
                  max="10"
                  step="0.1"
                  value={settings.minGapBetweenTrails}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      minGapBetweenTrails: parseFloat(e.target.value),
                    }))
                  }
                />
                <span>{settings.minGapBetweenTrails.toFixed(1)}s</span>
              </div>
            </>
          )}
        </CollapsibleSection>

        <CollapsibleSection
          title="Click Settings"
          expanded={!!expandedSections["clickSettings"]}
          onToggle={() => toggleSection("clickSettings")}
        >
          <div className="control-group">
            <button
              type="button"
              onClick={() =>
                setSettings((s: any) => ({ ...s, ...CLICK_DEFAULTS }))
              }
              style={{
                fontSize: "11px",
                padding: "4px 8px",
                marginBottom: "8px",
                cursor: "pointer",
              }}
            >
              Reset to defaults
            </button>
          </div>

          <div className="control-group">
            <label htmlFor="click-num-rings">Concentric Rings</label>
            <input
              id="click-num-rings"
              type="range"
              min="1"
              max="20"
              step="1"
              value={settings.clickNumRings}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  clickNumRings: parseInt(e.target.value, 10),
                }))
              }
            />
            <span>{settings.clickNumRings}</span>
          </div>

          <div className="control-group">
            <label htmlFor="click-ring-delay">Ring Delay (ms)</label>
            <input
              id="click-ring-delay"
              type="range"
              min="10"
              max="1000"
              step="10"
              value={settings.clickRingDelayMs}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  clickRingDelayMs: parseInt(e.target.value, 10),
                }))
              }
            />
            <span>{settings.clickRingDelayMs}ms</span>
          </div>

          <div className="control-group">
            <label htmlFor="click-expansion-duration">Expansion Duration (ms)</label>
            <input
              id="click-expansion-duration"
              type="range"
              min="200"
              max="6000"
              step="100"
              value={settings.clickExpansionDuration}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  clickExpansionDuration: parseInt(e.target.value, 10),
                }))
              }
            />
            <span>{settings.clickExpansionDuration}ms</span>
          </div>

          <div className="control-group">
            <label htmlFor="click-stop-point">Animation Stop Point</label>
            <input
              id="click-stop-point"
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={settings.clickAnimationStopPoint}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  clickAnimationStopPoint: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.clickAnimationStopPoint.toFixed(2)}</span>
          </div>

          <div className="control-group">
            <label htmlFor="click-max-gap-enabled">
              <input
                id="click-max-gap-enabled"
                type="checkbox"
                checked={settings.clickMaxGapMs !== null}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    clickMaxGapMs: e.target.checked
                      ? typeof s.clickMaxGapMs === "number" && s.clickMaxGapMs > 0
                        ? s.clickMaxGapMs
                        : 400
                      : null,
                  }))
                }
                style={{ marginRight: "6px" }}
              />
              Cap Max Gap Between Clicks
            </label>
          </div>

          {settings.clickMaxGapMs !== null && (
            <div className="control-group">
              <label htmlFor="click-max-gap">Max Gap (ms)</label>
              <input
                id="click-max-gap"
                type="range"
                min="50"
                max="2000"
                step="50"
                value={settings.clickMaxGapMs}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    clickMaxGapMs: parseInt(e.target.value, 10),
                  }))
                }
              />
              <span>{settings.clickMaxGapMs}ms</span>
            </div>
          )}

          <div className="control-group">
            <label htmlFor="click-core-radius">Core Radius (px)</label>
            <input
              id="click-core-radius"
              type="range"
              min="1"
              max="20"
              step="1"
              value={settings.clickCoreRadius}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  clickCoreRadius: parseInt(e.target.value, 10),
                }))
              }
            />
            <span>{settings.clickCoreRadius}px</span>
          </div>

          <div className="control-group">
            <label htmlFor="click-min-radius">Min Radius (px)</label>
            <input
              id="click-min-radius"
              type="range"
              min="2"
              max="100"
              step="1"
              value={settings.clickMinRadius}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  clickMinRadius: parseInt(e.target.value, 10),
                }))
              }
            />
            <span>{settings.clickMinRadius}px</span>
          </div>

          <div className="control-group">
            <label htmlFor="click-max-radius">Max Radius (px)</label>
            <input
              id="click-max-radius"
              type="range"
              min="20"
              max="400"
              step="5"
              value={settings.clickMaxRadius}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  clickMaxRadius: parseInt(e.target.value, 10),
                }))
              }
            />
            <span>{settings.clickMaxRadius}px</span>
          </div>

          <div className="control-group">
            <label htmlFor="click-min-duration">Min Duration (ms)</label>
            <input
              id="click-min-duration"
              type="range"
              min="100"
              max="3000"
              step="50"
              value={settings.clickMinDuration}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  clickMinDuration: parseInt(e.target.value, 10),
                }))
              }
            />
            <span>{settings.clickMinDuration}ms</span>
          </div>

          <div className="control-group">
            <label htmlFor="click-max-duration">Max Duration (ms)</label>
            <input
              id="click-max-duration"
              type="range"
              min="500"
              max="6000"
              step="100"
              value={settings.clickMaxDuration}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  clickMaxDuration: parseInt(e.target.value, 10),
                }))
              }
            />
            <span>{settings.clickMaxDuration}ms</span>
          </div>

          <div className="control-group">
            <label htmlFor="click-stroke-width">Stroke Width (px)</label>
            <input
              id="click-stroke-width"
              type="range"
              min="0.5"
              max="20"
              step="0.5"
              value={settings.clickStrokeWidth}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  clickStrokeWidth: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.clickStrokeWidth.toFixed(1)}px</span>
          </div>

          <div className="control-group">
            <label htmlFor="click-opacity">Opacity</label>
            <input
              id="click-opacity"
              type="range"
              min="0.05"
              max="1"
              step="0.05"
              value={settings.clickOpacity}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  clickOpacity: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.clickOpacity.toFixed(2)}</span>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Keyboard Settings"
          expanded={!!expandedSections["keyboard"]}
          onToggle={() => toggleSection("keyboard")}
        >
          <div className="control-group">
            <label htmlFor="keyboard-display-mode">Display Mode</label>
            <select
              id="keyboard-display-mode"
              value={settings.keyboardDisplayMode ?? "full"}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  keyboardDisplayMode: e.target.value as "full" | "abstract",
                }))
              }
            >
              <option value="full">Full (show text)</option>
              <option value="abstract">Abstract (redacted bars)</option>
            </select>
          </div>

          <div className="control-group">
            <label htmlFor="keyboard-animation-speed">Typing Speed</label>
            <input
              id="keyboard-animation-speed"
              type="range"
              min="0.1"
              max="2"
              step="0.1"
              value={settings.keyboardAnimationSpeed}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  keyboardAnimationSpeed: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.keyboardAnimationSpeed.toFixed(1)}x</span>
          </div>

          <div className="control-group">
            <label htmlFor="keyboard-overlap">Overlap Factor</label>
            <input
              id="keyboard-overlap"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.keyboardOverlapFactor}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  keyboardOverlapFactor: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.keyboardOverlapFactor.toFixed(2)}</span>
          </div>

          <div className="control-group">
            <label htmlFor="textbox-opacity">Textbox Opacity</label>
            <input
              id="textbox-opacity"
              type="range"
              min="0.05"
              max="0.5"
              step="0.05"
              value={settings.textboxOpacity}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  textboxOpacity: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.textboxOpacity.toFixed(2)}</span>
          </div>

          <div className="control-group">
            <label htmlFor="keyboard-min-font">Min Font Size</label>
            <input
              id="keyboard-min-font"
              type="range"
              min="8"
              max="20"
              step="1"
              value={settings.keyboardMinFontSize}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  keyboardMinFontSize: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.keyboardMinFontSize}px</span>
          </div>

          <div className="control-group">
            <label htmlFor="keyboard-max-font">Max Font Size</label>
            <input
              id="keyboard-max-font"
              type="range"
              min="12"
              max="32"
              step="1"
              value={settings.keyboardMaxFontSize}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  keyboardMaxFontSize: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.keyboardMaxFontSize}px</span>
          </div>

          <div className="control-group">
            <label htmlFor="keyboard-position-randomness">
              Position Randomness
            </label>
            <input
              id="keyboard-position-randomness"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.keyboardPositionRandomness}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  keyboardPositionRandomness: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.keyboardPositionRandomness.toFixed(2)}</span>
          </div>

          <div className="control-group">
            <label htmlFor="keyboard-show-caret">
              <input
                id="keyboard-show-caret"
                type="checkbox"
                checked={settings.keyboardShowCaret}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    keyboardShowCaret: e.target.checked,
                  }))
                }
                style={{ marginRight: "8px" }}
              />
              Show Blinking Caret
            </label>
          </div>

          <div className="control-group">
            <label htmlFor="keyboard-randomize-order">
              <input
                id="keyboard-randomize-order"
                type="checkbox"
                checked={settings.keyboardRandomizeOrder}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    keyboardRandomizeOrder: e.target.checked,
                  }))
                }
                style={{ marginRight: "8px" }}
              />
              Randomize Animation Order
            </label>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Scroll Animation"
          expanded={!!expandedSections["scroll"]}
          onToggle={() => toggleSection("scroll")}
        >
          <div className="control-group">
            <label htmlFor="scroll-speed">Scroll Speed</label>
            <input
              id="scroll-speed"
              type="range"
              min="0.1"
              max="2"
              step="0.1"
              value={settings.scrollSpeed}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  scrollSpeed: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.scrollSpeed.toFixed(1)}x</span>
          </div>

          <div className="control-group">
            <label htmlFor="background-opacity">Background Opacity</label>
            <input
              id="background-opacity"
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={settings.backgroundOpacity}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  backgroundOpacity: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.backgroundOpacity.toFixed(1)}</span>
          </div>

          <div className="control-group">
            <label htmlFor="max-windows">Max Windows</label>
            <input
              id="max-windows"
              type="range"
              min="1"
              max="50"
              step="1"
              value={settings.maxConcurrentScrolls}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  maxConcurrentScrolls: parseInt(e.target.value),
                }))
              }
            />
            <span>{settings.maxConcurrentScrolls}</span>
          </div>

          <div className="control-group">
            <label htmlFor="window-scale">Window Size</label>
            <input
              id="window-scale"
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={settings.windowScale ?? 0.5}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  windowScale: parseFloat(e.target.value),
                }))
              }
            />
            <span>{["Tiny", "Small", "Medium", "Large", "Full"][Math.round((settings.windowScale ?? 0.5) * 4)]}</span>
          </div>

          <div className="control-group">
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                type="checkbox"
                checked={settings.showPagePreview ?? false}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    showPagePreview: e.target.checked,
                  }))
                }
              />
              Show page preview (uses iframes)
            </label>
          </div>

          <div className="control-group">
            <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <input
                type="checkbox"
                checked={settings.allowOverlap ?? false}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    allowOverlap: e.target.checked,
                  }))
                }
              />
              Allow overlapping windows
            </label>
          </div>

          <div className="control-group" style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <label style={{ fontSize: "12px", fontWeight: "normal", textTransform: "none" }}>
              <input
                type="checkbox"
                checked={settings.showScrollEvents !== false}
                onChange={(e) =>
                  setSettings((s: any) => ({ ...s, showScrollEvents: e.target.checked }))
                }
                style={{ marginRight: "4px" }}
              />
              Scroll
            </label>
            <label style={{ fontSize: "12px", fontWeight: "normal", textTransform: "none" }}>
              <input
                type="checkbox"
                checked={settings.showResizeEvents !== false}
                onChange={(e) =>
                  setSettings((s: any) => ({ ...s, showResizeEvents: e.target.checked }))
                }
                style={{ marginRight: "4px" }}
              />
              Resize
            </label>
            <label style={{ fontSize: "12px", fontWeight: "normal", textTransform: "none" }}>
              <input
                type="checkbox"
                checked={settings.showZoomEvents !== false}
                onChange={(e) =>
                  setSettings((s: any) => ({ ...s, showZoomEvents: e.target.checked }))
                }
                style={{ marginRight: "4px" }}
              />
              Zoom
            </label>
          </div>

        </CollapsibleSection>

        <CollapsibleSection
          title="Navigation"
          expanded={!!expandedSections["navigation"]}
          onToggle={() => toggleSection("navigation")}
        >
          <div className="control-group">
            <span style={{ display: "block", marginBottom: "4px" }}>
              View mode
            </span>
            <label style={{ marginRight: "12px" }}>
              <input
                type="radio"
                name="nav-view-mode"
                checked={
                  (settings.navigationViewMode ?? "timeline") === "timeline"
                }
                onChange={() =>
                  setSettings((s: any) => ({
                    ...s,
                    navigationViewMode: "timeline",
                  }))
                }
                style={{ marginRight: "4px" }}
              />
              Timeline (scroll)
            </label>
            <label>
              <input
                type="radio"
                name="nav-view-mode"
                checked={
                  (settings.navigationViewMode ?? "timeline") === "radial"
                }
                onChange={() =>
                  setSettings((s: any) => ({
                    ...s,
                    navigationViewMode: "radial",
                  }))
                }
                style={{ marginRight: "4px" }}
              />
              Radial (expand)
            </label>
          </div>

          {(settings.navigationViewMode ?? "timeline") === "radial" && (
            <>
              <div className="control-group">
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={settings.navigationRadialSegmentByDay ?? true}
                    onChange={(e) =>
                      setSettings((s: any) => ({
                        ...s,
                        navigationRadialSegmentByDay: e.target.checked,
                      }))
                    }
                  />
                  Segment by day (clear canvas between days)
                </label>
              </div>
              <div className="control-group">
                <label htmlFor="nav-max-parallel-edges">
                  Max parallel edges
                </label>
                <input
                  id="nav-max-parallel-edges"
                  type="range"
                  min="1"
                  max="8"
                  step="1"
                  value={settings.navigationMaxParallelEdges ?? 3}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      navigationMaxParallelEdges: parseInt(e.target.value, 10),
                    }))
                  }
                />
                <span>{settings.navigationMaxParallelEdges ?? 3}</span>
              </div>
              <div className="control-group">
                <label htmlFor="radial-blob-samples">
                  Blob outline samples
                </label>
                <input
                  id="radial-blob-samples"
                  type="range"
                  min="8"
                  max="160"
                  step="8"
                  value={settings.navigationRadialBlobSamples ?? 64}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      navigationRadialBlobSamples: parseInt(e.target.value, 10),
                    }))
                  }
                />
                <span>{settings.navigationRadialBlobSamples ?? 64}</span>
              </div>
              <div className="control-group">
                <label htmlFor="radial-blob-tension">
                  Blob curve smoothness
                </label>
                <input
                  id="radial-blob-tension"
                  type="range"
                  min="0.15"
                  max="0.5"
                  step="0.01"
                  value={settings.navigationRadialBlobCurveTension ?? 0.5}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      navigationRadialBlobCurveTension: parseFloat(
                        e.target.value,
                      ),
                    }))
                  }
                />
                <span>
                  {(settings.navigationRadialBlobCurveTension ?? 0.5).toFixed(
                    2,
                  )}
                </span>
              </div>
              <div className="control-group">
                <label htmlFor="radial-blob-noise">Blob edge noise</label>
                <input
                  id="radial-blob-noise"
                  type="range"
                  min="0"
                  max="0.5"
                  step="0.01"
                  value={settings.navigationRadialBlobEdgeNoise ?? 0.45}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      navigationRadialBlobEdgeNoise: parseFloat(e.target.value),
                    }))
                  }
                />
                <span>
                  {(settings.navigationRadialBlobEdgeNoise ?? 0.45).toFixed(2)}
                </span>
              </div>
              <div className="control-group">
                <label htmlFor="radial-blob-valley">Blob valley depth</label>
                <input
                  id="radial-blob-valley"
                  type="range"
                  min="0.02"
                  max="0.35"
                  step="0.01"
                  value={settings.navigationRadialBlobValleyDepth ?? 0.05}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      navigationRadialBlobValleyDepth: parseFloat(
                        e.target.value,
                      ),
                    }))
                  }
                />
                <span>
                  {(settings.navigationRadialBlobValleyDepth ?? 0.05).toFixed(
                    2,
                  )}
                </span>
              </div>
            </>
          )}

          <div className="control-group">
            <label htmlFor="nav-window-opacity">Window Opacity</label>
            <input
              id="nav-window-opacity"
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={settings.navigationWindowOpacity ?? 0.9}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  navigationWindowOpacity: parseFloat(e.target.value),
                }))
              }
            />
            <span>{(settings.navigationWindowOpacity ?? 0.9).toFixed(1)}</span>
          </div>

          <div className="control-group">
            <label htmlFor="nav-edge-opacity">Edge Opacity</label>
            <input
              id="nav-edge-opacity"
              type="range"
              min="0.1"
              max="1"
              step="0.1"
              value={settings.navigationEdgeOpacity ?? 0.6}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  navigationEdgeOpacity: parseFloat(e.target.value),
                }))
              }
            />
            <span>{(settings.navigationEdgeOpacity ?? 0.6).toFixed(1)}</span>
          </div>

          <div className="control-group">
            <label htmlFor="nav-scroll-speed">Scroll Speed</label>
            <input
              id="nav-scroll-speed"
              type="range"
              min="20"
              max="200"
              step="10"
              value={settings.navigationScrollSpeed ?? 80}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  navigationScrollSpeed: parseInt(e.target.value),
                }))
              }
            />
            <span>{settings.navigationScrollSpeed ?? 80}px/s</span>
          </div>

          <div className="control-group">
            <label htmlFor="nav-max-sessions">Max Sessions</label>
            <input
              id="nav-max-sessions"
              type="range"
              min="1"
              max="20"
              step="1"
              value={settings.navigationMaxSessions ?? 8}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  navigationMaxSessions: parseInt(e.target.value),
                }))
              }
            />
            <span>{settings.navigationMaxSessions ?? 8}</span>
          </div>

          <div className="control-group">
            <label htmlFor="nav-min-session-events">Min Events/Session</label>
            <input
              id="nav-min-session-events"
              type="range"
              min="2"
              max="20"
              step="1"
              value={settings.navigationMinSessionEvents ?? 3}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  navigationMinSessionEvents: parseInt(e.target.value),
                }))
              }
            />
            <span>{settings.navigationMinSessionEvents ?? 3}</span>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Sound Settings"
          expanded={!!expandedSections["sound"]}
          onToggle={() => toggleSection("sound")}
        >
          <div className="control-group">
            <label htmlFor="sound-chord-voicing">
              <input
                id="sound-chord-voicing"
                type="checkbox"
                checked={settings.soundChordVoicing}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    soundChordVoicing: e.target.checked,
                  }))
                }
                style={{ marginRight: "8px" }}
              />
              Chord Voicing (root + fifth)
            </label>
          </div>
          <div className="control-group">
            <label htmlFor="sound-cursor-instruments">
              <input
                id="sound-cursor-instruments"
                type="checkbox"
                checked={settings.soundCursorInstruments}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    soundCursorInstruments: e.target.checked,
                  }))
                }
                style={{ marginRight: "8px" }}
              />
              Cursor Type Instruments
            </label>
          </div>
          <div className="control-group">
            <label htmlFor="sound-crossing-dissonance">
              <input
                id="sound-crossing-dissonance"
                type="checkbox"
                checked={settings.soundCrossingDissonance}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    soundCrossingDissonance: e.target.checked,
                  }))
                }
                style={{ marginRight: "8px" }}
              />
              Trail Crossing Dissonance
            </label>
          </div>
        </CollapsibleSection>

        <CollapsibleSection
          title="Activity Hotspots"
          expanded={!!expandedSections["hotspots"]}
          onToggle={() => toggleSection("hotspots")}
        >
          <div
            style={{
              fontSize: "11px",
              opacity: 0.75,
              marginBottom: "8px",
              lineHeight: 1.4,
            }}
          >
            Sustained dense windows — picks the spans where many unique people
            stay active for the entire window. Use the strip above the day
            picker to scrub visually, or click a row to scope the canvas.
          </div>

          <div className="control-group">
            <label htmlFor="hotspot-window-length">Window length</label>
            <select
              id="hotspot-window-length"
              value={windowLengthMs}
              onChange={(e) => setWindowLengthMs(parseInt(e.target.value, 10))}
            >
              {WINDOW_LENGTH_OPTIONS.map((opt) => (
                <option key={opt.ms} value={opt.ms}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label htmlFor="hotspot-limit">Show top</label>
            <input
              id="hotspot-limit"
              type="range"
              min="3"
              max="30"
              step="1"
              value={hotspotLimit}
              onChange={(e) => setHotspotLimit(parseInt(e.target.value, 10))}
            />
            <span>{hotspotLimit} results</span>
          </div>

          {allCategories.length > 0 && (
            <div className="control-group">
              <label
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  marginBottom: "4px",
                  display: "block",
                }}
              >
                Filter by event type{" "}
                {hotspotTypes.size === 0 && (
                  <span style={{ opacity: 0.5, fontWeight: "normal" }}>
                    (all)
                  </span>
                )}
              </label>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "4px",
                  marginTop: "4px",
                }}
              >
                {allCategories.map((cat) => {
                  const active = hotspotTypes.has(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => toggleHotspotType(cat)}
                      style={{
                        fontSize: "10px",
                        padding: "3px 8px",
                        border: `1px solid ${active ? "#4a9a8a" : "rgba(0,0,0,0.15)"}`,
                        background: active ? "#4a9a8a" : "transparent",
                        color: active ? "#faf9f6" : "#3d3833",
                        cursor: "pointer",
                        borderRadius: "2px",
                        textTransform: "lowercase",
                      }}
                    >
                      {cat}
                    </button>
                  );
                })}
                {hotspotTypes.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setHotspotTypes(new Set())}
                    style={{
                      fontSize: "10px",
                      padding: "3px 8px",
                      border: "1px solid rgba(0,0,0,0.15)",
                      background: "transparent",
                      cursor: "pointer",
                      borderRadius: "2px",
                      opacity: 0.7,
                    }}
                  >
                    clear
                  </button>
                )}
              </div>
            </div>
          )}

          <div
            style={{
              marginTop: "8px",
              maxHeight: "320px",
              overflowY: "auto",
              border: "1px solid rgba(0,0,0,0.08)",
              borderRadius: "2px",
            }}
          >
            {rankedHotspots.length === 0 ? (
              <div
                style={{
                  padding: "12px",
                  fontSize: "11px",
                  opacity: 0.6,
                  textAlign: "center",
                }}
              >
                No data in current event set.
              </div>
            ) : (
              rankedHotspots.map((w, i) => {
                const isSelected =
                  selectedTimeRange &&
                  selectedTimeRange.startMs === w.startMs &&
                  selectedTimeRange.endMs === w.endMs;
                return (
                  <button
                    key={w.startMs}
                    type="button"
                    onClick={() =>
                      onSelectTimeRange?.(
                        isSelected
                          ? null
                          : { startMs: w.startMs, endMs: w.endMs },
                      )
                    }
                    style={{
                      width: "100%",
                      textAlign: "left",
                      padding: "8px 10px",
                      border: "none",
                      borderBottom:
                        i < rankedHotspots.length - 1
                          ? "1px solid rgba(0,0,0,0.05)"
                          : "none",
                      background: isSelected
                        ? "rgba(74, 154, 138, 0.15)"
                        : "transparent",
                      cursor: "pointer",
                      fontFamily:
                        '"Atkinson Hyperlegible", system-ui, sans-serif',
                      fontSize: "11px",
                      color: "#3d3833",
                      display: "block",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "baseline",
                        gap: "8px",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        {formatRangeLabel(w.startMs, w.endMs)}
                      </span>
                      <span
                        style={{
                          fontFamily:
                            '"Martian Mono", "Space Mono", monospace',
                          fontSize: "10px",
                          color: "#4a9a8a",
                          fontWeight: 600,
                        }}
                        title="Average unique people across the window (sustained presence)"
                      >
                        avg {Math.round(w.meanPidsPerBucket * 10) / 10}p
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "10px",
                        opacity: 0.7,
                        marginTop: "2px",
                        fontFamily:
                          '"Martian Mono", "Space Mono", monospace',
                      }}
                    >
                      floor {w.minPidsPerBucket}p ·{" "}
                      {w.eventCount.toLocaleString()} ev ·{" "}
                      {w.occupiedBuckets}/{w.bucketCount} active
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {selectedTimeRange && (
            <button
              type="button"
              onClick={() => onSelectTimeRange?.(null)}
              style={{
                marginTop: "8px",
                fontSize: "11px",
                padding: "6px 10px",
                cursor: "pointer",
                width: "100%",
                background: "#faf9f6",
                color: "#3d3833",
                border: "1px solid rgba(196,114,78,0.55)",
                borderRadius: "3px",
                fontWeight: 600,
                letterSpacing: "0.3px",
              }}
            >
              Clear range filter
            </button>
          )}
        </CollapsibleSection>

        <div
          style={{
            borderBottom: "1px solid #eee",
            paddingBottom: "8px",
            marginBottom: "8px",
          }}
        >
          <div
            style={{
              padding: "8px 0",
              fontSize: "13px",
              fontWeight: "600",
              color: "#333",
            }}
          >
            Info
          </div>
          <div style={{ marginTop: "8px" }}>
            <div
              style={{
                fontSize: "10px",
                opacity: 0.5,
                marginTop: "8px",
                fontStyle: "italic",
                marginBottom: "8px",
              }}
            >
              Tip: Double-tap 'D' to hide/show controls
            </div>

            <button onClick={fetchEvents} disabled={loading}>
              {loading ? "Loading..." : "Refresh Data"}
            </button>

            {error && <div className="error">{error}</div>}
            {!loading && events.length > 0 && (
              <div className="info">
                {events.length.toLocaleString()} events
                {typeof filteredEventCount === "number" &&
                  filteredEventCount !== events.length &&
                  ` (${filteredEventCount.toLocaleString()} in range)`}
                , {trails.length.toLocaleString()} trails
                <div
                  style={{
                    fontSize: "10px",
                    marginTop: "4px",
                    opacity: 0.8,
                    fontFamily: '"Martian Mono", "Space Mono", monospace',
                  }}
                >
                  {overallStats.uniquePids.toLocaleString()} unique{" "}
                  {overallStats.uniquePids === 1 ? "person" : "people"} ·{" "}
                  {overallStats.uniqueSids.toLocaleString()} session
                  {overallStats.uniqueSids === 1 ? "" : "s"} ·{" "}
                  {overallStats.uniqueDomains.toLocaleString()} domain
                  {overallStats.uniqueDomains === 1 ? "" : "s"}
                </div>
                <br />
                <div
                  style={{ fontSize: "10px", marginTop: "4px", opacity: 0.7 }}
                >
                  Move:{" "}
                  {
                    events.filter(
                      (e) => !e.data.event || e.data.event === "move",
                    ).length
                  }{" "}
                  | Click:{" "}
                  {events.filter((e) => e.data.event === "click").length} |
                  Hold: {events.filter((e) => e.data.event === "hold").length} |
                  Cursor Change:{" "}
                  {
                    events.filter((e) => e.data.event === "cursor_change")
                      .length
                  }
                </div>
                {timeRange.duration > 0 && (
                  <div
                    style={{ fontSize: "10px", marginTop: "4px", opacity: 0.7 }}
                  >
                    Cycle: {(timeRange.duration / 1000 / 60).toFixed(1)} min
                    {settings.animationSpeed !== 1 &&
                      ` (${settings.animationSpeed}x speed)`}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  },
);
