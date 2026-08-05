// ABOUTME: Management page for saved portrait configurations
// ABOUTME: Lists, searches, deletes, opens-in-new-tab — backed by the same localStorage key as the dev panel

import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  loadSavedConfigs,
  deleteSavedConfig,
  subscribeSavedConfigs,
  type SavedConfig,
} from "../shared/utils/savedConfigs";
import { buildInstallationScreens } from "../shared/utils/installationUrls";

interface ParsedMetadata {
  viz: string[];
  domain: string;
  path: string;
  pid: string;
  range: { startMs: number; endMs: number } | null;
}

/** Pull viz/domain/path/pid/range straight off the saved URL. The URL is
 * the source of truth; storage stays minimal. Tolerates malformed URLs
 * (rare, but possible if someone pasted in something hand-rolled). */
function parseMetadataFromUrl(rawUrl: string): ParsedMetadata {
  try {
    const u = new URL(rawUrl);
    const params = u.searchParams;
    const vizRaw = params.get("viz");
    const startMs = Number(params.get("startMs"));
    const endMs = Number(params.get("endMs"));
    return {
      viz: vizRaw ? vizRaw.split(",").map((s) => s.trim()).filter(Boolean) : [],
      domain: params.get("domain") ?? "",
      path: params.get("path") ?? "",
      pid: params.get("user") ?? "",
      range:
        Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
          ? { startMs, endMs }
          : null,
    };
  } catch {
    return { viz: [], domain: "", path: "", pid: "", range: null };
  }
}

function shortenPid(pid: string): string {
  if (!pid) return "";
  if (pid.length <= 12) return pid;
  return `${pid.slice(0, 7)}…${pid.slice(-4)}`;
}

const VIZ_LABELS: Record<string, string> = {
  trails: "moving",
  navigation: "browsing",
  clicks: "clicking",
  typing: "typing",
  scrolling: "scrolling",
  favicons: "sites",
};

function formatDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatRange(range: { startMs: number; endMs: number }): string {
  const start = new Date(range.startMs);
  const end = new Date(range.endMs);
  const sameDay = start.toDateString() === end.toDateString();
  if (sameDay) {
    return `${formatDate(range.startMs)} ${formatTime(range.startMs)}–${formatTime(range.endMs)}`;
  }
  return `${formatDate(range.startMs)} → ${formatDate(range.endMs)}`;
}

const VizPill: React.FC<{ id: string }> = ({ id }) => (
  <span
    style={{
      display: "inline-block",
      padding: "2px 7px",
      marginRight: 4,
      fontSize: 10,
      fontFamily: "'Martian Mono', monospace",
      letterSpacing: "0.4px",
      textTransform: "uppercase",
      background: "#f5f0e8",
      border: "1px solid rgba(61,56,51,0.12)",
      borderRadius: 999,
      color: "#3d3833",
    }}
  >
    {VIZ_LABELS[id] ?? id}
  </span>
);

/** Inline multi-screen installation builder for one saved config. Turns the
 * config's share URL into a master + N follower URLs (all same-origin so the
 * BroadcastChannel clock/claims connect), with copy + open-in-new-window
 * actions. The screens coordinate at runtime — no per-cursor setup here. */
const InstallationPanel: React.FC<{ sourceUrl: string }> = ({ sourceUrl }) => {
  const [followerCount, setFollowerCount] = useState(2);
  const [copied, setCopied] = useState<string | null>(null);

  const screens = useMemo(
    () =>
      buildInstallationScreens(
        sourceUrl,
        followerCount,
        typeof window !== "undefined" ? window.location.origin : undefined,
      ),
    [sourceUrl, followerCount],
  );

  const copy = (url: string) => {
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(url);
        window.setTimeout(() => setCopied((c) => (c === url ? null : c)), 1500);
      },
      () => {},
    );
  };

  // Opening many windows at once is a popup-blocker magnet — the browser may
  // block all but the first. Each screen also has its own open button below for
  // that case (each click is its own user gesture).
  const openWindow = (url: string) => {
    window.open(url, "_blank", "noopener");
  };

  return (
    <div
      style={{
        gridColumn: "1 / -1",
        marginTop: 12,
        padding: "14px 16px",
        borderRadius: 6,
        background: "#f5f0e8",
        border: "1px solid rgba(61,56,51,0.1)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <span
          style={{
            fontFamily: "'Martian Mono', monospace",
            fontSize: 11,
            letterSpacing: "0.5px",
            textTransform: "uppercase",
            color: "#8a8279",
          }}
        >
          follower screens
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            onClick={() => setFollowerCount((n) => Math.max(0, n - 1))}
            style={stepperBtnStyle}
            title="Fewer follower screens"
          >
            −
          </button>
          <span
            style={{
              minWidth: 20,
              textAlign: "center",
              fontFamily: "'Martian Mono', monospace",
              fontSize: 14,
              color: "#3d3833",
            }}
          >
            {followerCount}
          </span>
          <button
            type="button"
            onClick={() => setFollowerCount((n) => Math.min(8, n + 1))}
            style={stepperBtnStyle}
            title="More follower screens"
          >
            +
          </button>
        </div>
        <span style={{ fontSize: 11, color: "#8a8279" }}>
          1 master + {followerCount} zoomed{" "}
          {followerCount === 1 ? "follower" : "followers"}
        </span>
        <button
          type="button"
          onClick={() => screens.forEach((s) => openWindow(s.url))}
          style={{ ...pillBtnStyle, marginLeft: "auto" }}
          title="Open the master + every follower window (allow popups if blocked)"
        >
          open all screens
        </button>
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {screens.map((s) => (
          <li
            key={s.label}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "6px 0",
            }}
          >
            <span
              style={{
                minWidth: 96,
                fontFamily: "'Martian Mono', monospace",
                fontSize: 11,
                letterSpacing: "0.3px",
                color: s.role === "master" ? "#c4724e" : "#4a9a8a",
              }}
            >
              {s.label}
            </span>
            <code
              style={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: 11,
                color: "#5b8db8",
                background: "#fdfcf9",
                border: "1px solid rgba(61,56,51,0.08)",
                borderRadius: 4,
                padding: "4px 8px",
              }}
              title={s.url}
            >
              {s.url}
            </code>
            <button
              type="button"
              onClick={() => copy(s.url)}
              style={pillBtnStyle}
              title="Copy URL"
            >
              {copied === s.url ? "copied" : "copy"}
            </button>
            <button
              type="button"
              onClick={() => openWindow(s.url)}
              style={pillBtnStyle}
              title="Open in a new window"
            >
              open
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const stepperBtnStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  border: "1px solid rgba(61,56,51,0.18)",
  borderRadius: 4,
  background: "#fdfcf9",
  color: "#3d3833",
  fontSize: 16,
  lineHeight: 1,
  cursor: "pointer",
};

const pillBtnStyle: React.CSSProperties = {
  border: "1px solid rgba(61,56,51,0.18)",
  borderRadius: 999,
  background: "#fdfcf9",
  color: "#3d3833",
  fontFamily: "'Martian Mono', monospace",
  fontSize: 10,
  letterSpacing: "0.3px",
  textTransform: "uppercase",
  padding: "4px 10px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const SavedConfigsPage: React.FC = () => {
  const [configs, setConfigs] = useState<SavedConfig[]>(() =>
    loadSavedConfigs(),
  );
  const [query, setQuery] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmTimerRef = useRef<number | null>(null);
  // Which config's multi-screen installation builder panel is expanded.
  const [installOpenId, setInstallOpenId] = useState<string | null>(null);

  // Cross-tab sync: when the dev panel saves/deletes in another tab, this
  // page reflects the change without a manual reload.
  useEffect(() => {
    const unsub = subscribeSavedConfigs((next) => setConfigs(next));
    return unsub;
  }, []);

  // Reset the "click again to confirm" state if the user wanders away.
  useEffect(() => {
    return () => {
      if (confirmTimerRef.current !== null) {
        window.clearTimeout(confirmTimerRef.current);
      }
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return configs;
    return configs.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true;
      const meta = parseMetadataFromUrl(c.url);
      if (meta.domain.toLowerCase().includes(q)) return true;
      if (meta.path.toLowerCase().includes(q)) return true;
      if (meta.pid.toLowerCase().includes(q)) return true;
      if (meta.viz.some((v) => (VIZ_LABELS[v] ?? v).toLowerCase().includes(q)))
        return true;
      return false;
    });
  }, [configs, query]);

  const handleDeleteClick = (id: string) => {
    if (confirmDeleteId === id) {
      setConfigs((prev) => deleteSavedConfig(prev, id));
      setConfirmDeleteId(null);
      if (confirmTimerRef.current !== null) {
        window.clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
      return;
    }
    setConfirmDeleteId(id);
    if (confirmTimerRef.current !== null) {
      window.clearTimeout(confirmTimerRef.current);
    }
    confirmTimerRef.current = window.setTimeout(() => {
      setConfirmDeleteId(null);
      confirmTimerRef.current = null;
    }, 3000);
  };

  return (
    <div
      style={{
        maxWidth: 960,
        margin: "0 auto",
        padding: "32px 24px 64px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          marginBottom: 24,
          gap: 24,
          flexWrap: "wrap",
        }}
      >
        <div>
          <a
            href="/archive/"
            style={{
              display: "inline-block",
              marginBottom: 8,
              fontSize: 12,
              color: "#8a8279",
              textDecoration: "none",
            }}
          >
            ← back to archive
          </a>
          <h1
            style={{
              margin: 0,
              fontFamily: "'Source Serif 4', Georgia, serif",
              fontStyle: "italic",
              fontWeight: 200,
              fontSize: 36,
              color: "#3d3833",
            }}
          >
            saved configurations
          </h1>
          <div
            style={{
              marginTop: 4,
              fontSize: 12,
              color: "#8a8279",
              fontFamily: "'Martian Mono', monospace",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
            }}
          >
            {configs.length} saved
            {filtered.length !== configs.length
              ? ` · ${filtered.length} matching`
              : ""}
          </div>
        </div>

        <input
          type="text"
          placeholder="search title, viz, domain, path, user…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: "1 1 280px",
            maxWidth: 380,
            padding: "8px 12px",
            fontSize: 13,
            fontFamily: "inherit",
            background: "#fdfcf9",
            border: "1px solid rgba(61,56,51,0.15)",
            borderRadius: 4,
          }}
        />
      </header>

      {configs.length === 0 ? (
        <div
          style={{
            padding: "48px 24px",
            textAlign: "center",
            color: "#8a8279",
            background: "#fdfcf9",
            border: "1px solid rgba(61,56,51,0.08)",
            borderRadius: 6,
          }}
        >
          <p style={{ margin: 0, fontSize: 14 }}>
            No saved configurations yet.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 12 }}>
            Open the portrait, tweak the controls, and use the Save button at
            the top of the dev panel.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div
          style={{
            padding: "32px",
            textAlign: "center",
            color: "#8a8279",
            fontSize: 13,
          }}
        >
          No matches for “{query}”.
        </div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            border: "1px solid rgba(61,56,51,0.08)",
            borderRadius: 6,
            background: "#fdfcf9",
          }}
        >
          {filtered.map((cfg, idx) => {
            const meta = parseMetadataFromUrl(cfg.url);
            const confirming = confirmDeleteId === cfg.id;
            return (
              <li
                key={cfg.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 16,
                  padding: "14px 18px",
                  borderBottom:
                    idx < filtered.length - 1
                      ? "1px solid rgba(61,56,51,0.06)"
                      : "none",
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <a
                    href={cfg.url}
                    target="_blank"
                    rel="noreferrer"
                    title="Open in new tab"
                    style={{
                      display: "block",
                      fontSize: 15,
                      fontWeight: 600,
                      color: "#3d3833",
                      textDecoration: "none",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cfg.name}
                  </a>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      alignItems: "center",
                      marginTop: 6,
                    }}
                  >
                    {meta.viz.map((v) => (
                      <VizPill key={v} id={v} />
                    ))}
                    {(meta.domain || meta.path) && (
                      <span
                        style={{
                          fontSize: 11,
                          fontFamily: "'Martian Mono', monospace",
                          color: "#5b8db8",
                          letterSpacing: "0.3px",
                        }}
                      >
                        {meta.domain || "*"}
                        {meta.path
                          ? (meta.path.startsWith("/") ? "" : "/") + meta.path
                          : ""}
                      </span>
                    )}
                    {meta.range && (
                      <span
                        style={{
                          fontSize: 11,
                          color: "#4a9a8a",
                          fontFamily: "'Martian Mono', monospace",
                          letterSpacing: "0.3px",
                        }}
                      >
                        {formatRange(meta.range)}
                      </span>
                    )}
                    {meta.pid && (
                      <span
                        title={meta.pid}
                        style={{
                          fontSize: 11,
                          color: "#c4724e",
                          fontFamily: "'Martian Mono', monospace",
                          letterSpacing: "0.3px",
                        }}
                      >
                        ~{shortenPid(meta.pid)}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      marginTop: 6,
                      fontSize: 11,
                      color: "#8a8279",
                      fontFamily: "'Martian Mono', monospace",
                      letterSpacing: "0.4px",
                    }}
                  >
                    saved {formatDate(cfg.createdAt)} ·{" "}
                    {formatTime(cfg.createdAt)}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() =>
                      setInstallOpenId((cur) =>
                        cur === cfg.id ? null : cfg.id,
                      )
                    }
                    title="Set up a multi-screen installation from this config"
                    style={{
                      background:
                        installOpenId === cfg.id ? "#4a9a8a" : "transparent",
                      color: installOpenId === cfg.id ? "#faf7f2" : "#4a9a8a",
                      border: "1px solid #4a9a8a",
                      borderRadius: 999,
                      padding: "4px 10px",
                      fontSize: 10,
                      lineHeight: 1,
                      fontFamily: "'Martian Mono', monospace",
                      letterSpacing: "0.3px",
                      textTransform: "uppercase",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ⧉ install
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteClick(cfg.id)}
                    title={
                      confirming
                        ? "Click again to confirm delete"
                        : "Delete this saved config"
                    }
                    style={{
                      background: confirming ? "#c4724e" : "transparent",
                      color: confirming ? "#faf7f2" : "#8a8279",
                      border: confirming
                        ? "1px solid #c4724e"
                        : "1px solid rgba(61,56,51,0.18)",
                      borderRadius: 4,
                      padding: confirming ? "4px 10px" : "2px 8px",
                      fontSize: confirming ? 11 : 16,
                      lineHeight: 1,
                      fontFamily: confirming
                        ? "'Martian Mono', monospace"
                        : "inherit",
                      letterSpacing: confirming ? "0.5px" : undefined,
                      textTransform: confirming ? "uppercase" : undefined,
                      cursor: "pointer",
                      minWidth: confirming ? 80 : 28,
                    }}
                  >
                    {confirming ? "Confirm" : "×"}
                  </button>
                </div>

                {installOpenId === cfg.id && (
                  <InstallationPanel sourceUrl={cfg.url} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

ReactDOM.createRoot(
  document.getElementById("reactContent") as HTMLElement,
).render(<SavedConfigsPage />);
