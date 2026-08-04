// ABOUTME: Renders one stacked "sheet" — paper backing plus its ordered plates (page, scroll, trails) and caption.
// ABOUTME: Owns the sheet's fan transform (translate + rotation); hover/dim state is driven from VellumStack.
import type { VellumSettings } from "./settings";
import type { VellumSheet } from "./types";
import { PLATE_REGISTRY } from "./plates/registry";

/** Deterministic pseudo-random value in [-1, 1] from an integer seed — used
 * so each sheet's fan rotation is stable across re-renders instead of
 * re-randomizing every time. */
function seededSignedUnit(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return (x - Math.floor(x)) * 2 - 1;
}

export interface SheetProps {
  sheet: VellumSheet;
  frame: { width: number; height: number };
  t: number;
  settings: VellumSettings;
  index: number;
  total: number;
  hovered: boolean;
  dimmed: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}

export function Sheet({
  sheet,
  frame,
  t,
  settings,
  index,
  total,
  hovered,
  dimmed,
  onHoverStart,
  onHoverEnd,
}: SheetProps) {
  const fanAngleRad = (settings.fanAngleDeg * Math.PI) / 180;
  const dx = Math.cos(fanAngleRad) * settings.fanDistance * index * settings.spread;
  const dy = Math.sin(fanAngleRad) * settings.fanDistance * index * settings.spread;
  const rotate = seededSignedUnit(sheet.seed) * settings.rotateJitterDeg * settings.spread;
  const lift = settings.hoverLift && hovered ? -8 : 0;

  const isEligibleForIframe =
    settings.showPages && settings.maxPageLayers > 0 && index >= total - settings.maxPageLayers;

  const labelOpacity = Math.min(1, settings.spread * 2);

  return (
    <div
      onMouseEnter={onHoverStart}
      onMouseLeave={onHoverEnd}
      style={{
        position: "absolute",
        // Fan offset is applied via left/top pixel offsets, NOT transform.
        // `transform` on this root — even a no-op translate — always creates
        // a new CSS stacking context, and per the compositing spec every
        // stacking context is an isolated blend group. That would trap each
        // ink plate's mix-blend-mode inside its own sheet, so it could never
        // multiply against the sheets/paper beneath it — silently killing
        // the whole cross-sheet vellum effect. left/top don't create a
        // stacking context, so the ink plates stay free to blend into the
        // shared stack below. Do NOT "optimize" this back to translate().
        left: dx,
        top: dy + lift,
        width: frame.width,
        height: frame.height,
        // Rotation still needs `transform`, so it still isolates — but only
        // while actually fanned (spread > 0), where sheets have physically
        // separated and losing cross-sheet blending is visually fine. At
        // spread=0 this must stay `undefined` (no transform property at all).
        transform: Math.abs(rotate) > 0.01 ? `rotate(${rotate}deg)` : undefined,
        transition: "left 300ms ease, top 300ms ease, transform 300ms ease, opacity 200ms ease, box-shadow 200ms ease",
        // opacity < 1 also isolates (same compositing rule as transform), so
        // only set it while actually dimmed — an un-dimmed sheet must have no
        // opacity property so its ink plates can blend past it.
        opacity: dimmed ? 0.35 : undefined,
        boxShadow:
          hovered && settings.hoverLift
            ? "0 18px 34px rgba(40,32,20,0.28)"
            : `0 ${Math.round(2 + settings.spread * 6)}px ${Math.round(
                6 + settings.spread * 14,
              )}px rgba(40,32,20,${0.08 + settings.spread * 0.1})`,
      }}
    >
      {/* Sheet paper: a translucent white layer. Deliberately not blended —
          only the ink plates below blend, so the paper itself just adds a
          milky base each layer contributes. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `rgba(255,255,255,${settings.sheetOpacity})`,
          border: settings.showSheetEdges ? "1px solid rgba(60,50,40,0.14)" : "none",
        }}
      />

      <div style={{ position: "absolute", inset: 0 }}>
        {PLATE_REGISTRY.map((plate) => {
          if (!settings[plate.enabledKey]) return null;
          const Component = plate.component;
          return (
            <Component
              key={plate.id}
              sheet={sheet}
              frame={frame}
              t={t}
              settings={settings}
              isEligibleForIframe={isEligibleForIframe}
            />
          );
        })}
      </div>

      {settings.showLabels ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: frame.height + 6,
            width: frame.width,
            fontFamily: "'Lora', Georgia, serif",
            fontSize: "11px",
            color: "rgba(61,56,51,0.75)",
            opacity: labelOpacity,
            pointerEvents: "none",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sheet.domain} — {sheet.sublabel}
        </div>
      ) : null}
    </div>
  );
}
