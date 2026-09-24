// ABOUTME: Examine view that lifts a clicked scrap out of the collage into a centered detail view.
// ABOUTME: Shows a specimen-label side panel of provenance and supports arrow navigation between scraps.

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { headingDisplayFontSize, type ScrapItem } from "./ScrapCollage";
import { useScrapImageSrc } from "../utils/scrapImageSource";

/** Fraction of the viewport's smaller dimension the lifted scrap fills. */
const LIFTED_VIEWPORT_FRACTION = 0.55;
const LIFT_DURATION_MS = 420;
const SETTLE_ROTATION_RANGE_DEG = 2;
/**
 * Buttons are captured at their on-page size, which is tiny next to a lifted
 * image. Scaling the whole button (rather than stretching its box) enlarges it
 * for examination while keeping its radius, padding, and shadow in proportion.
 */
const BUTTON_LIFT_SCALE = 3;

/**
 * Headings are likewise captured at page size and enlarged for examination,
 * by less than a button because their wording is already much wider.
 */
const HEADING_LIFT_SCALE = 1.5;

/** Elements Tab may reach while the examine dialog holds focus. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Geometry of the collage tile a lightbox was opened from, for the FLIP transform. */
export interface ScrapOrigin {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
}

export interface ProvenanceRow {
  label: string;
  value: string;
}

function formatDimensions(width: number, height: number): string {
  return `${Math.round(width)} x ${Math.round(height)}`;
}

/**
 * Kind-specific provenance rows for the panel. Rows whose value is absent are
 * omitted entirely rather than rendered blank, so the label reads as an
 * inventory of what was actually captured.
 */
export function kindDetailRows(item: ScrapItem): ProvenanceRow[] {
  switch (item.kind) {
    case "image": {
      const rows: ProvenanceRow[] = [
        {
          label: "dimensions",
          value: formatDimensions(item.naturalWidth, item.naturalHeight),
        },
      ];
      const alt = item.alt?.trim();
      if (alt) rows.push({ label: "alt text", value: alt });
      return rows;
    }
    case "button": {
      const text = item.text.trim();
      return text ? [{ label: "label", value: text }] : [];
    }
    case "svg-icon":
      return [
        {
          label: "dimensions",
          value: formatDimensions(item.width, item.height),
        },
      ];
    case "heading": {
      const rows: ProvenanceRow[] = [{ label: "level", value: `h${item.level}` }];
      const text = item.text.trim();
      if (text) rows.push({ label: "text", value: text });
      return rows;
    }
    case "cursor": {
      const rows: ProvenanceRow[] = [];
      if (item.hotspotX !== undefined && item.hotspotY !== undefined) {
        rows.push({
          label: "hotspot",
          value: `${Math.round(item.hotspotX)}, ${Math.round(item.hotspotY)}`,
        });
      }
      return rows;
    }
  }
}

/** Human-formatted collection moment, e.g. "Mar 14, 2026 · 4:07 PM". */
export function formatCollectedMoment(timestamp: number): string {
  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(timestamp);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
  return `${date} · ${time}`;
}

/**
 * Size the lifted scrap so its long edge fills LIFTED_VIEWPORT_FRACTION of the
 * viewport's smaller dimension, keeping the scrap's own aspect ratio. Falls
 * back to a square when the origin has no measurable size.
 */
export function liftedSize(
  origin: { width: number; height: number },
  viewport: { width: number; height: number },
): { width: number; height: number } {
  const target =
    Math.min(viewport.width, viewport.height) * LIFTED_VIEWPORT_FRACTION;
  if (origin.width <= 0 || origin.height <= 0) {
    return { width: target, height: target };
  }
  const aspect = origin.width / origin.height;
  return aspect >= 1
    ? { width: target, height: target / aspect }
    : { width: target * aspect, height: target };
}

/**
 * Settled resting angle for a lifted scrap: a deterministic tilt within
 * ±SETTLE_ROTATION_RANGE_DEG so the scrap keeps a hand-placed feel instead of
 * snapping perfectly square, and so re-opening the same scrap looks the same.
 */
export function settledRotation(collageRotation: number): number {
  const clamped = Math.max(
    -SETTLE_ROTATION_RANGE_DEG,
    Math.min(SETTLE_ROTATION_RANGE_DEG, collageRotation),
  );
  return Math.round(clamped * 100) / 100;
}

/**
 * FLIP transform that collapses the lifted scrap back onto its collage tile.
 * `restingCenter` is where the lifted scrap sits when untransformed; the
 * transform translates that centre onto the tile's centre and scales the lifted
 * box down to the tile's box, so releasing it animates the pick-up and
 * re-applying it animates the put-down.
 */
export function collapseTransform(
  origin: ScrapOrigin,
  size: { width: number; height: number },
  restingCenter: { x: number; y: number },
): string {
  const scaleX = size.width > 0 ? origin.width / size.width : 1;
  const scaleY = size.height > 0 ? origin.height / size.height : 1;
  const translateX = origin.left + origin.width / 2 - restingCenter.x;
  const translateY = origin.top + origin.height / 2 - restingCenter.y;
  return `translate(${Math.round(translateX)}px, ${Math.round(
    translateY,
  )}px) scale(${scaleX.toFixed(4)}, ${scaleY.toFixed(4)}) rotate(${origin.rotation}deg)`;
}

const LIGHTBOX_STYLES = `
  .scrap-lightbox {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
    background: rgba(250, 247, 242, 0.88);
    backdrop-filter: blur(6px);
    opacity: 0;
    transition: opacity 240ms ease;
  }

  .scrap-lightbox--visible {
    opacity: 1;
  }

  .scrap-lightbox::before {
    position: absolute;
    inset: 0 0 auto;
    z-index: 1;
    height: 68px;
    border-bottom: 1px solid rgba(61, 56, 51, 0.08);
    background: #faf7f2;
    content: "";
  }

  .scrap-lightbox__layout {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 40px;
    width: 100%;
    max-width: 1180px;
    max-height: 100%;
  }

  .scrap-lightbox__stage {
    position: relative;
    display: flex;
    flex: 0 1 auto;
    align-items: center;
    justify-content: center;
  }

  .scrap-lightbox__scrap {
    position: relative;
    display: block;
    transform-origin: center;
    filter: drop-shadow(0 26px 40px rgba(61, 56, 51, 0.28));
    transition:
      transform ${LIFT_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
      filter ${LIFT_DURATION_MS}ms ease;
  }

  .scrap-lightbox__scrap-media {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .scrap-lightbox__scrap-media > svg,
  .scrap-lightbox__scrap-media > img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }

  .scrap-lightbox__panel {
    box-sizing: border-box;
    flex: 0 0 300px;
    max-width: 300px;
    max-height: 100%;
    overflow-y: auto;
    padding: 20px;
    border: 1px solid rgba(61, 56, 51, 0.2);
    border-radius: 4px;
    background: #f5f0e8;
    box-shadow: 0 14px 34px rgba(61, 56, 51, 0.16);
    color: #3d3833;
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
    font-size: 13px;
    line-height: 1.55;
  }

  .scrap-lightbox__chip {
    display: inline-block;
    padding: 3px 8px;
    border: 1px solid rgba(74, 154, 138, 0.5);
    border-radius: 999px;
    background: rgba(74, 154, 138, 0.1);
    color: #4a9a8a;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .scrap-lightbox__heading {
    margin: 14px 0 0;
    font-family: Lora, Georgia, serif;
    font-size: 17px;
    font-weight: 600;
    line-height: 1.3;
  }

  .scrap-lightbox__source {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
  }

  .scrap-lightbox__favicon {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    border-radius: 3px;
    object-fit: cover;
  }

  .scrap-lightbox__domain {
    overflow: hidden;
    color: #3d3833;
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scrap-lightbox__places {
    margin-top: 16px;
    font: 10px/1.6 "Martian Mono", monospace;
    overflow-wrap: anywhere;
  }
  .scrap-lightbox__places h3 { font: inherit; margin: 0; }
  .scrap-lightbox__places p { color: #827a72; font-size: 9px; margin: 4px 0 8px; }
  .scrap-lightbox__timeline {
    max-height: 220px;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
    border-top: 1px solid rgba(61, 56, 51, 0.14);
  }
  .scrap-lightbox__timeline ol { list-style: none; padding: 0; margin: 0; }
  .scrap-lightbox__timeline li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 10px;
    padding: 8px 0;
  }
  .scrap-lightbox__timeline li + li { border-top: 1px solid rgba(61, 56, 51, 0.08); }
  .scrap-lightbox__timeline h4 { margin: 0; padding: 10px 0 4px; font: inherit; color: #827a72; }
  .scrap-lightbox__timeline time { color: #827a72; font-size: 9px; white-space: nowrap; padding-top: 1px; }
  .scrap-lightbox__timeline a { color: #3d3833; min-width: 0; text-decoration: none; }
  .scrap-lightbox__timeline a:hover { text-decoration: underline; }
  .scrap-lightbox__encounter-url { display: none !important; }
  .scrap-lightbox__timeline a:focus .scrap-lightbox__encounter-url { display: block !important; }
  .scrap-lightbox__timeline strong { display: block; font-weight: 500; }
  .scrap-lightbox__timeline span { display: block; color: #827a72; font-size: 9px; overflow-wrap: anywhere; }
  .scrap-lightbox__timeline:focus-visible { outline: 2px solid #5b8db8; outline-offset: 2px; }

  .scrap-lightbox__rows {
    margin: 16px 0 0;
    padding-top: 14px;
    border-top: 1px solid rgba(61, 56, 51, 0.14);
  }

  .scrap-lightbox__row {
    display: flex;
    gap: 10px;
    margin-top: 8px;
  }

  .scrap-lightbox__row:first-child {
    margin-top: 0;
  }

  .scrap-lightbox__row-label {
    flex: 0 0 84px;
    color: #8a8279;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .scrap-lightbox__row-value {
    flex: 1 1 auto;
    min-width: 0;
    color: #3d3833;
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    overflow-wrap: anywhere;
  }

  .scrap-lightbox__row-value a {
    color: #5b8db8;
  }

  /* A long URL stays on one line and truncates; the link still carries it whole. */
  .scrap-lightbox__row-value--url a {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scrap-lightbox__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid rgba(61, 56, 51, 0.14);
  }

  .scrap-lightbox__action {
    display: inline-flex;
    align-items: center;
    padding: 7px 14px;
    border: 1px solid #4a9a8a;
    border-radius: 3px;
    background: #4a9a8a;
    color: #faf7f2;
    font-family: "Martian Mono", monospace;
    font-size: 10px;
    text-decoration: none;
    transition: background-color 140ms ease, box-shadow 140ms ease;
  }

  .scrap-lightbox__action:hover,
  .scrap-lightbox__action:focus-visible {
    background: #3d8375;
    box-shadow: 0 5px 12px rgba(61, 56, 51, 0.18);
  }

  .scrap-lightbox__close {
    position: absolute;
    top: 16px;
    right: 20px;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid rgba(61, 56, 51, 0.2);
    border-radius: 50%;
    z-index: 3;
    background: #faf7f2;
    box-shadow: 0 3px 10px rgba(61, 56, 51, 0.12);
    color: #3d3833;
    cursor: pointer;
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
    font-size: 17px;
    line-height: 1;
  }

  .scrap-lightbox__close:hover,
  .scrap-lightbox__close:focus-visible {
    border-color: #c4724e;
    color: #c4724e;
  }

  .scrap-lightbox__step {
    position: absolute;
    z-index: 3;
    top: 50%;
    width: 34px;
    height: 34px;
    padding: 0;
    border: 1px solid rgba(61, 56, 51, 0.16);
    border-radius: 50%;
    background: rgba(245, 240, 232, 0.9);
    color: #3d3833;
    cursor: pointer;
    font-family: "Atkinson Hyperlegible", system-ui, sans-serif;
    font-size: 15px;
    line-height: 1;
    transform: translateY(-50%);
  }

  .scrap-lightbox__step--previous {
    left: 14px;
  }

  .scrap-lightbox__step--next {
    right: 14px;
  }

  .scrap-lightbox__step:hover,
  .scrap-lightbox__step:focus-visible {
    border-color: #4a9a8a;
    color: #4a9a8a;
  }

  @media (max-width: 720px) {
    .scrap-lightbox__layout {
      flex-direction: column;
      gap: 20px;
      overflow-y: auto;
    }

    .scrap-lightbox__panel {
      flex: 1 1 auto;
      width: 100%;
      max-width: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scrap-lightbox__scrap {
      transition: none;
    }
  }
`;

interface ScrapLightboxProps {
  item: ScrapItem;
  origin: ScrapOrigin;
  faviconSrc: string;
  faviconAvailable: boolean;
  onFaviconError: () => void;
  placeholderColor: string;
  hasPrevious: boolean;
  hasNext: boolean;
  prefersReducedMotion: boolean;
  /**
   * The origin tile's geometry as it stands right now, for the put-down. The
   * tile may have moved (a resize relaid out the collage) or gone entirely
   * since the lift, in which case the mount-time `origin` is used.
   */
  currentOrigin?: () => ScrapOrigin | null;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
}

function ScrapMedia({ item }: { item: ScrapItem }) {
  const imageSrc = useScrapImageSrc(
    item.kind === "image" ? item.src : undefined,
  );
  switch (item.kind) {
    case "image":
      return (
        <div className="scrap-lightbox__scrap-media">
          <img src={imageSrc ?? undefined} alt={item.alt ?? ""} draggable={false} />
        </div>
      );
    case "button":
      return (
        <div
          className="scrap-lightbox__scrap-media"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...(item.backdropColor ? { background: item.backdropColor } : {}),
          }}
        >
          <span
            style={{
              ...(item.styles as React.CSSProperties),
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              whiteSpace: "nowrap",
              // The button is rendered at its captured size then scaled to
              // fill the lifted frame, so its own border radius, padding, and
              // shadow scale with it instead of stretching.
              transform: `scale(${BUTTON_LIFT_SCALE})`,
            }}
          >
            {item.innerSvg && (
              <span
                aria-hidden="true"
                style={{
                  display: "inline-flex",
                  width: "1em",
                  height: "1em",
                  marginRight: "0.45em",
                }}
                dangerouslySetInnerHTML={{ __html: item.innerSvg }}
              />
            )}
            {item.text}
          </span>
        </div>
      );
    case "svg-icon":
      return (
        <div
          className="scrap-lightbox__scrap-media"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: item.markup }}
        />
      );
    case "heading":
      return (
        <div
          className="scrap-lightbox__scrap-media"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "0 16px",
          }}
        >
          <span
            style={{
              ...(item.styles as React.CSSProperties),
              fontSize:
                headingDisplayFontSize(item.styles, item.text) *
                HEADING_LIFT_SCALE,
              lineHeight: 1.15,
              maxWidth: "100%",
              textAlign: "center",
              overflowWrap: "anywhere",
            }}
          >
            {item.text}
          </span>
        </div>
      );
    case "cursor":
      return (
        <div className="scrap-lightbox__scrap-media">
          <img
            src={item.url}
            alt=""
            draggable={false}
            style={{ imageRendering: "pixelated" }}
          />
        </div>
      );
  }
}

/**
 * The examine view. Mounts already positioned over the collage tile it was
 * opened from (via a FLIP transform derived from `origin`), then releases the
 * transform on the next frame so the scrap appears to be picked up. Closing
 * re-applies the transform so it settles back into the collage.
 */
export function ScrapLightbox({
  item,
  origin,
  faviconSrc,
  faviconAvailable,
  onFaviconError,
  placeholderColor,
  hasPrevious,
  hasNext,
  prefersReducedMotion,
  currentOrigin,
  onClose,
  onPrevious,
  onNext,
}: ScrapLightboxProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [lifted, setLifted] = useState(prefersReducedMotion);
  /**
   * Where the lifted scrap sits when untransformed. Measured from the stage,
   * whose box the (transform-free) scrap exactly fills, so the collapse
   * transform can be expressed relative to it.
   */
  const [restingCenter, setRestingCenter] = useState({ x: 0, y: 0 });
  const [viewport, setViewport] = useState(() => ({
    width: typeof window === "undefined" ? 1024 : window.innerWidth,
    height: typeof window === "undefined" ? 768 : window.innerHeight,
  }));

  /**
   * The tile geometry the scrap collapses back onto. Seeded from the tile it
   * was lifted from, and refreshed from the live tile when the scrap is put
   * back down, so a resize since the lift does not send it to a stale place.
   */
  const [collapseOrigin, setCollapseOrigin] = useState(origin);
  useEffect(() => setCollapseOrigin(origin), [origin]);

  const size = useMemo(() => liftedSize(origin, viewport), [origin, viewport]);
  const rotation = settledRotation(origin.rotation);

  useEffect(() => {
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The resting centre follows the stage, so it must be re-measured whenever the
  // lifted box changes size (including on resize).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const bounds = stage.getBoundingClientRect();
    setRestingCenter({
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    });
  }, [item.key, size.height, size.width]);

  // Start from the collage tile's exact box, then release on the next frame so
  // the browser animates the difference (FLIP). Keyed on the scrap alone: a
  // resize must not replay the pick-up from geometry that has since moved.
  useLayoutEffect(() => {
    if (prefersReducedMotion) return;
    setLifted(false);
    const frame = window.requestAnimationFrame(() => setLifted(true));
    return () => window.cancelAnimationFrame(frame);
  }, [item.key, prefersReducedMotion]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // Put the scrap back down before unmounting, so closing reads as the reverse
  // of the pick-up rather than a disappearance.
  const requestClose = () => {
    if (prefersReducedMotion) {
      onClose();
      return;
    }
    const live = currentOrigin?.();
    if (live) setCollapseOrigin(live);
    setLifted(false);
    window.setTimeout(onClose, LIFT_DURATION_MS);
  };
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const overlay = overlayRef.current;
        if (!overlay) return;
        const focusable = Array.from(
          overlay.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((element) => element.tabIndex !== -1);
        event.preventDefault();
        if (focusable.length === 0) {
          dialogRef.current?.focus();
          return;
        }
        const active = document.activeElement;
        const index = focusable.findIndex((element) => element === active);
        const step = event.shiftKey ? -1 : 1;
        const nextIndex =
          index === -1
            ? event.shiftKey
              ? focusable.length - 1
              : 0
            : (index + step + focusable.length) % focusable.length;
        focusable[nextIndex].focus();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        requestCloseRef.current();
        return;
      }
      if (event.key === "ArrowLeft" && hasPrevious) {
        event.preventDefault();
        onPrevious();
        return;
      }
      if (event.key === "ArrowRight" && hasNext) {
        event.preventDefault();
        onNext();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [hasNext, hasPrevious, onNext, onPrevious]);

  useEffect(() => {
    const body = document.body;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, []);

  const scrapStyle: React.CSSProperties = {
    width: size.width,
    height: size.height,
    transform: lifted
      ? `rotate(${rotation}deg)`
      : collapseTransform(collapseOrigin, size, restingCenter),
  };
  if (!lifted) {
    scrapStyle.filter = "drop-shadow(0 4px 6px rgba(61, 56, 51, 0.16))";
  }

  const title = item.pageTitle.trim();
  const rows: ProvenanceRow[] = [
    { label: "collected", value: formatCollectedMoment(item.ts) },
    ...kindDetailRows(item),
  ];

  const encounterDates = new Map<
    string,
    NonNullable<ScrapItem["sources"]>[number]["encounters"]
  >();
  for (const encounter of (item.sources ?? [])
    .flatMap((source) => source.encounters)
    .sort((a, b) => b.ts - a.ts)) {
    const date = new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(encounter.ts);
    const entries = encounterDates.get(date) ?? [];
    entries.push(encounter);
    encounterDates.set(date, entries);
  }

  return (
    <div
      ref={overlayRef}
      className={`scrap-lightbox${lifted ? " scrap-lightbox--visible" : ""}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <style>{LIGHTBOX_STYLES}</style>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Examine ${item.kind} from ${item.domain}`}
        tabIndex={-1}
        className="scrap-lightbox__layout"
        style={{ outline: "none" }}
      >
        <div ref={stageRef} className="scrap-lightbox__stage">
          <div className="scrap-lightbox__scrap" style={scrapStyle}>
            <ScrapMedia item={item} />
          </div>
        </div>
        <aside className="scrap-lightbox__panel">
          <span className="scrap-lightbox__chip">{item.kind}</span>
          {title && <h2 className="scrap-lightbox__heading">{title}</h2>}
          <div className="scrap-lightbox__source">
            {faviconAvailable ? (
              <img
                className="scrap-lightbox__favicon"
                src={faviconSrc}
                alt=""
                onError={onFaviconError}
              />
            ) : (
              <span
                className="scrap-lightbox__favicon"
                style={{ backgroundColor: placeholderColor }}
              />
            )}
            <span className="scrap-lightbox__domain">{item.domain}</span>
          </div>
          <div className="scrap-lightbox__rows">
            {rows.map((row) => (
              <div className="scrap-lightbox__row" key={row.label}>
                <span className="scrap-lightbox__row-label">{row.label}</span>
                <span className="scrap-lightbox__row-value">{row.value}</span>
              </div>
            ))}
            {item.pageUrl && (
              <div className="scrap-lightbox__row">
                <span className="scrap-lightbox__row-label">found at</span>
                <span className="scrap-lightbox__row-value scrap-lightbox__row-value--url">
                  <a
                    href={item.pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={item.pageUrl}
                  >
                    {item.pageUrl}
                  </a>
                </span>
              </div>
            )}
          </div>
          {item.kind === "image" && item.sources && item.sources.length > 0 && (
            <section
              className="scrap-lightbox__places"
              aria-label="Places this photo was found"
            >
              <h3>Encounter history</h3>
              <p>Newest first · one saved visit per place per day</p>
              <div
                className="scrap-lightbox__timeline"
                tabIndex={0}
                role="region"
                aria-label="Scrollable encounter history"
              >
                {[...encounterDates].map(([date, encounters]) => (
                  <section key={date} aria-label={date}>
                    <h4>{date}</h4>
                    <ol>
                      {encounters.map((encounter) => (
                        <li
                          key={JSON.stringify([
                            encounter.pageUrl,
                            encounter.day,
                          ])}
                        >
                          <a
                            href={encounter.pageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={encounter.pageUrl}
                          >
                            <strong>{encounter.domain}</strong>
                            <span>
                              {encounter.pageTitle.trim() ||
                                new URL(encounter.pageUrl).pathname}
                            </span>
                            <span className="scrap-lightbox__encounter-url">
                              {encounter.pageUrl}
                            </span>
                          </a>
                          <time dateTime={new Date(encounter.ts).toISOString()}>
                            {new Intl.DateTimeFormat("en-US", {
                              hour: "numeric",
                              minute: "2-digit",
                            }).format(encounter.ts)}
                          </time>
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
              </div>
            </section>
          )}
          {item.pageUrl && (
            <div className="scrap-lightbox__actions">
              <a
                className="scrap-lightbox__action"
                href={item.pageUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                visit page →
              </a>
            </div>
          )}
        </aside>
      </div>
      {hasPrevious && (
        <button
          type="button"
          className="scrap-lightbox__step scrap-lightbox__step--previous"
          aria-label="Previous scrap"
          onClick={onPrevious}
        >
          ←
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          className="scrap-lightbox__step scrap-lightbox__step--next"
          aria-label="Next scrap"
          onClick={onNext}
        >
          →
        </button>
      )}
      <button
        type="button"
        className="scrap-lightbox__close"
        aria-label="Close examine view"
        onClick={requestClose}
      >
        ×
      </button>
    </div>
  );
}
