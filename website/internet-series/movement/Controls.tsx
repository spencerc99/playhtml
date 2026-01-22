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

export const Controls: React.FC<ControlsProps> = memo(({
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
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    appearance: true,
    animation: true,
    filters: true,
    clickEffects: false,
    info: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const CollapsibleSection = ({ title, sectionKey, children }: { title: string; sectionKey: string; children: React.ReactNode }) => {
    const isExpanded = expandedSections[sectionKey];
    return (
      <div style={{ borderBottom: '1px solid #eee', paddingBottom: '8px', marginBottom: '8px' }}>
        <button
          type="button"
          onClick={() => toggleSection(sectionKey)}
          style={{
            width: '100%',
            textAlign: 'left',
            background: 'none',
            border: 'none',
            padding: '8px 0',
            cursor: 'pointer',
            fontSize: '13px',
            fontWeight: '600',
            color: '#333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{title}</span>
          <span style={{ fontSize: '12px', opacity: 0.6 }}>
            {isExpanded ? '▼' : '▶'}
          </span>
        </button>
        {isExpanded && (
          <div style={{ marginTop: '8px' }}>
            {children}
          </div>
        )}
      </div>
    );
  };

  if (!visible) return null;

  return (
    <div className="controls">
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
                trailStyle: e.target.value as 'straight' | 'smooth' | 'organic' | 'chaotic',
              }))
            }
          >
            <option value="straight">Straight (Geometric)</option>
            <option value="smooth">Smooth (Curved)</option>
            <option value="organic">Organic (Subtle Variation)</option>
            <option value="chaotic">Chaotic (Sketchy)</option>
          </select>
        </div>

        {settings.trailStyle === 'chaotic' && (
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
                trailAnimationMode: e.target.value as 'natural' | 'stagger',
              }))
            }
          >
            <option value="natural">Natural (Actual Timestamps)</option>
            <option value="stagger">Stagger (Choreographed)</option>
          </select>
        </div>

        {settings.trailAnimationMode === 'stagger' && (
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
          <select
            id="domain-filter"
            value={settings.domainFilter}
            onChange={(e) =>
              setSettings((s: any) => ({
                ...s,
                domainFilter: e.target.value,
              }))
            }
          >
            <option value="">All Domains</option>
            {availableDomains.map((domain) => (
              <option key={domain} value={domain}>
                {domain}
              </option>
            ))}
          </select>
        </div>

        <div className="control-group">
          <label>Event Filter</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
            <label style={{ fontSize: '12px', fontWeight: 'normal', textTransform: 'none' }}>
              <input
                type="checkbox"
                checked={settings.eventFilter.move}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    eventFilter: { ...s.eventFilter, move: e.target.checked },
                  }))
                }
                style={{ marginRight: '6px' }}
              />
              Move Events
            </label>
            <label style={{ fontSize: '12px', fontWeight: 'normal', textTransform: 'none' }}>
              <input
                type="checkbox"
                checked={settings.eventFilter.click}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    eventFilter: { ...s.eventFilter, click: e.target.checked },
                  }))
                }
                style={{ marginRight: '6px' }}
              />
              Click Events
            </label>
            <label style={{ fontSize: '12px', fontWeight: 'normal', textTransform: 'none' }}>
              <input
                type="checkbox"
                checked={settings.eventFilter.hold}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    eventFilter: { ...s.eventFilter, hold: e.target.checked },
                  }))
                }
                style={{ marginRight: '6px' }}
              />
              Hold Events
            </label>
            <label style={{ fontSize: '12px', fontWeight: 'normal', textTransform: 'none' }}>
              <input
                type="checkbox"
                checked={settings.eventFilter.cursor_change}
                onChange={(e) =>
                  setSettings((s: any) => ({
                    ...s,
                    eventFilter: { ...s.eventFilter, cursor_change: e.target.checked },
                  }))
                }
                style={{ marginRight: '6px' }}
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
              style={{ marginRight: '8px' }}
            />
            Randomize Colors (Test Mode)
          </label>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Click Effects" sectionKey="clickEffects">
        <div style={{ fontSize: '12px', opacity: 0.7, fontStyle: 'italic' }}>
          Click effects are configured in the playground
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Info" sectionKey="info">
        <div style={{ fontSize: '10px', opacity: 0.5, marginTop: '8px', fontStyle: 'italic', marginBottom: '8px' }}>
          Tip: Double-tap 'D' to hide/show controls
        </div>

        <button onClick={fetchEvents} disabled={loading}>
          {loading ? "Loading..." : "Refresh Data"}
        </button>

        {error && <div className="error">{error}</div>}
        {!loading && events.length > 0 && (
          <div className="info">
            {events.length.toLocaleString()} events, {trails.length.toLocaleString()} trails
            <br />
            <div style={{ fontSize: "10px", marginTop: "4px", opacity: 0.7 }}>
              Move: {events.filter(e => !e.data.event || e.data.event === 'move').length} |
              Click: {events.filter(e => e.data.event === 'click').length} |
              Hold: {events.filter(e => e.data.event === 'hold').length} |
              Cursor Change: {events.filter(e => e.data.event === 'cursor_change').length}
            </div>
            {timeRange.duration > 0 && (
              <div style={{ fontSize: "10px", marginTop: "4px", opacity: 0.7 }}>
                Cycle: {(timeRange.duration / 1000 / 60).toFixed(1)} min
                {settings.animationSpeed !== 1 && ` (${settings.animationSpeed}x speed)`}
              </div>
            )}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
});
