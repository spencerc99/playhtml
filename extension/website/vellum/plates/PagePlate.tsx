// ABOUTME: Ghosted page render for one sheet — a large faint domain/title fallback beneath a scaled, scroll-driven iframe.
// ABOUTME: Adapts PagePreview's iframe-scaling technique; only sheets within maxPageLayers get a live iframe.
import { useMemo } from "react";
import type { PlateProps } from "../types";
import { buildScrollTimeline, scrollRangeOf, scrollYAt, sheetLocalTs } from "./scrollTimeline";

const RENDER_WIDTH = 1280;

/** Deterministic pseudo-random value in [0, 1) from a seed — same sin-hash
 * trick Sheet.tsx uses for rotation jitter, kept as a local copy here (rather
 * than imported) since it's a generic one-liner and PagePlate shouldn't reach
 * into Sheet.tsx for it. */
function seededUnit(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function PagePlate({ sheet, frame, t, settings, isEligibleForIframe }: PlateProps) {
  const timeline = useMemo(
    () => buildScrollTimeline(sheet.viewportEvents),
    [sheet.viewportEvents],
  );
  const scrollRange = useMemo(() => scrollRangeOf(timeline), [timeline]);

  const scale = frame.width / RENDER_WIDTH;
  const renderHeight = frame.height / scale;
  const pageHeight = renderHeight * (2 + scrollRange * 4);

  const currentTs = sheetLocalTs(sheet.startTs, sheet.endTs, t);
  const scrollY = scrollYAt(timeline, currentTs);
  const translateY = scrollY * (pageHeight - renderHeight);

  const filter = settings.pageGrayscale ? "grayscale(1) contrast(0.92)" : "none";

  // Ghost-title placement is deterministic-per-sheet rather than centered:
  // every sheet centering its title at the same spot means a stacked view
  // piles "localhost/wikipedia/nytimes" directly on top of each other into
  // illegible mush. Two independent draws off the same seed (decorrelated via
  // a salt on the second) spread titles across ~10%-60% of the frame height
  // and ~26px-40px of size, so stacked titles overprint at varied positions
  // like letterpress runs instead of coinciding.
  const titleTopPct = 10 + seededUnit(sheet.seed) * 50;
  const titleFontSize = 26 + seededUnit(sheet.seed * 2.6180339887 + 11) * 14;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        opacity: settings.pageOpacity,
        filter,
        // mixBlendMode lives on this same container as opacity/filter, not on
        // the ghost title alone: opacity < 1 already isolates this element
        // into its own compositing group (same rule that governs Sheet.tsx's
        // fan transform), so a mixBlendMode set only on an inner child could
        // never reach the stack below. Blending the whole container as one
        // group is also the look we want — under multiply a page's white
        // background becomes a no-op (the paper shows through) and only its
        // dark ghost-title/iframe features actually print.
        mixBlendMode: settings.blendMode,
        pointerEvents: "none",
      }}
    >
      {settings.showGhostTitles ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: `${titleTopPct}%`,
            padding: "0 8%",
            color: "rgba(61,56,51,0.28)",
          }}
        >
          <div
            style={{
              fontFamily: "'Source Serif 4', Georgia, serif",
              fontStyle: "italic",
              fontWeight: 300,
              fontSize: `${titleFontSize}px`,
              lineHeight: 1.1,
            }}
          >
            {sheet.domain}
          </div>
          {sheet.title ? (
            <div
              style={{
                fontFamily: "'Lora', Georgia, serif",
                fontSize: "16px",
                marginTop: "6px",
              }}
            >
              {sheet.title}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Live iframe is opt-in (settings.showPages), separate from ghost
          titles: real sites behind bot protection (e.g. Cloudflare) render a
          challenge/error page inside a sandboxed cross-origin iframe, and a
          challenge can never complete there — cookies/storage are blocked and
          there's no way to detect the failure cross-origin. That failure mode
          is exactly the top-of-stack sheets (isEligibleForIframe), so it
          would wash out the top of the pile with white/garbage by default. */}
      {settings.showPages && isEligibleForIframe && sheet.url ? (
        <iframe
          src={sheet.url}
          sandbox="allow-same-origin allow-scripts"
          loading="lazy"
          tabIndex={-1}
          style={{
            border: "none",
            width: `${RENDER_WIDTH}px`,
            height: `${Math.round(pageHeight)}px`,
            transform: `scale(${scale}) translateY(-${Math.round(translateY)}px)`,
            transformOrigin: "top left",
            pointerEvents: "none",
          }}
        />
      ) : null}
    </div>
  );
}
