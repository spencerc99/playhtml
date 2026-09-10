// ABOUTME: Measures the window, runs the shared playback clock, and lays out the fanned stack of Sheets.
// ABOUTME: Owns hover-lift/dim interaction state and the normalized-frame outline drawn behind the stack.
import { useEffect, useMemo, useState } from "react";
import type { VellumSettings } from "./settings";
import type { VellumSheet } from "./types";
import { Sheet } from "./Sheet";

interface VellumStackProps {
  sheets: VellumSheet[];
  settings: VellumSettings;
}

/** Below this spread, sheets are still effectively stacked flush — hovering
 * would just dim the entire concentrated pile under whatever sheet happens to
 * be on top, which reads as distracting noise rather than "picking up a
 * sheet". Hover only engages once sheets have physically fanned apart. */
const HOVER_SPREAD_THRESHOLD = 0.05;

function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return size;
}

/** Global playback clock: a single rAF loop computing loop phase
 * `p = (performance.now() / (loopSeconds*1000)) % 1`. Every sheet maps this
 * same normalized `t` onto its own event-time range, so all sheets animate
 * together and loop together regardless of how long each one's session was. */
function usePlaybackT(animate: boolean, loopSeconds: number): number {
  const [t, setT] = useState(1);
  useEffect(() => {
    if (!animate) {
      setT(1);
      return;
    }
    let raf = 0;
    const loopMs = Math.max(1, loopSeconds) * 1000;
    const tick = () => {
      setT((performance.now() / loopMs) % 1);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, loopSeconds]);
  return t;
}

export function VellumStack({ sheets, settings }: VellumStackProps) {
  const windowSize = useWindowSize();
  const t = usePlaybackT(settings.animate, settings.loopSeconds);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // If the user zeroes the spread slider back out while a sheet is hovered
  // (or was already dimmed from a prior hover), clear it — otherwise the
  // stack could get stuck dimmed with no way to un-hover once it's flush.
  useEffect(() => {
    if (settings.spread <= HOVER_SPREAD_THRESHOLD) setHoveredId(null);
  }, [settings.spread]);

  const frame = useMemo(() => {
    const maxWidth = windowSize.width * settings.frameScale;
    const maxHeight = windowSize.height * settings.frameScale;
    let width = maxWidth;
    let height = width / settings.frameAspect;
    if (height > maxHeight) {
      height = maxHeight;
      width = height * settings.frameAspect;
    }
    return { width: Math.round(width), height: Math.round(height) };
  }, [windowSize.width, windowSize.height, settings.frameScale, settings.frameAspect]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "relative", width: frame.width, height: frame.height }}>
        {/* Normalized browser-window bounds, shown behind the stack. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            border: "1px solid rgba(60,50,40,0.12)",
            pointerEvents: "none",
          }}
        />
        {sheets.map((sheet, index) => (
          <Sheet
            key={sheet.id}
            sheet={sheet}
            frame={frame}
            t={t}
            settings={settings}
            index={index}
            total={sheets.length}
            hovered={hoveredId === sheet.id}
            dimmed={hoveredId !== null && hoveredId !== sheet.id}
            onHoverStart={() => {
              if (settings.hoverLift && settings.spread > HOVER_SPREAD_THRESHOLD) {
                setHoveredId(sheet.id);
              }
            }}
            onHoverEnd={() =>
              setHoveredId((current) => (current === sheet.id ? null : current))
            }
          />
        ))}
      </div>
    </div>
  );
}
