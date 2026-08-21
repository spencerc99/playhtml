// ABOUTME: Entry point for the vellum experiment — owns settings persistence, day selection, and event fetching.
// ABOUTME: Renders the wordmark, day picker, VellumStack, and the settings dev panel over a warm paper background.
import "./vellum.scss";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import ReactDOM from "react-dom/client";
import { useArchiveEvents } from "../shared/hooks/useArchiveEvents";
import { buildSheets } from "./grouping";
import { DEFAULT_VELLUM_SETTINGS, loadSettings, saveSettings } from "./settings";
import type { VellumSettings } from "./settings";
import { VellumDevPanel } from "./VellumDevPanel";
import { VellumStack } from "./VellumStack";

// trails → cursor events, scrolling → viewport events, navigation → navigation
// events (titles + page-visit grouping key material). See
// shared/components/registry.ts for the id → required-event-type mapping.
const REQUIRED_VISUALIZATIONS = ["trails", "scrolling", "navigation"];
const RECENT_DAYS_SHOWN = 14;

function dayButtonStyle(active: boolean): CSSProperties {
  return {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "inherit",
    color: active ? "#2c2822" : "rgba(61,56,51,0.55)",
    textDecoration: active ? "underline" : "none",
    padding: "2px 4px",
  };
}

function CenteredMessage({ text }: { text: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Source Serif 4', 'Lora', Georgia, serif",
        fontStyle: "italic",
        fontSize: "18px",
        color: "rgba(61,56,51,0.6)",
        pointerEvents: "none",
      }}
    >
      {text}
    </div>
  );
}

function Vellum() {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [settings, setSettings] = useState<VellumSettings>(() => loadSettings());

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const { events, loading, error, dayCounts } = useArchiveEvents({
    selectedDay,
    timeOfDay: null,
    serverDomain: settings.domainFilter,
    activeVisualizations: REQUIRED_VISUALIZATIONS,
    batchPlayback: false,
  });

  const sheets = useMemo(
    () => buildSheets(events, settings),
    [events, settings.groupingMode, settings.maxSheets, settings.minEventsPerSheet],
  );

  const recentDays = useMemo(
    () => [...dayCounts.keys()].sort((a, b) => (a < b ? 1 : -1)).slice(0, RECENT_DAYS_SHOWN),
    [dayCounts],
  );

  const handleReset = () => {
    setSettings({ ...DEFAULT_VELLUM_SETTINGS });
  };

  return (
    <div style={{ position: "absolute", inset: 0, background: settings.paperColor }}>
      <span
        style={{
          position: "absolute",
          top: 14,
          left: 20,
          zIndex: 200,
          fontFamily: "'Source Serif 4', 'Lora', Georgia, serif",
          fontStyle: "italic",
          fontWeight: 200,
          fontSize: "20px",
          color: "#3d3833",
          pointerEvents: "none",
        }}
      >
        we were online
        <span style={{ fontSize: "13px", marginLeft: "6px" }}>· vellum</span>
      </span>

      <div
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 200,
          display: "flex",
          gap: "10px",
          fontFamily: "'Lora', Georgia, serif",
          fontSize: "12px",
          color: "rgba(61,56,51,0.75)",
        }}
      >
        <button onClick={() => setSelectedDay(null)} style={dayButtonStyle(selectedDay === null)}>
          recent
        </button>
        {recentDays.map((day) => (
          <button
            key={day}
            onClick={() => setSelectedDay(day)}
            style={dayButtonStyle(selectedDay === day)}
          >
            {day.slice(5)}
          </button>
        ))}
      </div>

      {loading ? (
        <CenteredMessage text="gathering sheets…" />
      ) : error ? (
        <CenteredMessage text={`could not load: ${error}`} />
      ) : sheets.length === 0 ? (
        <CenteredMessage text="no sessions substantial enough to print yet" />
      ) : (
        <VellumStack sheets={sheets} settings={settings} />
      )}

      <VellumDevPanel settings={settings} onChange={setSettings} onReset={handleReset} />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("reactContent") as HTMLElement).render(<Vellum />);
