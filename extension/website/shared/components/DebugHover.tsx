// ABOUTME: Debug-mode hover context + info pane for inspecting individual
// ABOUTME: visualization items (trails, typing boxes, scroll viewports, ...).

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface DebugHoverField {
  label: string;
  value: string;
}

export interface DebugHoverInfo {
  /** Short kind label shown as the pane header, e.g. "Cursor trail". */
  kind: string;
  /** Stable id for the hovered datum — used to skip redundant state updates
   * when the same item keeps reporting hover. */
  id: string;
  /** Optional accent color (matches the datum's color on canvas). */
  color?: string;
  /** Title line — usually a domain, page title, or short identifier. */
  title?: string;
  /** Ordered key/value rows shown beneath the title. Keep values short — the
   * pane is a compact tooltip, not a full inspector. */
  fields: DebugHoverField[];
}

interface DebugHoverContextValue {
  enabled: boolean;
  show: (info: DebugHoverInfo) => void;
  hide: (id?: string) => void;
}

const DebugHoverContext = createContext<DebugHoverContextValue>({
  enabled: false,
  show: () => {},
  hide: () => {},
});

export function useDebugHover() {
  return useContext(DebugHoverContext);
}

interface DebugHoverProviderProps {
  enabled: boolean;
  children: React.ReactNode;
}

/** Provider + tooltip pane combined. Tracks the currently-hovered datum
 * plus the latest mouse position (read from a window-level listener so we
 * pick up movement even when the cursor sits on top of an SVG element
 * whose handlers don't fire on every move). */
export const DebugHoverProvider: React.FC<DebugHoverProviderProps> = ({
  enabled,
  children,
}) => {
  const [info, setInfo] = useState<DebugHoverInfo | null>(null);
  const infoIdRef = useRef<string | null>(null);

  const show = useCallback((next: DebugHoverInfo) => {
    if (infoIdRef.current === next.id) {
      setInfo((prev) => (prev && prev.id === next.id ? next : prev));
      return;
    }
    infoIdRef.current = next.id;
    setInfo(next);
  }, []);

  const hide = useCallback((id?: string) => {
    if (id !== undefined && infoIdRef.current !== id) return;
    infoIdRef.current = null;
    setInfo(null);
  }, []);

  // Drop any stale hover when debug mode flips off.
  useEffect(() => {
    if (!enabled) hide();
  }, [enabled, hide]);

  const value = useMemo<DebugHoverContextValue>(
    () => ({ enabled, show, hide }),
    [enabled, show, hide],
  );

  return (
    <DebugHoverContext.Provider value={value}>
      {children}
      {enabled && info && <DebugHoverPane info={info} />}
    </DebugHoverContext.Provider>
  );
};

const PANE_OFFSET_X = 16;
const PANE_OFFSET_Y = 16;
const PANE_MAX_WIDTH = 320;

const DebugHoverPane: React.FC<{ info: DebugHoverInfo }> = ({ info }) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      setPos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  // Flip the pane to the other side of the cursor if it would clip the
  // viewport edge. Keeps the whole card visible without resorting to
  // scrolling or off-screen content.
  const left = pos
    ? Math.min(pos.x + PANE_OFFSET_X, window.innerWidth - PANE_MAX_WIDTH - 8)
    : null;
  const top = pos
    ? Math.min(pos.y + PANE_OFFSET_Y, window.innerHeight - 200)
    : null;

  if (left === null || top === null) return null;

  return (
    <div
      style={{
        position: "fixed",
        left,
        top,
        zIndex: 300,
        maxWidth: PANE_MAX_WIDTH,
        background: "#faf9f6",
        border: "1px solid rgba(61,56,51,0.2)",
        borderRadius: 4,
        padding: "10px 12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
        fontFamily: "'Atkinson Hyperlegible', system-ui, sans-serif",
        fontSize: 12,
        color: "#3d3833",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
          paddingBottom: 6,
          borderBottom: "1px solid rgba(61,56,51,0.1)",
        }}
      >
        {info.color && (
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: info.color,
              border: "1px solid rgba(0,0,0,0.15)",
              flexShrink: 0,
            }}
          />
        )}
        <span
          style={{
            fontFamily: "'Martian Mono', monospace",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "#8a8279",
          }}
        >
          {info.kind}
        </span>
      </div>
      {info.title && (
        <div
          style={{
            fontWeight: 600,
            marginBottom: 6,
            wordBreak: "break-word",
            lineHeight: 1.3,
          }}
        >
          {info.title}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: 8, rowGap: 3 }}>
        {info.fields.map((f) => (
          <React.Fragment key={f.label}>
            <span
              style={{
                color: "#8a8279",
                fontFamily: "'Martian Mono', monospace",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                whiteSpace: "nowrap",
              }}
            >
              {f.label}
            </span>
            <span
              style={{
                fontFamily: "'Martian Mono', monospace",
                fontSize: 11,
                wordBreak: "break-word",
              }}
            >
              {f.value}
            </span>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
