// ABOUTME: Provides the browser admin console for inspecting and managing PlayHTML rooms.
// ABOUTME: Includes backup comparison tools for restoring collaborative document state.
import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { useStickyState } from "./hooks/useStickyState";
import { findDocumentRowInBackup } from "./utils/backup";
import {
  createComparisonSummary,
  createInlineDiffLookup,
  type InlineDiffLookup,
} from "./utils/adminComparison";
import { deriveRoomId } from "@playhtml/common";
import { extractRecords, type ModerationRecord } from "@moderation";
import {
  formatAdminResetSuccess,
  formatAdminResetWarning,
} from "./adminMessages";
import { HOSTS, type EnvName } from "./adminHosts";

// Types from the original admin.ts
interface RoomData {
  subscribers?: Array<{
    consumerRoomId: string;
    elementIds?: string[];
  }>;
  sharedReferences?: Array<{
    sourceRoomId: string;
    elementIds: string[];
  }>;
  sharedPermissions?: Record<string, "read-only" | "read-write">;
  ydoc?: any;
  connections?: number;
  timestamp?: string;
  roomId?: string;
  documentSize?: number;
}

interface DebugLog {
  timestamp: Date;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: any;
}

// Auto-detect environment based on current hostname
function detectEnvironment(): EnvName {
  const hostname = window.location.hostname;

  // Development: localhost or 127.0.0.1
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.includes("localhost")
  ) {
    return "development";
  }

  // Staging: staging subdomain or ngrok
  if (hostname.includes("staging") || hostname.includes("ngrok-free")) {
    return "staging";
  }

  // Default to production
  return "production";
}

// Environment Display Component (read-only)
const EnvironmentDisplay: React.FC<{
  currentEnv: EnvName;
}> = ({ currentEnv }) => {
  const envColors: Record<
    EnvName,
    { bg: string; color: string; border: string }
  > = {
    production: { bg: "#FED7D7", color: "#9B2C2C", border: "#FEB2B2" },
    staging: { bg: "#FEFCBF", color: "#744210", border: "#F6E05E" },
    development: { bg: "#BEE3F8", color: "#2C5282", border: "#90CDF4" },
  };

  const currentColors = envColors[currentEnv];

  return (
    <div
      style={{
        padding: "6px 12px",
        borderRadius: "16px",
        fontWeight: "700",
        border: `1px solid ${currentColors.border}`,
        fontSize: "0.9rem",
        background: currentColors.bg,
        color: currentColors.color,
        display: "inline-block",
      }}
      title={`Environment: ${currentEnv} (${HOSTS[currentEnv]})`}
    >
      ENV: {currentEnv.toUpperCase()}
    </div>
  );
};

// JSON Viewer Component
const JSONViewer: React.FC<{
  data: any;
  depth?: number;
  inlineDiff?: InlineDiffLookup["admin"];
}> = ({ data, depth = 0, inlineDiff }) => {
  // Track explicitly toggled items: true = collapsed, false = expanded
  const [toggledItems, setToggledItems] = useState<Map<string, boolean>>(
    new Map()
  );
  const inlineDiffPaths = React.useMemo(
    () => Object.keys(inlineDiff ?? {}),
    [inlineDiff]
  );

  const toggleCollapsed = (id: string, currentState: boolean) => {
    setToggledItems((prev) => {
      const next = new Map(prev);
      next.set(id, !currentState);
      return next;
    });
  };

  const getRowClassName = (path: string): string | undefined => {
    const marker = inlineDiff?.[path];
    return marker ? `json-diff-row ${marker}` : undefined;
  };

  const pathContainsInlineDiff = (path: string): boolean => {
    if (!path) return inlineDiffPaths.length > 0;
    return inlineDiffPaths.some(
      (diffPath) =>
        diffPath === path ||
        diffPath.startsWith(`${path}.`) ||
        diffPath.startsWith(`${path}[`)
    );
  };

  const renderValue = (
    obj: any,
    currentDepth: number = 0,
    path: string = ""
  ): React.ReactNode => {
    if (obj === null) {
      return <span className="json-null">null</span>;
    }

    if (typeof obj === "string") {
      const isBase64Document =
        obj.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(obj);
      const className = isBase64Document
        ? "json-string base64-data"
        : "json-string";
      const displayText = isBase64Document ? obj.substring(0, 50) + "..." : obj;
      const title = isBase64Document
        ? `Base64 document (${obj.length} chars) - hover to expand`
        : obj;

      return (
        <span className={className} title={title}>
          "{displayText}"
        </span>
      );
    }

    if (typeof obj === "number") {
      return <span className="json-number">{obj}</span>;
    }

    if (typeof obj === "boolean") {
      return <span className="json-boolean">{obj.toString()}</span>;
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        return <span className="json-bracket">[]</span>;
      }

      const id = `array-${path}`;
      const shouldAutoExpand =
        pathContainsInlineDiff(path) || (obj.length <= 7 && currentDepth <= 4);
      // If user has toggled, use that; otherwise use auto-expand logic
      const isCollapsed = toggledItems.has(id)
        ? toggledItems.get(id)!
        : !shouldAutoExpand;

      return (
        <>
          <span
            className={`json-expandable ${isCollapsed ? "collapsed" : ""}`}
            onClick={() => toggleCollapsed(id, isCollapsed)}
            style={{ cursor: "pointer" }}
          >
            <span className="json-bracket">[</span>
            <span className="json-count">{obj.length}</span>
            <span className="json-bracket">]</span>
          </span>
          <div
            className={`json-content ${isCollapsed ? "collapsed" : ""}`}
            style={{ marginLeft: "12px" }}
          >
            {!isCollapsed &&
              obj.map((item, index) => {
                const itemPath = `${path}[${index}]`;
                return (
                  <div
                    key={index}
                    className={getRowClassName(itemPath)}
                    style={{ marginLeft: "20px" }}
                  >
                    <span className="json-index">{index}:</span>{" "}
                    {renderValue(item, currentDepth + 1, itemPath)}
                  </div>
                );
              })}
          </div>
        </>
      );
    }

    if (typeof obj === "object") {
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        return <span className="json-bracket">{}</span>;
      }

      const id = `object-${path}`;
      const shouldAutoExpand =
        pathContainsInlineDiff(path) || (keys.length <= 7 && currentDepth <= 4);
      // If user has toggled, use that; otherwise use auto-expand logic
      const isCollapsed = toggledItems.has(id)
        ? toggledItems.get(id)!
        : !shouldAutoExpand;

      return (
        <>
          <span
            className={`json-expandable ${isCollapsed ? "collapsed" : ""}`}
            onClick={() => toggleCollapsed(id, isCollapsed)}
            style={{ cursor: "pointer" }}
          >
            <span className="json-bracket">{"{"}</span>
            <span className="json-count">{keys.length}</span>
            <span className="json-bracket">{"}"}</span>
          </span>
          <div
            className={`json-content ${isCollapsed ? "collapsed" : ""}`}
            style={{ marginLeft: "12px" }}
          >
            {!isCollapsed &&
              keys.map((key) => {
                const childPath = path ? `${path}.${key}` : key;
                return (
                  <div
                    key={key}
                    className={getRowClassName(childPath)}
                    style={{ marginLeft: "20px" }}
                  >
                    <span className="json-key">"{key}"</span>
                    <span className="json-colon">:</span>{" "}
                    {renderValue(obj[key], currentDepth + 1, childPath)}
                  </div>
                );
              })}
          </div>
        </>
      );
    }

    return String(obj);
  };

  return (
    <div className="interactive-json-viewer">{renderValue(data, depth)}</div>
  );
};

// Collapsible Section Header Component
const SectionHeader: React.FC<{
  title: string;
  sectionKey: string;
  isExpanded: boolean;
  onToggle: (key: string) => void;
  actions?: React.ReactNode;
}> = ({ title, sectionKey, isExpanded, onToggle, actions }) => {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "10px",
        cursor: "pointer",
      }}
      onClick={() => onToggle(sectionKey)}
    >
      <h3
        style={{
          margin: 0,
          display: "flex",
          alignItems: "center",
          gap: "8px",
        }}
      >
        <span style={{ fontSize: "0.9em" }}>{isExpanded ? "▼" : "▶"}</span>
        {title}
      </h3>
      {actions && <div onClick={(e) => e.stopPropagation()}>{actions}</div>}
    </div>
  );
};

// Debug Log Component
const DebugLogs: React.FC<{
  logs: DebugLog[];
  onClearLogs: () => void;
}> = ({ logs, onClearLogs }) => {
  const [autoScroll, setAutoScroll] = useState(true);
  const logOutputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && logOutputRef.current) {
      logOutputRef.current.scrollTop = logOutputRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  return (
    <section className="logs-section">
      <h2>Debug Logs</h2>
      <div className="log-controls">
        <button onClick={onClearLogs}>Clear Logs</button>
        <label>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
      </div>
      <div ref={logOutputRef} className="log-output">
        {logs.map((log, index) => (
          <div key={index} className={`log-entry ${log.level}`}>
            <span className="timestamp">
              [{log.timestamp.toLocaleTimeString()}]
            </span>{" "}
            {log.message}
            {log.data && ` ${JSON.stringify(log.data)}`}
          </div>
        ))}
      </div>
    </section>
  );
};

// Main Admin Console Component

// Validate admin token by attempting to call an admin endpoint
async function validateAdminToken(
  token: string,
  host: string
): Promise<boolean> {
  try {
    // Use a dummy room ID to test authentication
    // The endpoint will return 401 if token is invalid, 404 if token is valid but room doesn't exist
    const testRoomId = encodeURIComponent("__auth-test__");
    const url = `${host}/parties/main/${testRoomId}/admin/inspect?token=${encodeURIComponent(
      token
    )}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    // 401 means unauthorized (invalid token)
    if (response.status === 401) {
      return false;
    }

    // Any other status (200, 404, etc.) means token is valid
    // (404 is expected since the test room doesn't exist)
    return true;
  } catch (error) {
    console.error("Token validation error:", error);
    return false;
  }
}

// Login Screen Component
const LoginScreen: React.FC<{
  onLogin: (token: string) => void;
  currentEnv: EnvName;
}> = ({ onLogin, currentEnv }) => {
  const [token, setToken] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    if (!token.trim()) return;

    setIsValidating(true);
    setError(null);

    const host = HOSTS[currentEnv];
    const isValid = await validateAdminToken(token.trim(), host);

    setIsValidating(false);

    if (isValid) {
      onLogin(token.trim());
    } else {
      setError("Invalid admin token. Please check your token and try again.");
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
        background: "#f7fafc",
      }}
    >
      <div
        style={{
          background: "white",
          padding: "2rem",
          borderRadius: "12px",
          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
          width: "100%",
          maxWidth: "400px",
          textAlign: "center",
        }}
      >
        <h1 style={{ marginTop: 0, marginBottom: "1.5rem" }}>
          🛠️ PlayHTML Admin
        </h1>

        <div style={{ marginBottom: "1.5rem" }}>
          <label
            style={{
              display: "block",
              marginBottom: "0.5rem",
              fontWeight: "bold",
              fontSize: "0.9rem",
              color: "#4a5568",
            }}
          >
            Environment
          </label>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <EnvironmentDisplay currentEnv={currentEnv} />
          </div>
        </div>

        <div style={{ marginBottom: "1.5rem" }}>
          <label
            style={{
              display: "block",
              marginBottom: "0.5rem",
              fontWeight: "bold",
              fontSize: "0.9rem",
              color: "#4a5568",
            }}
          >
            Admin Token
          </label>
          <input
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError(null);
            }}
            placeholder="Enter admin token..."
            style={{
              width: "100%",
              padding: "0.75rem",
              border: error ? "1px solid #e53e3e" : "1px solid #e2e8f0",
              borderRadius: "6px",
              fontSize: "1rem",
              boxSizing: "border-box",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && token && !isValidating) {
                handleLogin();
              }
            }}
            disabled={isValidating}
            autoFocus
          />
          {error && (
            <div
              style={{
                marginTop: "0.5rem",
                color: "#e53e3e",
                fontSize: "0.875rem",
                textAlign: "left",
              }}
            >
              {error}
            </div>
          )}
        </div>

        <button
          onClick={handleLogin}
          disabled={!token || isValidating}
          style={{
            width: "100%",
            padding: "0.75rem",
            background: token && !isValidating ? "#3182ce" : "#a0aec0",
            color: "white",
            border: "none",
            borderRadius: "6px",
            fontSize: "1rem",
            fontWeight: "bold",
            cursor: token && !isValidating ? "pointer" : "not-allowed",
            transition: "background 0.2s",
          }}
        >
          {isValidating ? "Validating..." : "Access Console"}
        </button>
      </div>
    </div>
  );
};

const AdminConsole: React.FC = () => {
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [currentRoomId, setCurrentRoomId] = useState<string>("");
  const [urlInput, setUrlInput] = useState<string>("");
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  // Auto-detect environment - cannot be changed
  const hostEnv = detectEnvironment();
  const [roomStatus, setRoomStatus] = useState<{
    message: string;
    type: "loading" | "success" | "error" | "empty";
  } | null>(null);

  const [_showBackupComparison, setShowBackupComparison] = useState(false);

  // Section collapse/expand state
  const [sectionsExpanded, setSectionsExpanded] = useState<
    Record<string, boolean>
  >({
    ydocData: true,
    roomMetadata: true,
    sharedData: true,
    rawDbData: false,
    dataComparison: false,
    backupComparison: true,
    cleanupTools: false, // Collapsed by default
  });

  const toggleSection = (section: string) => {
    setSectionsExpanded((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Debug data
  const [rawDbData, setRawDbData] = useState<any>(null);
  const [comparisonData, setComparisonData] = useState<any>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [backupComparisonData, setBackupComparisonData] = useState<any>(null);

  const [debugToolsEnabled, setDebugToolsEnabled] = useState(false);
  const [editableJson, setEditableJson] = useState<string>("");
  const [jsonError, setJsonError] = useState<string>("");
  const [currentBackupFile, setCurrentBackupFile] = useState<File | null>(null);
  const [_backupBase64, setBackupBase64] = useState<string | null>(null);
  const [savedBackupPath, setSavedBackupPath] = useStickyState<string | null>(
    "playhtml-admin-backup-path",
    null
  );

  // Cleanup section state
  const [selectedCleanupTag, setSelectedCleanupTag] =
    useState<string>("can-move");
  const [cleanupSourceElementId, setCleanupSourceElementId] =
    useState<string>("newWords");
  const [cleanupDryRunResult, setCleanupDryRunResult] = useState<any>(null);
  const [isCleanupRunning, setIsCleanupRunning] = useState(false);

  // Moderation section state
  const [modSelected, setModSelected] = useState<Set<string>>(new Set());
  const [modPaste, setModPaste] = useState("");
  const [modResult, setModResult] = useState<
    {
      removed: number;
      skipped: { key: string; reason: string }[];
      closedConnections?: number | null;
      documentSize?: number | null;
      resetEpoch?: number | null;
    } | null
  >(null);
  const [modExpanded, setModExpanded] = useState<Set<string>>(new Set());
  const [activeToolTab, setActiveToolTab] = useStickyState<"moderate" | "tools">(
    "playhtml-admin-tool-tab",
    "moderate"
  );
  const [modFilter, setModFilter] = useStickyState<"flagged" | "all" | "unflagged">(
    "playhtml-admin-mod-filter",
    "all"
  );
  const [modCopied, setModCopied] = useState(false);

  // Utility functions
  const addLog = useCallback(
    (level: DebugLog["level"], message: string, data?: any) => {
      const filteredData =
        data && typeof data === "object"
          ? filterLargeDataForLogging(data)
          : data;

      const logEntry: DebugLog = {
        timestamp: new Date(),
        level,
        message,
        data: filteredData,
      };

      setLogs((prev) => {
        const newLogs = [...prev, logEntry];
        return newLogs.length > 1000 ? newLogs.slice(-1000) : newLogs;
      });
    },
    []
  );

  const filterLargeDataForLogging = (obj: any): any => {
    if (!obj || typeof obj !== "object") return obj;

    const filtered: any = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      if (
        key === "document" &&
        typeof value === "string" &&
        value.length > 100
      ) {
        filtered[key] = `[Base64 data - ${value.length} chars]`;
      } else if (typeof value === "string" && value.length > 500) {
        filtered[key] = `[Large string - ${
          value.length
        } chars]: ${value.substring(0, 100)}...`;
      } else if (value && typeof value === "object") {
        filtered[key] = filterLargeDataForLogging(value);
      } else {
        filtered[key] = value;
      }
    }

    return filtered;
  };

  const getPartykitHost = () => HOSTS[hostEnv];

  const getActiveConnectionCount = () => roomData?.connections ?? 0;

  const confirmAdminReset = (options: {
    action: string;
    detail?: string;
  }) =>
    confirm(
      formatAdminResetWarning({
        ...options,
        activeConnections: getActiveConnectionCount(),
      })
    );

  const decodeRoomId = (encodedId: string): string => {
    try {
      return decodeURIComponent(encodedId);
    } catch {
      return encodedId;
    }
  };

  const ensureEncodedRoomId = (roomId: string): string => {
    // Check if the room ID is already URL encoded by trying to decode it
    try {
      const decoded = decodeURIComponent(roomId);
      // If decoding produces a different result, it was already encoded
      if (decoded !== roomId) {
        return roomId;
      }
      // Otherwise, encode it
      return encodeURIComponent(roomId);
    } catch {
      // If decoding fails, assume it needs encoding
      return encodeURIComponent(roomId);
    }
  };

  const getRoomBaseUrl = (roomId: string): string =>
    `${getPartykitHost()}/parties/main/${ensureEncodedRoomId(roomId)}`;

  // Derive room ID from URL
  const deriveRoomIdFromUrl = (urlString: string): string | null => {
    if (!urlString || urlString.trim() === "") {
      return null;
    }

    try {
      // Add protocol if missing
      let urlToParse = urlString.trim();
      if (!urlToParse.match(/^https?:\/\//i)) {
        urlToParse = `https://${urlToParse}`;
      }

      const url = new URL(urlToParse);
      // Use the library's canonical room ID derivation so the admin console
      // matches the room names playhtml actually creates (including the path
      // for root URLs, e.g. wewere.online-/ ).
      return deriveRoomId(url.host, url.pathname);
    } catch (error) {
      // Silently fail if URL is incomplete - user might still be typing
      return null;
    }
  };

  const handleUrlChange = (url: string) => {
    setUrlInput(url);
    const derivedRoomId = deriveRoomIdFromUrl(url);
    if (derivedRoomId) {
      setCurrentRoomId(derivedRoomId);
      addLog(
        "info",
        `Derived room ID from URL: ${decodeRoomId(derivedRoomId)}`
      );
      // Auto-load room if authenticated
      if (adminToken) {
        // Call loadRoom directly with the derived room ID
        // Note: loadRoom and updateURLWithRoom are defined later but will be available when this is called
        loadRoom(derivedRoomId);
      }
    }
  };

  const validateAndFormatJson = (
    jsonStr: string
  ): { valid: boolean; formatted?: string; error?: string } => {
    try {
      const parsed = JSON.parse(jsonStr);
      const formatted = JSON.stringify(parsed, null, 2);
      return { valid: true, formatted };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return { valid: false, error: msg };
    }
  };

  // Load stored auth on mount and handle browser navigation
  useEffect(() => {
    const stored = localStorage.getItem("playhtml-admin-token");
    if (stored) {
      setAdminToken(stored);
    }

    // Load room from URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get("room");
    if (roomId) {
      setCurrentRoomId(roomId);
      addLog("info", `Loaded room ID from URL: ${roomId}`);
    }

    // Handle browser back/forward navigation
    const handlePopState = (event: PopStateEvent) => {
      const urlParams = new URLSearchParams(window.location.search);
      const roomId = urlParams.get("room");
      if (roomId) {
        setCurrentRoomId(roomId);
        // Clear previous room data immediately
        setRoomData(null);
        setRoomStatus(null);
        setRawDbData(null);
        setComparisonData(null);
        setComparisonError(null);
        setShowBackupComparison(false);
        setBackupComparisonData(null);
        setBackupBase64(null);
        setDebugToolsEnabled(false);
        // Load new room data if authenticated
        if (stored || adminToken) {
          loadRoom(roomId);
        }
      } else {
        setCurrentRoomId("");
        setRoomData(null);
        setRoomStatus(null);
        setRawDbData(null);
        setComparisonData(null);
        setComparisonError(null);
        setShowBackupComparison(false);
        setBackupComparisonData(null);
        setBackupBase64(null);
        setDebugToolsEnabled(false);
      }
    };

    window.addEventListener("popstate", handlePopState);
    addLog("info", "Admin console initialized");

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [addLog]); // Remove adminToken dependency to avoid infinite loops

  // Auto-load room if we have auth and room ID from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get("room");
    if (roomId && adminToken && !roomData) {
      loadRoom(roomId);
    }
  }, [adminToken, roomData]); // eslint-disable-line react-hooks/exhaustive-deps

  // OPFS helper functions for storing backup files
  const saveBackupToOPFS = async (file: File): Promise<void> => {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle("backup-file", {
        create: true,
      });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
      setSavedBackupPath(file.name);
      addLog("info", `Backup file saved to OPFS: ${file.name}`);
    } catch (error) {
      addLog(
        "error",
        `Failed to save backup to OPFS: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  };

  const loadBackupFromOPFS = async (): Promise<File | null> => {
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle("backup-file");
      const file = await fileHandle.getFile();
      return file;
    } catch (error) {
      // File doesn't exist or other error
      return null;
    }
  };

  const clearBackupFromOPFS = async (): Promise<void> => {
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry("backup-file");
      setSavedBackupPath(null);
      addLog("info", "Backup file removed from OPFS");
    } catch (error) {
      // File doesn't exist, that's fine
      console.warn("Failed to remove backup from OPFS:", error);
    }
  };

  // Populate backupComparisonData from roomData when roomData is available
  useEffect(() => {
    if (roomData && roomData.ydoc?.play) {
      const currentData = {
        data: roomData.ydoc.play,
        timestamp: roomData.timestamp || new Date().toISOString(),
        hasData: Object.keys(roomData.ydoc.play).length > 0,
      };
      const liveData = {
        data: roomData.ydoc.play,
        hasData: Object.keys(roomData.ydoc.play).length > 0,
      };

      // Update or create backupComparisonData, preserving backup if it exists
      setBackupComparisonData((prev: any) => ({
        roomId: currentRoomId,
        backup: prev?.backup || null,
        current: currentData,
        live: liveData,
      }));
    }
  }, [roomData, currentRoomId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load backup from OPFS when room data loads, or re-process when room changes
  useEffect(() => {
    const autoLoadBackup = async () => {
      // If we have room data and a backup file, process it for the current room
      if (roomData && currentRoomId) {
        const roomId = roomData.roomId || currentRoomId;
        if (roomId) {
          // If we have a backup file already loaded, re-process it for the new room
          if (currentBackupFile) {
            addLog(
              "info",
              `Re-processing backup for new room: ${decodeRoomId(roomId)}`
            );
            try {
              await processBackupFile(currentBackupFile, roomId);
            } catch (error) {
              addLog(
                "error",
                `Failed to re-process backup: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
            }
          } else if (savedBackupPath) {
            // First time loading: load from OPFS
            addLog(
              "info",
              `Attempting to auto-load backup: ${savedBackupPath}`
            );
            const file = await loadBackupFromOPFS();
            if (file) {
              addLog(
                "info",
                `Auto-loading backup from OPFS: ${file.name} (${(
                  file.size /
                  1024 /
                  1024
                ).toFixed(2)} MB)`
              );
              setCurrentBackupFile(file);
              await processBackupFile(file, roomId);
            } else {
              addLog("warn", "Saved backup path found but file not in OPFS");
              setSavedBackupPath(null);
            }
          }
        }
      }
    };
    autoLoadBackup();
  }, [roomData, currentRoomId, savedBackupPath, currentBackupFile]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateURLWithRoom = (roomId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    window.history.pushState({ roomId }, "", url.toString());
  };

  const loadRoom = async (roomId?: string) => {
    const targetRoomId = roomId || currentRoomId;

    if (!targetRoomId) {
      setRoomStatus({ message: "Please enter a room ID", type: "error" });
      setRoomData(null);
      setDebugToolsEnabled(false);
      return;
    }

    if (!adminToken) {
      setRoomStatus({
        message:
          'Not authenticated. Please click "Authenticate" and enter your admin token.',
        type: "error",
      });
      setRoomData(null);
      setDebugToolsEnabled(false);
      return;
    }

    // Clear previous data immediately when starting a new load
    setRoomData(null);
    setDebugToolsEnabled(false);
    setRawDbData(null);
    setComparisonData(null);
    setComparisonError(null);
    setSectionsExpanded((prev) => ({
      ...prev,
      rawDbData: false,
      dataComparison: false,
    }));
    setShowBackupComparison(false);
    setBackupComparisonData(null);
    setBackupBase64(null);

    setRoomStatus({ message: "Loading room data...", type: "loading" });

    // Always ensure room ID is properly encoded for URL
    const encodedRoomId = ensureEncodedRoomId(targetRoomId);

    if (!roomId) {
      // Only update if called from button, not from effect
      setCurrentRoomId(encodedRoomId);
    }
    // Always update URL when loading (whether from button or programmatic call)
    updateURLWithRoom(encodedRoomId);

    try {
      // Always use the encoded room ID for API calls
      const data = await fetchRoomData(encodedRoomId);
      setRoomData(data);
      setDebugToolsEnabled(true);

      const createdDate = data.timestamp
        ? new Date(data.timestamp).toLocaleDateString()
        : "unknown";
      const displayRoomId = decodeRoomId(encodedRoomId);
      setRoomStatus({
        message: `✅ Successfully loaded room: ${displayRoomId} (created ${createdDate})`,
        type: "success",
      });
      addLog("info", `Loaded room data for ${displayRoomId}`, data);
      void compareDataMethods({ roomId: encodedRoomId });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const displayRoomId = decodeRoomId(encodedRoomId);
      setRoomStatus({ message: `Failed to load room: ${msg}`, type: "error" });
      addLog("error", `Failed to load room ${displayRoomId}`, error);
      // Keep room data as null on error so UI shows no data
    }
  };

  const fetchRoomData = async (roomId: string): Promise<RoomData> => {
    if (!adminToken) {
      throw new Error(
        'Not authenticated. Please click "Authenticate" and enter your admin token.'
      );
    }

    const baseUrl = getRoomBaseUrl(roomId);
    const url = `${baseUrl}/admin/inspect?token=${encodeURIComponent(
      adminToken
    )}`;

    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      if (response.status === 401) {
        setAdminToken(null);
        localStorage.removeItem("playhtml-admin-token");
        throw new Error(
          "Authentication failed. Please re-authenticate with a valid token."
        );
      }
      if (response.status === 404) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Room has no PlayHTML data");
      }
      throw new Error(
        `Failed to fetch room data: ${response.status} ${response.statusText}`
      );
    }

    return await response.json();
  };

  const exportRoomData = async () => {
    if (!roomData || !currentRoomId) return;

    const dataStr = JSON.stringify(roomData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `room-${currentRoomId}-${
      new Date().toISOString().split("T")[0]
    }.json`;
    a.click();

    URL.revokeObjectURL(url);
    addLog("info", `Exported data for room ${currentRoomId}`);
  };

  const exportRawDocument = async () => {
    if (!currentRoomId || !adminToken) return;

    try {
      const baseUrl = getRoomBaseUrl(currentRoomId);
      const url = `${baseUrl}/admin/raw-data?token=${encodeURIComponent(
        adminToken
      )}`;

      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch raw data: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      if (!data.document?.document) {
        alert("No raw document found to export");
        return;
      }

      // Export the base64 document as a text file
      const blob = new Blob([data.document.document], {
        type: "text/plain",
      });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `room-${currentRoomId}-raw-document-${
        new Date().toISOString().split("T")[0]
      }.txt`;
      a.click();
      URL.revokeObjectURL(downloadUrl);

      addLog(
        "info",
        `Exported raw document (${data.document.base64Length} chars)`
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Failed to export raw document: ${msg}`, error);
      alert(`❌ Failed to export raw document: ${msg}`);
    }
  };

  const restoreRawDocument = async () => {
    if (!currentRoomId || !adminToken) return;

    const ok = confirmAdminReset({
      action: "Restore raw document",
      detail:
        "This will replace the current room's document with the uploaded base64 document.\n\n" +
        "This is a DESTRUCTIVE operation that will:\n" +
        "- Overwrite the current database document\n" +
        "- Replace the live server's document\n" +
        "- May cause data loss if the uploaded document is incorrect",
    });
    if (!ok) return;

    try {
      // Use File System Access API to get a file handle
      const [handle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: "Raw Base64 Document Files",
            accept: {
              "text/plain": [".txt"],
            },
          },
        ],
        multiple: false,
      });

      if (handle) {
        const file = await handle.getFile();
        const base64Document = await file.text();

        addLog(
          "info",
          `Restoring raw document (${base64Document.length} chars)...`
        );

        const baseUrl = getRoomBaseUrl(currentRoomId);
        const url = `${baseUrl}/admin/restore-raw-document?token=${encodeURIComponent(
          adminToken
        )}`;

        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ base64Document }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            errorData.message || `${response.status} ${response.statusText}`
          );
        }

        const result = await response.json();
        addLog("info", "Raw document restored successfully", result);
        alert(
          formatAdminResetSuccess({
            action: "Raw document restored.",
            closedConnections: result.closedConnections,
            documentSize: result.documentSize,
          }) + "\n\nReloading room data..."
        );

        // Reload room data to show updated state
        await loadRoom(currentRoomId);
      }
    } catch (error: unknown) {
      if ((error as any).name === "AbortError") {
        // User cancelled file picker
        return;
      }
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Failed to restore raw document: ${msg}`, error);
      alert(`❌ Failed to restore raw document: ${msg}`);
    }
  };

  const loadRawDatabaseData = async () => {
    if (!currentRoomId || !adminToken) return;

    try {
      const baseUrl = getRoomBaseUrl(currentRoomId);
      const url = `${baseUrl}/admin/raw-data?token=${encodeURIComponent(
        adminToken
      )}`;

      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch raw data: ${response.status} ${response.statusText}`
        );
      }

      const data = await response.json();
      setRawDbData(data);
      setSectionsExpanded((prev) => ({ ...prev, rawDbData: true }));
      addLog("info", "Loaded raw database data", data);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Failed to load raw data: ${msg}`, error);
    }
  };

  const compareDataMethods = async (
    options: { roomId?: string; forceShow?: boolean } = {}
  ) => {
    const targetRoomId = options.roomId || currentRoomId;
    if (!targetRoomId || !adminToken) return;

    try {
      setComparisonLoading(true);
      setComparisonError(null);
      addLog("info", "Comparing data extraction methods...");

      const baseUrl = getRoomBaseUrl(targetRoomId);
      const url = `${baseUrl}/admin/live-compare?token=${encodeURIComponent(
        adminToken
      )}`;

      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch comparison: ${response.status} ${response.statusText}`
        );
      }

      const comparison = await response.json();
      setComparisonData(comparison);
      const summary = createComparisonSummary(comparison);
      const shouldShowDetails = options.forceShow || summary.shouldShowDetails;
      setSectionsExpanded((prev) => ({
        ...prev,
        dataComparison: shouldShowDetails ? true : prev.dataComparison,
      }));
      addLog("info", "Data method comparison results:", comparison);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      setComparisonError(msg);
      setSectionsExpanded((prev) => ({ ...prev, dataComparison: true }));
      addLog("error", `Failed to compare data methods: ${msg}`, error);
    } finally {
      setComparisonLoading(false);
    }
  };

  const handleForceSaveLive = async () => {
    if (!currentRoomId || !adminToken) return;
    const ok = confirm(
      "Force save LIVE doc to DB? This will overwrite the DB snapshot."
    );
    if (!ok) return;

    try {
      const baseUrl = getRoomBaseUrl(currentRoomId);
      const url = `${baseUrl}/admin/force-save-live?token=${encodeURIComponent(
        adminToken
      )}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      addLog("info", "Force-saved live doc to DB");
      alert("✅ Live doc saved to DB. Re-running comparison.");
      await compareDataMethods();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Force save failed: ${msg}`);
      alert(`❌ Force save failed: ${msg}`);
    }
  };

  const handleForceReloadLive = async () => {
    if (!currentRoomId || !adminToken) return;
    const ok = confirmAdminReset({
      action: "Force reload live document from database",
      detail:
        "This will replace the live in-memory document with the current database snapshot.",
    });
    if (!ok) return;

    try {
      const baseUrl = getRoomBaseUrl(currentRoomId);
      const url = `${baseUrl}/admin/force-reload-live?token=${encodeURIComponent(
        adminToken
      )}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const result = await res.json();
      addLog("info", "Force-reloaded live doc from DB", result);
      alert(
        formatAdminResetSuccess({
          action: "Live document reloaded from database.",
          closedConnections: result.closedConnections,
          documentSize: result.documentSize,
        }) + "\n\nRe-running comparison."
      );
      await compareDataMethods();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Force reload failed: ${msg}`);
      alert(`❌ Force reload failed: ${msg}`);
    }
  };

  const handleHardReset = async () => {
    if (!currentRoomId || !adminToken) return;
    const ok = confirmAdminReset({
      action: "Hard reset room document",
      detail:
        "This will recreate the Y.Doc from scratch, removing all history and tombstones.\n\n" +
        "This is a DESTRUCTIVE operation that:\n" +
        "- Strips all YJS deletion history\n" +
        "- Reduces document size significantly\n" +
        "- May cause offline clients to need a refresh",
    });
    if (!ok) return;

    try {
      addLog("info", "Starting Hard Reset (GC)...");
      const baseUrl = getRoomBaseUrl(currentRoomId);
      const url = `${baseUrl}/admin/hard-reset?token=${encodeURIComponent(
        adminToken
      )}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        let errorMessage = `${res.status} ${res.statusText}`;
        try {
          const errorData = await res.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch {
          // If response isn't JSON, use status text
          const text = await res.text();
          if (text) errorMessage = text;
        }
        throw new Error(errorMessage);
      }
      const result = await res.json();
      const beforeMB = (result.beforeSize / 1024 / 1024).toFixed(2);
      const afterMB = (result.afterSize / 1024 / 1024).toFixed(2);
      addLog(
        "info",
        `Hard Reset completed: ${beforeMB}MB -> ${afterMB}MB (${result.sizeReductionPercent} reduction)`,
        result
      );
      alert(
        formatAdminResetSuccess({
          action: "Hard reset completed.",
          closedConnections: result.closedConnections,
          documentSize: result.afterSize,
        }) +
          "\n\n" +
          `Size: ${beforeMB}MB -> ${afterMB}MB\n` +
          `Reduction: ${result.sizeReductionPercent}\n\n` +
          `Reloading room data...`
      );
      // Reload room data to show updated state
      await loadRoom(currentRoomId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Hard Reset failed: ${msg}`, error);
      alert(`❌ Hard Reset failed: ${msg}`);
    }
  };

  const saveEditedDataToDb = async (editedJson: string) => {
    if (!currentRoomId || !adminToken) return;

    try {
      addLog("info", "Parsing edited JSON...");
      const parsedData = JSON.parse(editedJson);

      addLog("info", "Saving authoritative database snapshot...");
      const baseUrl = getRoomBaseUrl(currentRoomId);
      const url = `${baseUrl}/admin/save-edited-data?token=${encodeURIComponent(
        adminToken
      )}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: parsedData }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      addLog(
        "info",
        "Successfully saved edited data and reset clients",
        result
      );

      alert(
        formatAdminResetSuccess({
          action: "Edited data saved.",
          closedConnections: result.closedConnections,
          documentSize: result.documentSize,
        })
      );

      // Reload room data to show updated state
      await loadRoom(currentRoomId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Failed to save edited data: ${msg}`, error);
      alert(`❌ Failed to save edited data: ${msg}`);
    }
  };

  const moderationRecords: ModerationRecord[] = React.useMemo(() => {
    const play = roomData?.ydoc?.play;
    if (!play || typeof play !== "object") return [];
    const recs = extractRecords(play as Record<string, unknown>);
    // Show reported items first when any have report counts.
    return [...recs].sort(
      (a, b) => (b.reportCount ?? -1) - (a.reportCount ?? -1)
    );
  }, [roomData]);

  const recordByKey = React.useMemo(
    () => new Map(moderationRecords.map((r) => [r.key, r])),
    [moderationRecords]
  );

  const visibleModerationRecords = React.useMemo(() => {
    if (modFilter === "flagged") return moderationRecords.filter((r) => modSelected.has(r.key));
    if (modFilter === "unflagged") return moderationRecords.filter((r) => !modSelected.has(r.key));
    return moderationRecords;
  }, [moderationRecords, modFilter, modSelected]);

  const copyRecordsForModel = async () => {
    const preamble =
      "You are moderating user-generated content. Review each item below. " +
      "Return ONLY a JSON array of the `key` values for items that should be " +
      "removed (spam, abuse, hate, explicit content). If nothing should be " +
      "removed, return [].\n\n";
    const payload = moderationRecords.map((r) => ({
      key: r.key,
      id: r.id,
      text: r.text,
      reportCount: r.reportCount,
    }));
    await navigator.clipboard.writeText(
      preamble + JSON.stringify(payload, null, 2)
    );
  };

  const applyPastedKeys = () => {
    // Tolerant: split on the punctuation that wraps keys in a JSON array,
    // comma/newline list, or prose, then intersect with the actual record keys.
    // Matching against recordByKey (rather than a structural regex) means keys
    // whose element ids contain unusual characters are still resolved.
    const tokens = modPaste
      .split(/[\s,"'[\]]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    const next = new Set<string>();
    const unknown: string[] = [];
    for (const token of tokens) {
      if (recordByKey.has(token)) next.add(token);
      // Only flag tokens that look like a key attempt (contain "#"), so prose
      // words and stray punctuation don't get reported as misses.
      else if (token.includes("#")) unknown.push(token);
    }
    setModSelected(next);
    if (next.size > 0) setModFilter("flagged");
    if (unknown.length > 0) {
      alert(
        `Checked ${next.size} rows. ${unknown.length} pasted key(s) matched no current record: ${unknown.join(", ")}`
      );
    }
  };

  const removeSelectedRecords = async () => {
    if (!currentRoomId || !adminToken || modSelected.size === 0) return;
    if (
      !confirmAdminReset({
        action: "Remove selected records",
        detail: `Remove ${modSelected.size} record(s) from the database snapshot. This cannot be undone.`,
      })
    ) {
      return;
    }
    const targets = [...modSelected]
      .map((key) => recordByKey.get(key))
      .filter((r): r is ModerationRecord => Boolean(r))
      .map((r) => ({ key: r.key, contentHash: r.contentHash }));

    try {
      const baseUrl = getRoomBaseUrl(currentRoomId);
      const url = `${baseUrl}/admin/moderation-remove?token=${encodeURIComponent(
        adminToken
      )}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json.message || json.error || `HTTP ${response.status}`);
      }
      setModResult(json);
      setModSelected(new Set());
      addLog(
        "info",
        `Removed ${json.removed}, skipped ${json.skipped?.length ?? 0}, reset ${json.closedConnections ?? 0} clients`
      );
      await loadRoom(currentRoomId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Moderation removal failed: ${msg}`, error);
      alert(`Moderation removal failed: ${msg}`);
    }
  };

  // Extract active IDs from room data
  const extractActiveIds = (): string[] => {
    if (!roomData?.ydoc?.play) return [];

    // For fridge: extract IDs from can-play["newWords"] array
    const sourceTag = "can-play";
    const sourceElementId = cleanupSourceElementId;

    const sourceData = roomData.ydoc.play[sourceTag]?.[sourceElementId];
    if (!sourceData) {
      addLog("warn", `No data found for ${sourceTag}:${sourceElementId}`);
      return [];
    }

    // Handle array of objects with id property
    if (Array.isArray(sourceData)) {
      const ids = sourceData
        .map((item) => (typeof item === "object" && item?.id ? item.id : null))
        .filter((id): id is string => typeof id === "string" && id.length > 0);
      addLog(
        "info",
        `Extracted ${ids.length} active IDs from ${sourceTag}:${sourceElementId}`
      );
      return ids;
    }

    // Handle other data structures if needed
    addLog(
      "warn",
      `Unexpected data structure for ${sourceTag}:${sourceElementId}`
    );
    return [];
  };

  // Perform dry run cleanup
  const performCleanupDryRun = async () => {
    if (!currentRoomId || !adminToken || !roomData) {
      alert("Please load a room first");
      return;
    }

    setIsCleanupRunning(true);
    setCleanupDryRunResult(null);

    try {
      const activeIds = extractActiveIds();
      if (activeIds.length === 0) {
        alert("No active IDs found. Check your source element configuration.");
        setIsCleanupRunning(false);
        return;
      }

      addLog("info", `Running dry run cleanup for ${selectedCleanupTag}...`);

      const baseUrl = getRoomBaseUrl(currentRoomId);
      const url = `${baseUrl}/admin/cleanup-orphans?token=${encodeURIComponent(
        adminToken
      )}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag: selectedCleanupTag,
          activeIds,
          dryRun: true,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      setCleanupDryRunResult(result);
      addLog(
        "info",
        `Dry run completed: ${result.orphaned} orphaned entries found`,
        result
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Dry run failed: ${msg}`, error);
      alert(`❌ Dry run failed: ${msg}`);
    } finally {
      setIsCleanupRunning(false);
    }
  };

  // Execute actual cleanup
  const executeCleanup = async () => {
    if (!currentRoomId || !adminToken || !roomData) {
      alert("Please load a room first");
      return;
    }

    if (!cleanupDryRunResult) {
      alert("Please run a dry run first to see what will be removed");
      return;
    }

    const confirmed = confirmAdminReset({
      action: "Remove orphaned database entries",
      detail:
        `Remove ${cleanupDryRunResult.orphaned} orphaned entries?\n\n` +
        `This will permanently delete data for tag "${selectedCleanupTag}".` +
        (cleanupDryRunResult.orphanedIds?.length > 0
          ? `\n\nFirst 5 IDs to be removed:\n${cleanupDryRunResult.orphanedIds
              .slice(0, 5)
              .join("\n")}`
          : ""),
    });

    if (!confirmed) return;

    setIsCleanupRunning(true);

    try {
      const activeIds = extractActiveIds();

      addLog("info", `Executing cleanup for ${selectedCleanupTag}...`);

      const baseUrl = getRoomBaseUrl(currentRoomId);
      const url = `${baseUrl}/admin/cleanup-orphans?token=${encodeURIComponent(
        adminToken
      )}`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tag: selectedCleanupTag,
          activeIds,
          dryRun: false,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      const result = await response.json();
      addLog(
        "info",
        `Cleanup completed: ${result.removed} entries removed`,
        result
      );
      alert(
        formatAdminResetSuccess({
          action: `Cleanup completed. Removed ${result.removed} orphaned entries.`,
          closedConnections: result.closedConnections,
          documentSize: result.documentSize,
        })
      );

      // Clear dry run result and reload room data
      setCleanupDryRunResult(null);
      await loadRoom(currentRoomId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Cleanup failed: ${msg}`, error);
      alert(`❌ Cleanup failed: ${msg}`);
    } finally {
      setIsCleanupRunning(false);
    }
  };

  const compareWithBackup = async (file: File) => {
    if (!currentRoomId) {
      addLog("error", "No room ID set");
      return;
    }

    try {
      addLog(
        "info",
        `Processing backup file: ${file.name} (${(
          file.size /
          1024 /
          1024
        ).toFixed(2)} MB)`
      );

      // Store the file for re-processing on reload
      setCurrentBackupFile(file);

      // Process the backup
      await processBackupFile(file, currentRoomId);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Failed to load backup file: ${msg}`, error);
      alert(`❌ Failed to load backup file: ${msg}`);
    }
  };

  const handleUploadBackup = async () => {
    try {
      // Use File System Access API to get a file handle
      const [handle] = await (window as any).showOpenFilePicker({
        types: [
          {
            description: "Database Backup Files",
            accept: {
              "application/octet-stream": [".backup"],
              "application/sql": [".sql"],
            },
          },
        ],
        multiple: false,
      });

      if (handle) {
        const file = await handle.getFile();

        // Save to OPFS for auto-loading on refresh
        try {
          await saveBackupToOPFS(file);
          addLog(
            "info",
            "Backup file saved to browser storage - will auto-load on page refresh"
          );
        } catch (saveError) {
          addLog(
            "warn",
            "Could not save backup for auto-load. File will still be processed this session."
          );
        }

        // Process the backup
        await compareWithBackup(file);
      }
    } catch (error) {
      if ((error as any).name !== "AbortError") {
        addLog(
          "error",
          `Failed to open file: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  };

  const processBackupFile = async (file: File, targetRoomId: string) => {
    try {
      setShowBackupComparison(true);
      addLog("info", "Searching for documents section in backup...");

      const encodedRoomId = ensureEncodedRoomId(targetRoomId);
      const backupRow = await findDocumentRowInBackup(
        file.stream(),
        encodedRoomId
      );

      if (!backupRow) {
        addLog(
          "warn",
          `Room ${decodeRoomId(encodedRoomId)} not found in backup file`
        );
        return;
      }

      addLog("info", `Found room data in backup`);

      const backupTimestamp = backupRow.timestamp;
      const base64Doc = backupRow.base64Doc;

      // Store the base64 for copy functionality
      setBackupBase64(base64Doc);

      addLog(
        "info",
        `Backup timestamp: ${new Date(backupTimestamp).toLocaleString()}`
      );
      addLog("info", `Decoding YJS data (${base64Doc.length} chars)...`);

      // Decode and extract YJS data
      const Y = await import("yjs");
      const backupDoc = new Y.Doc();
      const buffer = Uint8Array.from(atob(base64Doc), (c) => c.charCodeAt(0));
      Y.applyUpdate(backupDoc, buffer);

      // Safely extract backup data, ensuring it's always an object
      let backupData: Record<string, any> = {};
      try {
        const { syncedStore } = await import("@syncedstore/core");
        const backupStore = syncedStore<{ play: Record<string, any> }>(
          { play: {} },
          backupDoc
        );

        // Wait a tick to ensure syncedStore has initialized
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Try to extract from syncedStore
        if (
          backupStore &&
          typeof backupStore === "object" &&
          "play" in backupStore
        ) {
          const playData = backupStore.play;
          if (playData !== null && playData !== undefined) {
            try {
              const stringified = JSON.stringify(playData);
              if (
                stringified &&
                stringified !== "null" &&
                stringified !== "undefined"
              ) {
                const parsed = JSON.parse(stringified);
                // Handle both { value: {...} } and direct object formats
                if (parsed && typeof parsed === "object") {
                  backupData = parsed.value || parsed;
                }
              }
            } catch (stringifyError) {
              addLog(
                "warn",
                "Failed to stringify backup store data, trying direct access"
              );
              // Fallback: try to access directly if it's already a plain object
              if (typeof playData === "object" && !Array.isArray(playData)) {
                backupData = playData as Record<string, any>;
              }
            }
          }
        }

        // Fallback: if syncedStore didn't work, try reading directly from Y.Doc
        if (!backupData || Object.keys(backupData).length === 0) {
          const playMap = backupDoc.getMap("play");
          if (playMap && playMap.size > 0) {
            backupData = {};
            playMap.forEach((value, key) => {
              try {
                // Try to convert Y.Map to plain object
                const valueAny = value as any;
                if (valueAny && typeof valueAny.toJSON === "function") {
                  backupData[key] = valueAny.toJSON();
                } else if (valueAny instanceof Y.Map) {
                  const tagData: Record<string, any> = {};
                  valueAny.forEach((v: any, k: string) => {
                    tagData[k] =
                      v && typeof v.toJSON === "function" ? v.toJSON() : v;
                  });
                  backupData[key] = tagData;
                } else {
                  backupData[key] = value;
                }
              } catch (e) {
                addLog("warn", `Failed to extract tag ${key} from Y.Doc`);
              }
            });
          }
        }
      } catch (extractError) {
        const errorMsg =
          extractError instanceof Error
            ? extractError.message
            : String(extractError);
        addLog(
          "warn",
          `Failed to extract backup data: ${errorMsg}, using empty object`
        );
        backupData = {};
      }

      // Ensure backupData is always an object
      if (
        !backupData ||
        typeof backupData !== "object" ||
        Array.isArray(backupData)
      ) {
        backupData = {};
      }

      // Use already-loaded room data (current DB state)
      // Note: roomData is loaded from admin/inspect which returns both current DB and live data
      let currentData = null;
      let liveData = null;

      if (roomData && roomData.ydoc?.play) {
        // The inspect endpoint returns the current DB data
        currentData = {
          data: roomData.ydoc.play,
          timestamp: roomData.timestamp || new Date().toISOString(),
        };
        // For now, treat current and live as the same since inspect returns DB data
        liveData = roomData.ydoc.play;
      } else {
        addLog("warn", "No room data loaded, cannot compare with backup");
      }

      const comparison = {
        roomId: targetRoomId,
        backup: {
          data: backupData || {},
          timestamp: backupTimestamp,
          hasData: backupData && Object.keys(backupData).length > 0,
        },
        current: currentData
          ? {
              data: currentData.data,
              timestamp: currentData.timestamp,
              hasData: Object.keys(currentData.data).length > 0,
            }
          : null,
        live: liveData
          ? {
              data: liveData,
              hasData: Object.keys(liveData).length > 0,
            }
          : null,
      };

      setBackupComparisonData(comparison);
      addLog("info", "Backup comparison complete", comparison);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Backup comparison failed: ${msg}`, error);
      alert(`❌ Backup comparison failed: ${msg}`);
    }
  };

  const removeSubscriberById = async (consumerRoomId: string) => {
    if (!currentRoomId || !adminToken) return;

    try {
      const baseUrl = getRoomBaseUrl(currentRoomId);
      const url = `${baseUrl}/admin/remove-subscriber?token=${encodeURIComponent(
        adminToken
      )}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consumerRoomId }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `HTTP ${res.status}`);
      }
      const out = await res.json();
      addLog("info", `Removed subscriber: ${consumerRoomId}`, out);
      setRoomStatus({
        message: `Removed subscriber: ${decodeRoomId(consumerRoomId)}`,
        type: "success",
      });
      await loadRoom(currentRoomId);
    } catch (error: any) {
      setRoomStatus({
        message: `Failed removing subscriber: ${error.message}`,
        type: "error",
      });
      addLog("error", "Failed removing subscriber", error);
    }
  };

  // Format functions for shared data
  const formatSharedDataList = (
    items: any[],
    type: "subscriber" | "reference"
  ): React.ReactNode[] => {
    return items.map((item, index) => {
      if (type === "subscriber") {
        const encodedRoomId = item.consumerRoomId || "";
        const roomId = decodeRoomId(encodedRoomId);
        const elements = item.elementIds?.join(", ") || "none";

        return (
          <div key={index} className="shared-item">
            <div className="shared-item-header">
              <span className="badge subscriber-badge">CONSUMER</span>
              <a
                className="room-link"
                href={`admin-react.html?room=${encodedRoomId}`}
              >
                <strong>{roomId}</strong>
              </a>
              <button
                className="remove-subscriber-btn"
                title="Remove"
                onClick={() => {
                  const decoded = decodeRoomId(encodedRoomId);
                  const ok = confirm(`Remove subscriber for room: ${decoded}?`);
                  if (ok) removeSubscriberById(encodedRoomId);
                }}
              >
                ×
              </button>
            </div>
            <div className="shared-item-detail">Elements: {elements}</div>
          </div>
        );
      } else {
        const encodedSourceId = item.sourceRoomId || "";
        const roomId = decodeRoomId(encodedSourceId);
        const elements = item.elementIds?.join(", ") || "none";

        return (
          <div key={index} className="shared-item">
            <div className="shared-item-header">
              <span className="badge reference-badge">SOURCE</span>
              <a
                className="room-link"
                href={`admin-react.html?room=${encodedSourceId}`}
              >
                <strong>{roomId}</strong>
              </a>
            </div>
            <div className="shared-item-detail">Elements: {elements}</div>
          </div>
        );
      }
    });
  };

  const formatPermissionsList = (
    permissions: Record<string, string>
  ): React.ReactNode[] => {
    return Object.entries(permissions).map(([elementId, permission]) => (
      <div key={elementId} className="shared-item">
        <div className="shared-item-header">
          <span
            className={`badge ${
              permission === "read-only" ? "readonly-badge" : "readwrite-badge"
            }`}
          >
            {permission.toUpperCase()}
          </span>
          <strong>{elementId}</strong>
        </div>
      </div>
    ));
  };

  const comparisonSummary = React.useMemo(
    () => createComparisonSummary(comparisonData),
    [comparisonData]
  );
  const comparisonInlineDiff = React.useMemo(
    () => createInlineDiffLookup(comparisonSummary.differences),
    [comparisonSummary.differences]
  );

  if (!adminToken) {
    return (
      <LoginScreen
        onLogin={(token) => {
          const trimmed = token.trim();
          setAdminToken(trimmed);
          localStorage.setItem("playhtml-admin-token", trimmed);
          addLog("info", "Logged in");
        }}
        currentEnv={hostEnv}
      />
    );
  }

  return (
    <div className="admin-container">
      <header className="admin-header">
        <h1>🛠️ PlayHTML Admin Console</h1>
        <div>
          <EnvironmentDisplay currentEnv={hostEnv} />
          <div className="auth-controls">
            <button
              className={`auth-btn authenticated`}
              onClick={() => {
                setAdminToken(null);
                localStorage.removeItem("playhtml-admin-token");
                addLog("info", "Logged out");
              }}
            >
              🔓 Logout
            </button>
            <span className={`auth-status authenticated`}>Authenticated</span>
          </div>
        </div>
      </header>

      <div className="admin-content">
        <section className="room-inspector">
          <h2>Room Inspector</h2>
          <div className="input-group">
            <label htmlFor="urlInput">URL:</label>
            <input
              type="text"
              id="urlInput"
              placeholder="Enter URL to derive room ID..."
              value={urlInput}
              onChange={(e) => handleUrlChange(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && urlInput && loadRoom()}
            />
          </div>
          <div className="input-group">
            <label htmlFor="roomId">Room ID:</label>
            <input
              type="text"
              id="roomId"
              placeholder="Enter room ID to inspect..."
              value={decodeRoomId(currentRoomId)}
              onChange={(e) => setCurrentRoomId(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && loadRoom()}
            />
            <button onClick={() => loadRoom()}>Load Room</button>
          </div>

          {roomStatus && (
            <div className={`status-display ${roomStatus.type}`}>
              {roomStatus.message}
            </div>
          )}

          {roomData && (
            <>
              <div className="data-section">
                <SectionHeader
                  title="Y.Doc Data"
                  sectionKey="ydocData"
                  isExpanded={sectionsExpanded.ydocData}
                  onToggle={toggleSection}
                />
                {sectionsExpanded.ydocData && roomData.ydoc?.play && (
                  <div>
                    <div className="ydoc-debug-info">
                      <div className="debug-stats">
                        <span className="stat-item">
                          📊 {Object.keys(roomData.ydoc.play).length} capability
                          types
                        </span>
                        <span className="stat-item">
                          🎯{" "}
                          {Object.values(roomData.ydoc.play).reduce(
                            (sum: number, tagData: any) =>
                              sum + Object.keys(tagData).length,
                            0
                          )}{" "}
                          total elements
                        </span>
                      </div>
                    </div>
                    <JSONViewer data={roomData.ydoc.play} />
                  </div>
                )}
              </div>

              <div className="data-section">
                <SectionHeader
                  title="Room Metadata"
                  sectionKey="roomMetadata"
                  isExpanded={sectionsExpanded.roomMetadata}
                  onToggle={toggleSection}
                />
                {sectionsExpanded.roomMetadata && (
                  <div className="metadata-list">
                    <div className="metadata-item">
                      <strong>Room ID (Encoded):</strong>{" "}
                      <code>{roomData.roomId || currentRoomId}</code>
                    </div>
                    <div className="metadata-item">
                      <strong>Room ID (Readable):</strong>{" "}
                      <code>
                        {decodeRoomId(roomData.roomId || currentRoomId)}
                      </code>
                    </div>
                    <div className="metadata-item">
                      <strong>Active Connections:</strong>{" "}
                      <span className="connection-count">
                        {roomData.connections || 0}
                      </span>
                    </div>
                    <div className="metadata-item">
                      <strong>Created At:</strong>{" "}
                      <time>
                        {roomData.timestamp
                          ? new Date(roomData.timestamp).toLocaleString()
                          : "Unknown"}
                      </time>
                    </div>
                    <div className="metadata-item">
                      <strong>Document Size:</strong>{" "}
                      {roomData.documentSize !== undefined ? (
                        (() => {
                          const sizeMB = roomData.documentSize / 1024 / 1024;
                          const isDangerous =
                            roomData.documentSize > 5 * 1024 * 1024;
                          const isWarning =
                            roomData.documentSize > 3 * 1024 * 1024;
                          const isCaution =
                            roomData.documentSize > 1 * 1024 * 1024;

                          let color = "inherit";
                          let fontWeight = "normal";
                          let warningIcon = "";
                          let tooltip = "";

                          if (isDangerous) {
                            color = "#e53e3e"; // Red
                            fontWeight = "bold";
                            warningIcon = "⚠️";
                            tooltip =
                              "⚠️ Document size is dangerously large. Consider running Hard Reset (GC) to clean up history/tombstones.";
                          } else if (isWarning) {
                            color = "#d69e2e"; // Orange
                            fontWeight = "500";
                            warningIcon = "⚡";
                            tooltip =
                              "⚡ Document size is getting large. Consider running Hard Reset (GC) soon to prevent performance issues.";
                          } else if (isCaution) {
                            color = "#c05621"; // Lighter amber/yellow
                            fontWeight = "normal";
                            warningIcon = "💡";
                            tooltip =
                              "💡 Document size is moderate. Monitor and consider Hard Reset (GC) if it continues to grow.";
                          }

                          return (
                            <span
                              style={{
                                color,
                                fontWeight,
                              }}
                              title={tooltip || undefined}
                            >
                              {sizeMB.toFixed(2)} MB
                              {warningIcon && (
                                <span style={{ marginLeft: "8px" }}>
                                  {warningIcon}
                                </span>
                              )}
                            </span>
                          );
                        })()
                      ) : (
                        <span style={{ color: "#999" }}>Unknown</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="data-section">
                <SectionHeader
                  title="Shared Data"
                  sectionKey="sharedData"
                  isExpanded={sectionsExpanded.sharedData}
                  onToggle={toggleSection}
                />
                {sectionsExpanded.sharedData && (
                  <div className="shared-data-grid">
                    <div className="shared-section">
                      <h4>Subscribers</h4>
                      <div className="data-viewer">
                        {roomData.subscribers?.length ? (
                          formatSharedDataList(
                            roomData.subscribers,
                            "subscriber"
                          )
                        ) : (
                          <div className="empty">No subscribers</div>
                        )}
                      </div>
                    </div>
                    <div className="shared-section">
                      <h4>Shared References</h4>
                      <div className="data-viewer">
                        {roomData.sharedReferences?.length ? (
                          formatSharedDataList(
                            roomData.sharedReferences,
                            "reference"
                          )
                        ) : (
                          <div className="empty">No shared references</div>
                        )}
                      </div>
                    </div>
                    <div className="shared-section">
                      <h4>Permissions</h4>
                      <div className="data-viewer">
                        {roomData.sharedPermissions &&
                        Object.keys(roomData.sharedPermissions).length ? (
                          formatPermissionsList(roomData.sharedPermissions)
                        ) : (
                          <div className="empty">No permissions set</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {roomData && (
            <div className="data-section">
              <SectionHeader
                title="Raw Database Data"
                sectionKey="rawDbData"
                isExpanded={sectionsExpanded.rawDbData}
                onToggle={toggleSection}
                actions={
                  <button
                    className="tool-btn"
                    disabled={!debugToolsEnabled}
                    onClick={loadRawDatabaseData}
                  >
                    Load Raw DB Data
                  </button>
                }
              />
              {sectionsExpanded.rawDbData && (
                rawDbData ? (
                  <>
                    <div className="debug-info">
                      <div className="debug-item">
                        <strong>Document Size:</strong>
                        <span>
                          {rawDbData.document
                            ? `${
                                Math.round(
                                  (rawDbData.document.base64Length / 1024) *
                                    100
                                ) / 100
                              } KB`
                            : "No data"}
                        </span>
                      </div>
                      <div className="debug-item">
                        <strong>Base64 Length:</strong>
                        <span>
                          {rawDbData.document
                            ? rawDbData.document.base64Length.toLocaleString()
                            : "0"}
                        </span>
                      </div>
                      <div className="debug-item">
                        <strong>Last Updated:</strong>
                        <span>
                          {rawDbData.document
                            ? new Date(
                                rawDbData.document.created_at
                              ).toLocaleString()
                            : "Never"}
                        </span>
                      </div>
                    </div>
                    <JSONViewer data={rawDbData} />
                  </>
                ) : (
                  <div className="empty">
                    Load raw database data to inspect the stored base64
                    snapshot.
                  </div>
                )
              )}
            </div>
          )}

          {roomData && (
            <div className="data-section">
              <SectionHeader
                title="Live vs Admin Data Comparison"
                sectionKey="dataComparison"
                isExpanded={sectionsExpanded.dataComparison}
                onToggle={toggleSection}
                actions={
                  <div className="section-actions">
                    <span
                      className={`comparison-status ${
                        comparisonError
                          ? "error"
                          : comparisonLoading
                            ? "checking"
                            : comparisonSummary.status
                      }`}
                    >
                      {comparisonError
                        ? "Comparison failed"
                        : comparisonLoading
                          ? "Checking..."
                          : comparisonSummary.statusLabel}
                    </span>
                    <button
                      className="tool-btn"
                      disabled={!debugToolsEnabled || comparisonLoading}
                      onClick={() => compareDataMethods({ forceShow: true })}
                    >
                      {comparisonLoading ? "Checking..." : "Compare Now"}
                    </button>
                  </div>
                }
              />
              {sectionsExpanded.dataComparison && (
                comparisonError ? (
                  <div className="status-display error">{comparisonError}</div>
                ) : comparisonData ? (
                  <>
                    <div className="debug-info">
                      <div className="debug-item">
                        <strong>Direct Method Keys:</strong>
                        <span>{comparisonSummary.directElementCount}</span>
                      </div>
                      <div className="debug-item">
                        <strong>Live Method Keys:</strong>
                        <span>{comparisonSummary.liveElementCount}</span>
                      </div>
                      <div className="debug-item">
                        <strong>Data Match:</strong>
                        <span
                          style={{
                            color: comparisonSummary.dataMatch
                              ? "#38a169"
                              : "#e53e3e",
                          }}
                        >
                          {comparisonSummary.dataMatch ? "Yes" : "No"}
                        </span>
                      </div>
                    </div>
                    <div
                      className="tool-grid"
                      style={{ marginBottom: "10px" }}
                    >
                      <button
                        className="tool-btn destructive"
                        disabled={!debugToolsEnabled}
                        onClick={handleForceReloadLive}
                      >
                        Force DB → Live
                      </button>
                      <button
                        className="tool-btn"
                        disabled={!debugToolsEnabled}
                        onClick={handleForceSaveLive}
                      >
                        Force Save DB ← Live
                      </button>
                    </div>
                    <div className="comparison-data-grid">
                      <div className="shared-section">
                        <h4>Direct Method Data (Admin Console)</h4>
                        <JSONViewer
                          data={comparisonData.methods?.direct?.data || {}}
                          inlineDiff={comparisonInlineDiff.admin}
                        />
                      </div>
                      <div className="shared-section">
                        <h4>Live Method Data (unstable_getYDoc)</h4>
                        {comparisonData.methods?.live?.data?.error ? (
                          <div className="empty">
                            Error: {comparisonData.methods.live.data.error}
                          </div>
                        ) : (
                          <JSONViewer
                            data={comparisonData.methods?.live?.data || {}}
                            inlineDiff={comparisonInlineDiff.live}
                          />
                        )}
                      </div>
                    </div>
                  </>
                ) : comparisonLoading ? (
                  <div className="status-display loading">
                    Comparing live and admin data...
                  </div>
                ) : (
                  <div className="empty">
                    The comparison runs automatically after room load. Use
                    Compare Now to run it again.
                  </div>
                )
              )}
            </div>
          )}

          {roomData && (
            <div className="data-section">
              <SectionHeader
                title="Backup Comparison & Data Editor"
                sectionKey="backupComparison"
                isExpanded={sectionsExpanded.backupComparison}
                onToggle={toggleSection}
                actions={
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      fontSize: "0.9em",
                    }}
                  >
                    {currentBackupFile ? (
                      <>
                        <span style={{ color: "#666" }}>
                          📁 {currentBackupFile.name}
                        </span>
                        {savedBackupPath && (
                          <span style={{ fontSize: "0.85em", color: "#999" }}>
                            (auto-saved)
                          </span>
                        )}
                        <button
                          className="tool-btn"
                          style={{
                            padding: "4px 8px",
                            fontSize: "0.85em",
                          }}
                          onClick={async () => {
                            setCurrentBackupFile(null);
                            setBackupComparisonData((prev: any) => {
                              if (prev) {
                                return { ...prev, backup: null };
                              }
                              return prev;
                            });
                            setEditableJson("");
                            setBackupBase64(null);
                            // Clear saved backup path to prevent auto-reload
                            setSavedBackupPath(null);
                            // Also clear from OPFS
                            await clearBackupFromOPFS();
                            addLog("info", "Backup cleared");
                          }}
                        >
                          Clear Backup
                        </button>
                        {savedBackupPath && (
                          <button
                            className="tool-btn"
                            style={{
                              padding: "4px 8px",
                              fontSize: "0.85em",
                            }}
                            onClick={async () => {
                              if (
                                confirm(
                                  `Remove saved backup "${savedBackupPath}" from browser storage?`
                                )
                              ) {
                                await clearBackupFromOPFS();
                                alert("✅ Auto-saved backup cleared");
                              }
                            }}
                            title="Remove backup file from browser storage (OPFS)"
                          >
                            🗑️ Clear Auto-Save
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        className="tool-btn"
                        style={{
                          padding: "4px 8px",
                          fontSize: "0.85em",
                        }}
                        onClick={handleUploadBackup}
                        disabled={!debugToolsEnabled}
                      >
                        📤 Upload Backup
                      </button>
                    )}
                  </div>
                }
              />
              {sectionsExpanded.backupComparison && (
                <>
                  <div className="debug-info">
                    <div className="debug-item">
                      <strong>Backup Timestamp:</strong>
                      <span>
                        {backupComparisonData?.backup?.timestamp
                          ? new Date(
                              backupComparisonData.backup.timestamp
                            ).toLocaleString()
                          : "No backup loaded"}
                      </span>
                    </div>
                    <div className="debug-item">
                      <strong>Backup Elements:</strong>
                      <span>
                        {backupComparisonData?.backup
                          ? Object.values(
                              backupComparisonData.backup.data || {}
                            ).reduce(
                              (sum: number, tagData: any) =>
                                sum + Object.keys(tagData || {}).length,
                              0
                            )
                          : "N/A"}
                      </span>
                    </div>
                    <div className="debug-item">
                      <strong>Current DB Elements:</strong>
                      <span>
                        {backupComparisonData?.current || roomData?.ydoc?.play
                          ? Object.values(
                              backupComparisonData?.current?.data ||
                                roomData?.ydoc?.play ||
                                {}
                            ).reduce(
                              (sum: number, tagData: any) =>
                                sum + Object.keys(tagData || {}).length,
                              0
                            )
                          : "N/A"}
                      </span>
                    </div>
                    <div className="debug-item">
                      <strong>Live Elements:</strong>
                      <span>
                        {backupComparisonData?.live || roomData?.ydoc?.play
                          ? Object.values(
                              backupComparisonData?.live?.data ||
                                roomData?.ydoc?.play ||
                                {}
                            ).reduce(
                              (sum: number, tagData: any) =>
                                sum + Object.keys(tagData || {}).length,
                              0
                            )
                          : "N/A"}
                      </span>
                    </div>
                  </div>
                  <div
                    className="shared-data-grid"
                    style={{ gridTemplateColumns: "repeat(3, 1fr)" }}
                  >
                    <div className="shared-section">
                      <h4>
                        Backup Data
                        {backupComparisonData?.backup?.timestamp && (
                          <>
                            {" "}
                            (
                            {new Date(
                              backupComparisonData.backup.timestamp
                            ).toLocaleDateString()}
                            )
                          </>
                        )}
                      </h4>
                      {backupComparisonData?.backup ? (
                        <JSONViewer
                          data={backupComparisonData.backup.data || {}}
                        />
                      ) : (
                        <div className="empty">No backup file loaded</div>
                      )}
                    </div>
                    <div className="shared-section">
                      <h4>Current DB Data</h4>
                      {backupComparisonData?.current || roomData?.ydoc?.play ? (
                        <>
                          {backupComparisonData?.current?.timestamp && (
                            <div
                              style={{
                                fontSize: "0.85em",
                                color: "#666",
                                marginBottom: "8px",
                              }}
                            >
                              Last updated:{" "}
                              {new Date(
                                backupComparisonData.current.timestamp
                              ).toLocaleString()}
                            </div>
                          )}
                          <JSONViewer
                            data={
                              backupComparisonData?.current?.data ||
                              roomData?.ydoc?.play ||
                              {}
                            }
                          />
                        </>
                      ) : (
                        <div className="empty">No current DB data</div>
                      )}
                    </div>
                    <div className="shared-section">
                      <h4>Live Data</h4>
                      {backupComparisonData?.live || roomData?.ydoc?.play ? (
                        <JSONViewer
                          data={
                            backupComparisonData?.live?.data ||
                            roomData?.ydoc?.play ||
                            {}
                          }
                        />
                      ) : (
                        <div className="empty">No live data</div>
                      )}
                    </div>
                  </div>
                  <div style={{ marginTop: "20px" }}>
                    <h4>Manual Reconciliation</h4>
                    <p
                      style={{
                        fontSize: "0.9em",
                        color: "#666",
                        marginBottom: "10px",
                      }}
                    >
                      Edit the JSON below to manually reconcile data, then save
                      to database.
                    </p>
                    <div style={{ marginBottom: "10px" }}>
                      <button
                        className="tool-btn"
                        onClick={() => {
                          const json = JSON.stringify(
                            backupComparisonData.backup?.data || {},
                            null,
                            2
                          );
                          setEditableJson(json);
                          setJsonError("");
                        }}
                        style={{ marginRight: "10px" }}
                      >
                        Load Backup Data
                      </button>
                      <button
                        className="tool-btn"
                        onClick={() => {
                          const data =
                            backupComparisonData?.current?.data ||
                            roomData?.ydoc?.play ||
                            {};
                          const json = JSON.stringify(data, null, 2);
                          setEditableJson(json);
                          setJsonError("");
                        }}
                        style={{ marginRight: "10px" }}
                        disabled={
                          !backupComparisonData?.current &&
                          !roomData?.ydoc?.play
                        }
                      >
                        Load Current DB Data
                      </button>
                      <button
                        className="tool-btn"
                        onClick={() => {
                          const data =
                            backupComparisonData?.live?.data ||
                            roomData?.ydoc?.play ||
                            {};
                          const json = JSON.stringify(data, null, 2);
                          setEditableJson(json);
                          setJsonError("");
                        }}
                        disabled={
                          !backupComparisonData?.live && !roomData?.ydoc?.play
                        }
                      >
                        Load Live Data
                      </button>
                    </div>
                    <div style={{ marginBottom: "10px" }}>
                      <button
                        className="tool-btn"
                        onClick={() => {
                          const result = validateAndFormatJson(editableJson);
                          if (result.valid && result.formatted) {
                            setEditableJson(result.formatted);
                            setJsonError("");
                            alert("✅ JSON is valid and has been formatted");
                          } else {
                            setJsonError(result.error || "Invalid JSON");
                            alert(`❌ Invalid JSON: ${result.error}`);
                          }
                        }}
                        disabled={!editableJson.trim()}
                      >
                        ✓ Validate & Format JSON
                      </button>
                    </div>
                    {jsonError && (
                      <div
                        style={{
                          padding: "10px",
                          background: "#fee",
                          border: "1px solid #fcc",
                          borderRadius: "4px",
                          marginBottom: "10px",
                          color: "#c00",
                          fontSize: "0.9em",
                        }}
                      >
                        <strong>JSON Error:</strong> {jsonError}
                      </div>
                    )}
                    <textarea
                      value={editableJson}
                      onChange={(e) => {
                        setEditableJson(e.target.value);
                        setJsonError("");
                      }}
                      style={{
                        width: "100%",
                        minHeight: "300px",
                        fontFamily: "monospace",
                        fontSize: "12px",
                        padding: "10px",
                        border: jsonError ? "1px solid #fcc" : "1px solid #ccc",
                        borderRadius: "4px",
                        marginBottom: "10px",
                        backgroundColor: jsonError ? "#fff5f5" : "white",
                      }}
                      placeholder="Load data from one of the buttons above, or paste JSON here..."
                    />
                    <button
                      className="tool-btn"
                      onClick={() => {
                        if (!editableJson.trim()) {
                          alert("Please enter JSON data first");
                          return;
                        }
                        // Validate before saving
                        const result = validateAndFormatJson(editableJson);
                        if (!result.valid) {
                          setJsonError(result.error || "Invalid JSON");
                          alert(`❌ Cannot save invalid JSON: ${result.error}`);
                          return;
                        }
                        setJsonError("");
                        const ok = confirmAdminReset({
                          action: "Save edited database data",
                          detail:
                            "This will make the edited JSON authoritative and overwrite the current database state.",
                        });
                        if (ok) saveEditedDataToDb(editableJson);
                      }}
                      disabled={!editableJson.trim()}
                    >
                      💾 Save Edited Data to Database
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <nav className="tool-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={activeToolTab === "moderate"}
            className={activeToolTab === "moderate" ? "tool-tab active" : "tool-tab"}
            onClick={() => setActiveToolTab("moderate")}
          >
            Moderate{moderationRecords.length > 0 ? ` (${moderationRecords.length})` : ""}
          </button>
          <button
            role="tab"
            aria-selected={activeToolTab === "tools"}
            className={activeToolTab === "tools" ? "tool-tab active" : "tool-tab"}
            onClick={() => setActiveToolTab("tools")}
          >
            Tools
          </button>
        </nav>

        {activeToolTab === "moderate" &&
          (moderationRecords.length > 0 ? (
            <section className="moderation">
              <h2>Moderate ({moderationRecords.length} records)</h2>
              <div className="moderation-controls">
                <button
                  onClick={async () => {
                    await copyRecordsForModel();
                    setModCopied(true);
                    window.setTimeout(() => setModCopied(false), 2000);
                  }}
                >
                  Copy for model
                </button>
                {modCopied && (
                  <span className="moderation-copied">
                    Copied {moderationRecords.length} ✓
                  </span>
                )}
              </div>
              <textarea
                className="moderation-paste"
                value={modPaste}
                onChange={(e) => setModPaste(e.target.value)}
                placeholder="Paste the model's answer (keys to remove) here..."
                rows={3}
              />
              <div className="moderation-controls">
                <button onClick={applyPastedKeys}>Flag pasted keys</button>
              </div>
              {modResult && (
                <div className="moderation-result">
                  Removed {modResult.removed}; skipped {modResult.skipped.length}
                  {modResult.skipped.map((s) => (
                    <div key={s.key} className="moderation-skipped">
                      {s.key}: {s.reason}
                    </div>
                  ))}
                </div>
              )}
              <div className="moderation-listcontrols">
                <div className="moderation-filter" role="group">
                  {(["flagged", "all", "unflagged"] as const).map((f) => {
                    const count =
                      f === "flagged"
                        ? modSelected.size
                        : f === "unflagged"
                        ? moderationRecords.length - modSelected.size
                        : moderationRecords.length;
                    const label = f.charAt(0).toUpperCase() + f.slice(1);
                    return (
                      <button
                        key={f}
                        className={modFilter === f ? "filter-btn active" : "filter-btn"}
                        onClick={() => setModFilter(f)}
                      >
                        {label} ({count})
                      </button>
                    );
                  })}
                </div>
                <div className="moderation-bulk">
                  <button
                    onClick={() => {
                      const next = new Set(modSelected);
                      visibleModerationRecords.forEach((r) => next.add(r.key));
                      setModSelected(next);
                    }}
                  >
                    Select all (filtered)
                  </button>
                  <button onClick={() => setModSelected(new Set())}>
                    Clear selection
                  </button>
                </div>
              </div>
              <ul className="moderation-records">
                {visibleModerationRecords.map((r) => (
                  <li key={r.key} className={modSelected.has(r.key) ? "flagged" : ""}>
                    <label>
                      <input
                        type="checkbox"
                        checked={modSelected.has(r.key)}
                        onChange={(e) => {
                          const next = new Set(modSelected);
                          if (e.target.checked) next.add(r.key);
                          else next.delete(r.key);
                          setModSelected(next);
                        }}
                      />
                      <span className="mod-text">{r.text || "(no text)"}</span>
                    </label>
                    {r.reportCount != null && (
                      <span className="mod-badge mod-report">
                        reports: {r.reportCount}
                      </span>
                    )}
                    {Object.entries(r.metadata).map(([k, v]) => (
                      <span key={k} className="mod-badge">
                        {k}: {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </span>
                    ))}
                    <code className="mod-key">{r.key}</code>
                    <button
                      onClick={() => {
                        const next = new Set(modExpanded);
                        if (next.has(r.key)) next.delete(r.key);
                        else next.add(r.key);
                        setModExpanded(next);
                      }}
                    >
                      {modExpanded.has(r.key) ? "Hide" : "Raw"}
                    </button>
                    {modExpanded.has(r.key) && (
                      <pre className="mod-raw">
                        {JSON.stringify(r.fields, null, 2)}
                      </pre>
                    )}
                  </li>
                ))}
              </ul>
              <div className="moderation-actions">
                <button
                  className="tool-btn destructive"
                  onClick={removeSelectedRecords}
                  disabled={modSelected.size === 0}
                >
                  Remove {modSelected.size} selected
                </button>
              </div>
            </section>
          ) : (
            <section className="moderation moderation-empty">
              <p>
                Load a room with text content to moderate. No moderatable
                records found in the current room.
              </p>
            </section>
          ))}

        {activeToolTab === "tools" && (
          <>
        <section className="debug-tools">
          <h2>Debug Tools</h2>
          <div className="tool-grid">
            <button
              className="tool-btn"
              disabled={!debugToolsEnabled}
              onClick={exportRoomData}
            >
              Export Room Data
            </button>
            <button
              className="tool-btn"
              disabled={!debugToolsEnabled}
              onClick={exportRawDocument}
              title="Export the raw base64-encoded YJS document (includes all history/tombstones)"
            >
              Export Raw Document
            </button>
            <button
              className="tool-btn destructive"
              disabled={!debugToolsEnabled}
              onClick={restoreRawDocument}
              title="Restore from a raw base64-encoded YJS document file"
            >
              Restore Raw Document
            </button>
            <button
              className="tool-btn destructive"
              disabled={!debugToolsEnabled}
              onClick={handleHardReset}
              title="Recreate Y.Doc from scratch to remove all history/tombstones (Garbage Collection)"
            >
              🔄 Hard Reset (GC)
            </button>
          </div>
        </section>

        {roomData && (
          <section className="cleanup-tools">
            <div className="data-section">
              <SectionHeader
                title="🧹 Cleanup Orphaned Data"
                sectionKey="cleanupTools"
                isExpanded={sectionsExpanded.cleanupTools}
                onToggle={toggleSection}
              />
              {sectionsExpanded.cleanupTools && (
                <>
                  <p style={{ color: "#666", marginBottom: "16px" }}>
                    Remove orphaned element data that accumulates when elements
                    are deleted. This is especially useful for tags like{" "}
                    <code>can-move</code> that store per-element state.
                  </p>

                  <div style={{ marginBottom: "20px" }}>
                    <div style={{ marginBottom: "12px" }}>
                      <label
                        htmlFor="cleanup-tag"
                        style={{ display: "block", marginBottom: "4px" }}
                      >
                        Tag to Clean Up:
                      </label>
                      <select
                        id="cleanup-tag"
                        value={selectedCleanupTag}
                        onChange={(e) => {
                          setSelectedCleanupTag(e.target.value);
                          setCleanupDryRunResult(null);
                        }}
                        style={{
                          padding: "6px 12px",
                          fontSize: "14px",
                          borderRadius: "4px",
                          border: "1px solid #ccc",
                          width: "200px",
                        }}
                      >
                        <option value="can-move">can-move</option>
                        <option value="can-play">can-play</option>
                        <option value="can-toggle">can-toggle</option>
                        <option value="can-spin">can-spin</option>
                        <option value="can-grow">can-grow</option>
                        <option value="can-duplicate">can-duplicate</option>
                      </select>
                    </div>

                    <div style={{ marginBottom: "12px" }}>
                      <label
                        htmlFor="cleanup-source"
                        style={{ display: "block", marginBottom: "4px" }}
                      >
                        Source Element ID (for extracting active IDs):
                      </label>
                      <input
                        id="cleanup-source"
                        type="text"
                        value={cleanupSourceElementId}
                        onChange={(e) => {
                          setCleanupSourceElementId(e.target.value);
                          setCleanupDryRunResult(null);
                        }}
                        placeholder="e.g., newWords"
                        style={{
                          padding: "6px 12px",
                          fontSize: "14px",
                          borderRadius: "4px",
                          border: "1px solid #ccc",
                          width: "200px",
                        }}
                      />
                      <span
                        style={{
                          marginLeft: "8px",
                          color: "#666",
                          fontSize: "12px",
                        }}
                      >
                        (should be an element in can-play tag that contains an
                        array with id fields)
                      </span>
                    </div>

                    <div style={{ marginBottom: "16px" }}>
                      <button
                        className="tool-btn"
                        onClick={performCleanupDryRun}
                        disabled={!roomData || isCleanupRunning}
                        style={{ marginRight: "8px" }}
                      >
                        {isCleanupRunning ? "Running..." : "🔍 Dry Run"}
                      </button>
                      {cleanupDryRunResult && (
                        <button
                          className="tool-btn destructive"
                          onClick={executeCleanup}
                          disabled={
                            isCleanupRunning ||
                            cleanupDryRunResult.orphaned === 0
                          }
                        >
                          {isCleanupRunning
                            ? "Cleaning..."
                            : `🗑️ Remove ${cleanupDryRunResult.orphaned} Orphaned`}
                        </button>
                      )}
                    </div>
                  </div>

                  {cleanupDryRunResult && (
                    <div
                      style={{
                        padding: "16px",
                        background:
                          cleanupDryRunResult.orphaned === 0
                            ? "#F0F9FF"
                            : "#FEF3C7",
                        border: `1px solid ${
                          cleanupDryRunResult.orphaned === 0
                            ? "#BAE6FD"
                            : "#FDE68A"
                        }`,
                        borderRadius: "8px",
                        marginTop: "16px",
                      }}
                    >
                      <h3 style={{ marginTop: 0 }}>Dry Run Results</h3>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(3, 1fr)",
                          gap: "12px",
                          marginBottom: "12px",
                        }}
                      >
                        <div>
                          <strong>Total Entries:</strong>{" "}
                          {cleanupDryRunResult.total}
                        </div>
                        <div>
                          <strong>Active Entries:</strong>{" "}
                          {cleanupDryRunResult.active}
                        </div>
                        <div>
                          <strong>Orphaned Entries:</strong>{" "}
                          <span
                            style={{
                              color:
                                cleanupDryRunResult.orphaned > 0
                                  ? "#D97706"
                                  : "#059669",
                            }}
                          >
                            {cleanupDryRunResult.orphaned}
                          </span>
                        </div>
                      </div>
                      {cleanupDryRunResult.message && (
                        <div style={{ marginBottom: "12px", color: "#666" }}>
                          {cleanupDryRunResult.message}
                        </div>
                      )}
                      {cleanupDryRunResult.orphanedIds &&
                        cleanupDryRunResult.orphanedIds.length > 0 && (
                          <details style={{ marginTop: "12px" }}>
                            <summary
                              style={{
                                cursor: "pointer",
                                fontWeight: "bold",
                              }}
                            >
                              View Orphaned IDs (
                              {cleanupDryRunResult.orphanedIds.length})
                            </summary>
                            <div
                              style={{
                                marginTop: "8px",
                                maxHeight: "200px",
                                overflowY: "auto",
                                background: "white",
                                padding: "8px",
                                borderRadius: "4px",
                                fontFamily: "monospace",
                                fontSize: "12px",
                              }}
                            >
                              {cleanupDryRunResult.orphanedIds
                                .slice(0, 100)
                                .map((id: string, idx: number) => (
                                  <div key={idx}>{id}</div>
                                ))}
                              {cleanupDryRunResult.orphanedIds.length > 100 && (
                                <div
                                  style={{ color: "#666", marginTop: "8px" }}
                                >
                                  ... and{" "}
                                  {cleanupDryRunResult.orphanedIds.length - 100}{" "}
                                  more
                                </div>
                              )}
                            </div>
                          </details>
                        )}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}
          </>
        )}

        <DebugLogs logs={logs} onClearLogs={() => setLogs([])} />
      </div>
    </div>
  );
};

// Render the app
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<AdminConsole />);
}
