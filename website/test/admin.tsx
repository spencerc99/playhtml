import React, { useState, useEffect, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";

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
}

interface DebugLog {
  timestamp: Date;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: any;
}

type EnvName = "production" | "staging" | "development";

const HOSTS: Record<EnvName, string> = {
  production: "https://playhtml.spencerc99.partykit.dev",
  staging: "https://staging.playhtml.spencerc99.partykit.dev",
  development: "http://localhost:1999",
};

// Environment Selector Component
const EnvironmentSelector: React.FC<{
  currentEnv: EnvName;
  onEnvChange: (env: EnvName) => void;
}> = ({ currentEnv, onEnvChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const envColors: Record<
    EnvName,
    { bg: string; color: string; border: string }
  > = {
    production: { bg: "#FED7D7", color: "#9B2C2C", border: "#FEB2B2" },
    staging: { bg: "#FEFCBF", color: "#744210", border: "#F6E05E" },
    development: { bg: "#BEE3F8", color: "#2C5282", border: "#90CDF4" },
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const currentColors = envColors[currentEnv];

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      <button
        style={{
          padding: "6px 12px",
          borderRadius: "16px",
          fontWeight: "700",
          border: `1px solid ${currentColors.border}`,
          cursor: "pointer",
          fontSize: "0.9rem",
          background: currentColors.bg,
          color: currentColors.color,
        }}
        onClick={() => setIsOpen(!isOpen)}
      >
        ENV: {currentEnv.toUpperCase()}
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            marginTop: "4px",
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: "8px",
            boxShadow: "0 4px 10px rgba(0,0,0,0.08)",
            zIndex: 1000,
            minWidth: "240px",
          }}
        >
          {Object.entries(HOSTS).map(([env, host]) => {
            const colors = {
              production: "#e53e3e",
              staging: "#d69e2e",
              development: "#3182ce",
            };

            return (
              <div
                key={env}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "10px 12px",
                  cursor: "pointer",
                }}
                onClick={() => {
                  onEnvChange(env as EnvName);
                  setIsOpen(false);
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#f7fafc")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "white")
                }
              >
                <span
                  style={{
                    display: "inline-block",
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: colors[env as keyof typeof colors],
                  }}
                />
                <span
                  style={{
                    fontFamily: '"Monaco", "Menlo", monospace',
                    fontSize: "12px",
                  }}
                >
                  {env} ({host})
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// JSON Viewer Component
const JSONViewer: React.FC<{
  data: any;
  depth?: number;
}> = ({ data, depth = 0 }) => {
  const [collapsedItems, setCollapsedItems] = useState<Set<string>>(new Set());

  const toggleCollapsed = (id: string) => {
    setCollapsedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const renderValue = (obj: any, currentDepth: number = 0): React.ReactNode => {
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

      const id = `array-${Math.random().toString(36).substr(2, 9)}`;
      const shouldAutoExpand = obj.length <= 7 && currentDepth <= 4;
      const isCollapsed =
        collapsedItems.has(id) ||
        (!shouldAutoExpand && !collapsedItems.has(id));

      return (
        <>
          <span
            className={`json-expandable ${isCollapsed ? "collapsed" : ""}`}
            onClick={() => toggleCollapsed(id)}
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
              obj.map((item, index) => (
                <div key={index} style={{ marginLeft: "20px" }}>
                  <span className="json-index">{index}:</span>{" "}
                  {renderValue(item, currentDepth + 1)}
                </div>
              ))}
          </div>
        </>
      );
    }

    if (typeof obj === "object") {
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        return <span className="json-bracket">{}</span>;
      }

      const id = `object-${Math.random().toString(36).substr(2, 9)}`;
      const shouldAutoExpand = keys.length <= 7 && currentDepth <= 4;
      const isCollapsed =
        collapsedItems.has(id) ||
        (!shouldAutoExpand && !collapsedItems.has(id));

      return (
        <>
          <span
            className={`json-expandable ${isCollapsed ? "collapsed" : ""}`}
            onClick={() => toggleCollapsed(id)}
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
              keys.map((key) => (
                <div key={key} style={{ marginLeft: "20px" }}>
                  <span className="json-key">"{key}"</span>
                  <span className="json-colon">:</span>{" "}
                  {renderValue(obj[key], currentDepth + 1)}
                </div>
              ))}
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
const AdminConsole: React.FC = () => {
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [currentRoomId, setCurrentRoomId] = useState<string>("");
  const [roomData, setRoomData] = useState<RoomData | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [hostEnv, setHostEnv] = useState<EnvName>(
    () =>
      (localStorage.getItem("playhtml-admin-host-env") as EnvName) ||
      "production"
  );
  const [roomStatus, setRoomStatus] = useState<{
    message: string;
    type: "loading" | "success" | "error" | "empty";
  } | null>(null);

  // Debug sections visibility
  const [showRawDbData, setShowRawDbData] = useState(false);
  const [showYDocDebug, setShowYDocDebug] = useState(false);
  const [showDataComparison, setShowDataComparison] = useState(false);

  // Debug data
  const [rawDbData, setRawDbData] = useState<any>(null);
  const [debugSteps, setDebugSteps] = useState<
    Array<{ message: string; type: string }>
  >([]);
  const [reconstructedDoc, setReconstructedDoc] = useState<any>(null);
  const [comparisonData, setComparisonData] = useState<any>(null);

  const [debugToolsEnabled, setDebugToolsEnabled] = useState(false);

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
        setShowRawDbData(false);
        setShowYDocDebug(false);
        setShowDataComparison(false);
        setDebugToolsEnabled(false);
        // Load new room data if authenticated
        if (stored || adminToken) {
          loadRoom(roomId);
        }
      } else {
        setCurrentRoomId('');
        setRoomData(null);
        setRoomStatus(null);
        setShowRawDbData(false);
        setShowYDocDebug(false);
        setShowDataComparison(false);
        setDebugToolsEnabled(false);
      }
    };

    window.addEventListener('popstate', handlePopState);
    addLog("info", "Admin console initialized");

    return () => {
      window.removeEventListener('popstate', handlePopState);
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

  const handleEnvChange = (env: EnvName) => {
    setHostEnv(env);
    localStorage.setItem("playhtml-admin-host-env", env);
    if (currentRoomId && adminToken) {
      loadRoom(currentRoomId);
    }
  };

  const handleAuth = () => {
    if (adminToken) {
      // Logout
      setAdminToken(null);
      localStorage.removeItem("playhtml-admin-token");
      addLog("info", "Logged out");
    } else {
      // Login - prompt for token
      const token = prompt("Enter admin token:");
      if (token) {
        const trimmedToken = token.trim();
        setAdminToken(trimmedToken);
        localStorage.setItem("playhtml-admin-token", trimmedToken);
        addLog("info", "Admin token saved");
      }
    }
  };

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
    setShowRawDbData(false);
    setShowYDocDebug(false);
    setShowDataComparison(false);
    
    setRoomStatus({ message: "Loading room data...", type: "loading" });
    
    // Always ensure room ID is properly encoded for URL
    const encodedRoomId = ensureEncodedRoomId(targetRoomId);
    
    if (!roomId) {
      // Only update if called from button, not from effect
      setCurrentRoomId(encodedRoomId);
      updateURLWithRoom(encodedRoomId);
    }

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

    const baseUrl = `${getPartykitHost()}/parties/main/${roomId}`;
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

  const loadRawDatabaseData = async () => {
    if (!currentRoomId || !adminToken) return;

    try {
      const baseUrl = `${getPartykitHost()}/parties/main/${currentRoomId}`;
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
      setShowRawDbData(true);
      addLog("info", "Loaded raw database data", data);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Failed to load raw data: ${msg}`, error);
    }
  };

  const debugYDocLoading = async () => {
    if (!currentRoomId || !adminToken) return;

    setShowYDocDebug(true);
    setDebugSteps([]);
    setReconstructedDoc(null);

    const addStep = (
      message: string,
      type: "info" | "success" | "warning" | "error" = "info"
    ) => {
      setDebugSteps((prev) => [
        ...prev,
        { message: `[${new Date().toLocaleTimeString()}] ${message}`, type },
      ]);
      const level: DebugLog["level"] =
        type === "success" ? "info" : type === "warning" ? "warn" : type;
      addLog(level, message);
    };

    try {
      addStep("🔍 Starting Y.Doc reconstruction debug...", "info");
      addStep("📁 Fetching raw database document...", "info");

      const baseUrl = `${getPartykitHost()}/parties/main/${currentRoomId}`;
      const rawUrl = `${baseUrl}/admin/raw-data?token=${encodeURIComponent(
        adminToken
      )}`;

      const rawResponse = await fetch(rawUrl);
      const rawData = await rawResponse.json();

      if (!rawData.document) {
        addStep("❌ No document found in database", "error");
        return;
      }

      addStep(
        `✅ Found document: ${rawData.document.base64Length} bytes`,
        "success"
      );
      addStep("🔧 Attempting to reconstruct Y.Doc from base64...", "info");

      try {
        // Import Y.js dynamically
        const Y = await import("yjs");
        const doc = new Y.Doc();

        const base64 = rawData.document.document;
        const buffer = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

        addStep(`📦 Decoded ${buffer.length} bytes from base64`, "success");

        Y.applyUpdate(doc, buffer);
        addStep("✅ Successfully applied update to new Y.Doc", "success");

        addStep("🔧 Using SyncedStore to extract data...", "info");
        const { syncedStore } = await import("@syncedstore/core");
        const store = syncedStore<{ play: Record<string, any> }>(
          { play: {} },
          doc
        );

        // Clone using same logic as original
        const reconstructedData = JSON.parse(JSON.stringify(store.play));
        const hasAnyData = Object.keys(reconstructedData).some(
          (tag) => Object.keys(reconstructedData[tag] || {}).length > 0
        );

        if (hasAnyData) {
          addStep(
            `🎯 Extracted ${
              Object.keys(reconstructedData).length
            } capability types`,
            "success"
          );
          const totalElements = Object.values(reconstructedData).reduce(
            (sum, tagData: any) => sum + Object.keys(tagData).length,
            0
          );
          addStep(`📊 Found ${totalElements} total elements`, "success");
        } else {
          addStep("⚠️  Y.Doc loaded but contains no PlayHTML data", "warning");
        }

        setReconstructedDoc(reconstructedData);
        addStep("✅ Debug reconstruction complete!", "success");
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        addStep(`❌ Y.Doc reconstruction failed: ${msg}`, "error");
        addLog("error", "Y.Doc reconstruction error", error);
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addStep(`❌ Debug process failed: ${msg}`, "error");
      addLog("error", "Debug Y.Doc loading error", error);
    }
  };

  const compareDataMethods = async () => {
    if (!currentRoomId || !adminToken) return;

    try {
      addLog("info", "Comparing data extraction methods...");

      const baseUrl = `${getPartykitHost()}/parties/main/${currentRoomId}`;
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
      setShowDataComparison(true);
      addLog("info", "Data method comparison results:", comparison);

      // Show summary alert
      const directHasData = comparison.methods?.direct?.hasData;
      const liveHasData = comparison.methods?.live?.hasData;
      const dataMatch = comparison.differences?.dataMatch;

      const directData = comparison.methods?.direct?.data || {};
      const liveData = comparison.methods?.live?.data || {};
      const directKeyCount = Object.keys(directData).reduce(
        (sum, tag) => sum + Object.keys(directData[tag] || {}).length,
        0
      );
      const liveKeyCount = Object.keys(liveData).reduce(
        (sum, tag) => sum + Object.keys(liveData[tag] || {}).length,
        0
      );

      let summary = "🔍 Data Comparison Results:\n\n";
      summary += `Direct method: ${
        directHasData ? `✅ ${directKeyCount} elements` : "❌ No data"
      }\n`;
      summary += `Live method: ${
        liveHasData ? `✅ ${liveKeyCount} elements` : "❌ No data"
      }\n`;
      summary += `Data match: ${
        dataMatch ? "✅ Identical" : "❌ Different"
      }\n\n`;

      if (!dataMatch && directHasData && liveHasData) {
        const keyDiffs = comparison.differences?.sameKeys;
        if (keyDiffs) {
          summary += `Capability differences:\n`;
          summary += `- Direct only: ${
            keyDiffs.directOnly.join(", ") || "none"
          }\n`;
          summary += `- Live only: ${keyDiffs.liveOnly.join(", ") || "none"}\n`;
          summary += `- Common: ${keyDiffs.common.join(", ") || "none"}\n`;
        }
      }

      summary += "\nSee comparison section below for detailed view.";
      alert(summary);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Failed to compare data methods: ${msg}`, error);
    }
  };

  const handleForceSaveLive = async () => {
    if (!currentRoomId || !adminToken) return;
    const ok = confirm(
      "Force save LIVE doc to DB? This will overwrite the DB snapshot."
    );
    if (!ok) return;

    try {
      const baseUrl = `${getPartykitHost()}/parties/main/${currentRoomId}`;
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
    const ok = confirm(
      "Force reload LIVE doc from DB? This merges DB snapshot into memory."
    );
    if (!ok) return;

    try {
      const baseUrl = `${getPartykitHost()}/parties/main/${currentRoomId}`;
      const url = `${baseUrl}/admin/force-reload-live?token=${encodeURIComponent(
        adminToken
      )}`;
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      addLog("info", "Force-reloaded live doc from DB");
      alert("✅ Live doc reloaded from DB. Re-running comparison.");
      await compareDataMethods();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      addLog("error", `Force reload failed: ${msg}`);
      alert(`❌ Force reload failed: ${msg}`);
    }
  };

  const removeSubscriberById = async (consumerRoomId: string) => {
    if (!currentRoomId || !adminToken) return;

    try {
      const baseUrl = `${getPartykitHost()}/parties/main/${currentRoomId}`;
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

  return (
    <div className="admin-container">
      <header className="admin-header">
        <h1>🛠️ PlayHTML Admin Console</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <EnvironmentSelector
            currentEnv={hostEnv}
            onEnvChange={handleEnvChange}
          />
          <div className="auth-controls">
            <button
              className={`auth-btn ${adminToken ? "authenticated" : ""}`}
              onClick={handleAuth}
            >
              {adminToken ? "🔓 Logout" : "🔐 Authenticate"}
            </button>
            <span
              className={`auth-status ${adminToken ? "authenticated" : ""}`}
            >
              {adminToken ? "Authenticated" : "Not authenticated"}
            </span>
          </div>
        </div>
      </header>

      {adminToken ? (
        <div className="admin-content">
          <section className="room-inspector">
            <h2>Room Inspector</h2>
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
                  <h3>Y.Doc Data</h3>
                  {roomData.ydoc?.play ? (
                    <div>
                      <div className="ydoc-debug-info">
                        <div className="debug-stats">
                          <span className="stat-item">
                            📊 {Object.keys(roomData.ydoc.play).length}{" "}
                            capability types
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
                  ) : (
                    <div className="empty">No Y.Doc play data available</div>
                  )}
                </div>

                <div className="data-section">
                  <h3>Room Metadata</h3>
                  <div className="metadata-list">
                    <div className="metadata-item">
                      <strong>Room ID (Encoded):</strong>{" "}
                      <code>{roomData.roomId || currentRoomId}</code>
                    </div>
                    <div className="metadata-item">
                      <strong>Room ID (Readable):</strong>{" "}
                      <code>{decodeRoomId(roomData.roomId || currentRoomId)}</code>
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
                  </div>
                </div>

                <div className="data-section">
                  <h3>Shared Data</h3>
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
                </div>
              </>
            )}

            {showRawDbData && rawDbData && (
              <div className="data-section">
                <h3>Raw Database Data</h3>
                <div className="debug-info">
                  <div className="debug-item">
                    <strong>Document Size:</strong>
                    <span>
                      {rawDbData.document
                        ? `${
                            Math.round(
                              (rawDbData.document.base64Length / 1024) * 100
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
              </div>
            )}

            {showYDocDebug && (
              <div className="data-section">
                <h3>Y.Doc Loading Debug</h3>
                <div className="debug-steps">
                  {debugSteps.map((step, index) => (
                    <div key={index} className={`debug-step ${step.type}`}>
                      {step.message}
                    </div>
                  ))}
                </div>
                {reconstructedDoc && <JSONViewer data={reconstructedDoc} />}
              </div>
            )}

            {showDataComparison && comparisonData && (
              <div className="data-section">
                <h3>Live vs Admin Data Comparison</h3>
                <div className="debug-info">
                  <div className="debug-item">
                    <strong>Direct Method Keys:</strong>
                    <span>
                      {Object.keys(
                        comparisonData.methods?.direct?.data || {}
                      ).reduce(
                        (sum, tag) =>
                          sum +
                          Object.keys(
                            comparisonData.methods.direct.data[tag] || {}
                          ).length,
                        0
                      )}
                    </span>
                  </div>
                  <div className="debug-item">
                    <strong>Live Method Keys:</strong>
                    <span>
                      {Object.keys(
                        comparisonData.methods?.live?.data || {}
                      ).reduce(
                        (sum, tag) =>
                          sum +
                          Object.keys(
                            comparisonData.methods.live.data[tag] || {}
                          ).length,
                        0
                      )}
                    </span>
                  </div>
                  <div className="debug-item">
                    <strong>Data Match:</strong>
                    <span
                      style={{
                        color: comparisonData.differences?.dataMatch
                          ? "#38a169"
                          : "#e53e3e",
                      }}
                    >
                      {comparisonData.differences?.dataMatch
                        ? "✅ Yes"
                        : "❌ No"}
                    </span>
                  </div>
                </div>
                <div className="tool-grid" style={{ marginBottom: "10px" }}>
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
                <div className="shared-data-grid">
                  <div className="shared-section">
                    <h4>Direct Method Data (Admin Console)</h4>
                    <JSONViewer
                      data={comparisonData.methods?.direct?.data || {}}
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
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

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
                onClick={loadRawDatabaseData}
              >
                Load Raw DB Data
              </button>
              <button
                className="tool-btn"
                disabled={!debugToolsEnabled}
                onClick={debugYDocLoading}
              >
                Debug Y.Doc Loading
              </button>
              <button
                className="tool-btn"
                disabled={!debugToolsEnabled}
                onClick={compareDataMethods}
              >
                Compare Live vs Admin Data
              </button>
            </div>
          </section>

          <DebugLogs logs={logs} onClearLogs={() => setLogs([])} />
        </div>
      ) : null}
    </div>
  );
};

// Render the app
const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<AdminConsole />);
}
