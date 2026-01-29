// ABOUTME: Controls panel component for the Internet Movement visualization
// ABOUTME: Provides UI for adjusting visualization settings and displaying stats
import React, { useState, memo } from "react";
import { CollectionEvent, Trail } from "./types";

interface ControlsProps {
  visible: boolean;
  settings: any;
  setSettings: React.Dispatch<React.SetStateAction<any>>;
  loading: boolean;
  error: string | null;
  events: CollectionEvent[];
  trails: Trail[];
  availableDomains: string[];
  fetchEvents: () => void;
  timeRange: { min: number; max: number; duration: number };
}

export const Controls: React.FC<ControlsProps> = memo(
  ({
    visible,
    settings,
    setSettings,
    loading,
    error,
    events,
    trails,
    availableDomains,
    fetchEvents,
    timeRange,
  }) => {
    const [expandedSections, setExpandedSections] = useState<
      Record<string, boolean>
    >({
      appearance: true,
      animation: true,
      filters: true,
    });

    const toggleSection = (section: string) => {
      setExpandedSections((prev) => ({
        ...prev,
        [section]: !prev[section],
      }));
    };

    const CollapsibleSection = ({
      title,
      sectionKey,
      children,
    }: {
      title: string;
      sectionKey: string;
      children: React.ReactNode;
    }) => {
      const isExpanded = expandedSections[sectionKey];
      return (
        <div
          style={{
            borderBottom: "1px solid #eee",
            paddingBottom: "8px",
            marginBottom: "8px",
          }}
        >
          <button
            type="button"
            onClick={() => toggleSection(sectionKey)}
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
              {isExpanded ? "▼" : "▶"}
            </span>
          </button>
          {isExpanded && <div style={{ marginTop: "8px" }}>{children}</div>}
        </div>
      );
    };

    if (!visible) return null;

    return (
      <div
        className="controls"
        style={{ maxHeight: "calc(100vh - 40px)", overflowY: "auto" }}
      >
        <CollapsibleSection title="Appearance" sectionKey="appearance">
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
            <label htmlFor="point-size">Point Size</label>
            <input
              id="point-size"
              type="range"
              min="0"
              max="20"
              step="0.5"
              value={settings.pointSize}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  pointSize: parseFloat(e.target.value),
                }))
              }
            />
            <span>{settings.pointSize.toFixed(1)}px</span>
          </div>

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
        </CollapsibleSection>

        <CollapsibleSection title="Animation" sectionKey="animation">
          <div className="control-group">
            <label htmlFor="max-concurrent">Max Concurrent Trails</label>
            <input
              id="max-concurrent"
              type="range"
              min="1"
              max="20"
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

        <CollapsibleSection title="Filters" sectionKey="filters">
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

          <div className="control-group">
            <label>Event Filter</label>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                marginTop: "4px",
              }}
            >
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: "normal",
                  textTransform: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.eventFilter.move}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      eventFilter: { ...s.eventFilter, move: e.target.checked },
                    }))
                  }
                  style={{ marginRight: "6px" }}
                />
                Move Events
              </label>
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: "normal",
                  textTransform: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.eventFilter.click}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      eventFilter: {
                        ...s.eventFilter,
                        click: e.target.checked,
                      },
                    }))
                  }
                  style={{ marginRight: "6px" }}
                />
                Click Events
              </label>
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: "normal",
                  textTransform: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.eventFilter.hold}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      eventFilter: { ...s.eventFilter, hold: e.target.checked },
                    }))
                  }
                  style={{ marginRight: "6px" }}
                />
                Hold Events
              </label>
              <label
                style={{
                  fontSize: "12px",
                  fontWeight: "normal",
                  textTransform: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={settings.eventFilter.cursor_change}
                  onChange={(e) =>
                    setSettings((s: any) => ({
                      ...s,
                      eventFilter: {
                        ...s.eventFilter,
                        cursor_change: e.target.checked,
                      },
                    }))
                  }
                  style={{ marginRight: "6px" }}
                />
                Cursor Change Events
              </label>
            </div>
          </div>

          <div className="control-group">
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
        </CollapsibleSection>

        <CollapsibleSection title="Event Types" sectionKey="eventTypes">
          <div className="control-group">
            <label
              style={{
                fontSize: "12px",
                fontWeight: "normal",
                textTransform: "none",
              }}
            >
              <input
                type="checkbox"
                checked={settings.eventTypeFilter.cursor}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    eventTypeFilter: {
                      ...s.eventTypeFilter,
                      cursor: e.target.checked,
                    },
                  }))
                }
                style={{ marginRight: "6px" }}
              />
              Cursor Events
            </label>
          </div>
          <div className="control-group">
            <label
              style={{
                fontSize: "12px",
                fontWeight: "normal",
                textTransform: "none",
              }}
            >
              <input
                type="checkbox"
                checked={settings.eventTypeFilter.keyboard}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    eventTypeFilter: {
                      ...s.eventTypeFilter,
                      keyboard: e.target.checked,
                    },
                  }))
                }
                style={{ marginRight: "6px" }}
              />
              Keyboard Events
            </label>
          </div>
          <div className="control-group">
            <label
              style={{
                fontSize: "12px",
                fontWeight: "normal",
                textTransform: "none",
              }}
            >
              <input
                type="checkbox"
                checked={settings.eventTypeFilter.viewport}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    eventTypeFilter: {
                      ...s.eventTypeFilter,
                      viewport: e.target.checked,
                    },
                  }))
                }
                style={{ marginRight: "6px" }}
              />
              Viewport Events
            </label>
          </div>
        </CollapsibleSection>

        <CollapsibleSection title="Keyboard Settings" sectionKey="keyboard">
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

        <CollapsibleSection title="Scroll Animation" sectionKey="scroll">
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
            <label htmlFor="max-concurrent-scrolls">
              Max Concurrent Scrolls
            </label>
            <input
              id="max-concurrent-scrolls"
              type="range"
              min="1"
              max="10"
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
            <label htmlFor="min-viewports">
              Min Viewports
            </label>
            <input
              id="min-viewports"
              type="range"
              min="5"
              max="100"
              step="5"
              value={settings.minViewports}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  minViewports: parseInt(e.target.value),
                }))
              }
            />
            <span>{settings.minViewports}</span>
          </div>

          <div className="control-group">
            <label htmlFor="max-viewports">
              Max Viewports
            </label>
            <input
              id="max-viewports"
              type="range"
              min="10"
              max="200"
              step="5"
              value={settings.maxViewports}
              onChange={(e) =>
                setSettings((s: any) => ({
                  ...s,
                  maxViewports: parseInt(e.target.value),
                }))
              }
            />
            <span>{settings.maxViewports}</span>
          </div>
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
                {events.length.toLocaleString()} events,{" "}
                {trails.length.toLocaleString()} trails
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
