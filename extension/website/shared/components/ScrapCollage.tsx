// ABOUTME: Curates collected image scraps and arranges them in a deterministic scatter collage.
// ABOUTME: Shows source provenance on hover and links each surviving image to its page.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { hashString, seededRandom } from "../utils/styleUtils";
import {
  canonicalButtonKey,
  canonicalCursorKey,
  canonicalImageKey,
  canonicalSvgIconKey,
} from "../utils/scrapIdentity";

interface ScrapItemBase {
  id: string;
  key: string;
  pageTitle: string;
  faviconUrl?: string;
  domain: string;
  pageUrl: string;
  ts: number;
}

export type ScrapItem = ScrapItemBase &
  (
    | {
        kind: "image";
        src: string;
        alt?: string;
        naturalWidth: number;
        naturalHeight: number;
      }
    | {
        kind: "button";
        text: string;
        styles: Record<string, string>;
        innerSvg?: string;
      }
    | {
        kind: "svg-icon";
        markup: string;
        width: number;
        height: number;
      }
    | {
        kind: "cursor";
        url: string;
        hotspotX?: number;
        hotspotY?: number;
      }
  );

interface CurateScrapsOptions {
  perDomainCap?: number;
  targetCount?: number;
  seed: number;
}

interface ScrapCollageProps {
  items: ScrapItem[];
  seed: number;
  targetCount?: number;
  perDomainCap?: number;
  showKindFilter?: boolean;
}

interface ScrapLayout {
  item: ScrapItem;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  cardAbove: boolean;
  cardRightAligned: boolean;
}

const DEFAULT_PER_DOMAIN_CAP = 4;
const DEFAULT_TARGET_COUNT = 200;
const LONG_EDGE_BY_TIER = [96, 152, 208] as const;
const CURSOR_TILE_SIZE = 48;
const SCRAP_KIND_OPTIONS = [
  { kind: "image", label: "images" },
  { kind: "button", label: "buttons" },
  { kind: "svg-icon", label: "icons" },
  { kind: "cursor", label: "cursors" },
] as const;

type ScrapKind = ScrapItem["kind"];
type ScrapKindFilter = "all" | ScrapKind;

function naturalArea(item: ScrapItem): number {
  switch (item.kind) {
    case "image":
      return item.naturalWidth * item.naturalHeight;
    case "button":
      return estimateButtonWidth(item.text) * 40;
    case "svg-icon":
      return item.width * item.height;
    case "cursor":
      return CURSOR_TILE_SIZE * CURSOR_TILE_SIZE;
  }
}

function itemOrder(item: ScrapItem, seed: number): number {
  return seededRandom(seed + hashString(item.key));
}

/**
 * Canonical identity for near-duplicate detection: two scraps with the same
 * canonical key are treated as the same underlying thing even if their raw
 * `key` differs (different computed style values, different rendered size,
 * different CDN query params). Used only for the dedup/count steps in
 * curateScraps -- `item.key` remains the identity used for layout seeding,
 * React keys, and per-item jitter so surviving tiles keep stable placement.
 */
export function canonicalScrapKey(item: ScrapItem): string {
  switch (item.kind) {
    case "image":
      return canonicalImageKey(item.src);
    case "button":
      return canonicalButtonKey(item.domain, item.text, item.styles.backgroundColor);
    case "svg-icon":
      return canonicalSvgIconKey(item.domain, item.markup);
    case "cursor":
      return canonicalCursorKey(item.url);
  }
}

function compareDomainScraps(a: ScrapItem, b: ScrapItem, seed: number): number {
  const areaDifference = naturalArea(b) - naturalArea(a);
  if (areaDifference !== 0) return areaDifference;

  const recencyDifference = b.ts - a.ts;
  if (recencyDifference !== 0) return recencyDifference;

  const seededDifference = itemOrder(a, seed) - itemOrder(b, seed);
  if (seededDifference !== 0) return seededDifference;

  return a.key.localeCompare(b.key);
}

export function curateScraps(
  items: ScrapItem[],
  opts: CurateScrapsOptions,
): ScrapItem[] {
  const perDomainCap = Math.max(
    0,
    Math.floor(opts.perDomainCap ?? DEFAULT_PER_DOMAIN_CAP),
  );
  const targetCount = Math.max(
    0,
    Math.floor(opts.targetCount ?? DEFAULT_TARGET_COUNT),
  );
  if (perDomainCap === 0 || targetCount === 0) return [];

  const newestByCanonicalKey = new Map<string, ScrapItem>();
  for (const item of items) {
    const canonicalKey = canonicalScrapKey(item);
    const current = newestByCanonicalKey.get(canonicalKey);
    if (!current || item.ts > current.ts) {
      newestByCanonicalKey.set(canonicalKey, item);
    }
  }

  const scrapsByDomain = new Map<string, ScrapItem[]>();
  for (const item of newestByCanonicalKey.values()) {
    const domainScraps = scrapsByDomain.get(item.domain);
    if (domainScraps) {
      domainScraps.push(item);
    } else {
      scrapsByDomain.set(item.domain, [item]);
    }
  }

  const domains = Array.from(scrapsByDomain.entries())
    .map(([domain, domainScraps]) => ({
      domain,
      scraps: domainScraps
        .slice()
        .sort((a, b) => compareDomainScraps(a, b, opts.seed))
        .slice(0, perDomainCap),
    }))
    .sort((a, b) => {
      const seededDifference =
        itemOrder(a.scraps[0], opts.seed) - itemOrder(b.scraps[0], opts.seed);
      if (seededDifference !== 0) return seededDifference;
      return a.domain.localeCompare(b.domain);
    });

  const curated: ScrapItem[] = [];
  for (let domainIndex = 0; curated.length < targetCount; domainIndex += 1) {
    let addedScrap = false;
    for (const domain of domains) {
      const scrap = domain.scraps[domainIndex];
      if (!scrap) continue;
      curated.push(scrap);
      addedScrap = true;
      if (curated.length === targetCount) break;
    }
    if (!addedScrap) break;
  }

  return curated;
}

function placeholderColor(domain: string): string {
  const hue = hashString(domain) % 360;
  return `hsl(${hue}, 30%, 72%)`;
}

function formatCollectedDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(timestamp);
}

function clamp(minimum: number, maximum: number, value: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function estimateButtonWidth(text: string): number {
  return clamp(100, 240, 48 + text.trim().length * 8);
}

function imageSize(
  item: Extract<ScrapItem, { kind: "image" }>,
  tier: number,
  itemSeed: number,
): { width: number; height: number } {
  const longEdge =
    LONG_EDGE_BY_TIER[tier] * (0.92 + seededRandom(itemSeed, 1) * 0.16);
  const naturalLongEdge = Math.max(item.naturalWidth, item.naturalHeight);
  if (naturalLongEdge <= 0) return { width: 0, height: 0 };

  return {
    width: longEdge * (item.naturalWidth / naturalLongEdge),
    height: longEdge * (item.naturalHeight / naturalLongEdge),
  };
}

function svgIconSize(
  item: Extract<ScrapItem, { kind: "svg-icon" }>,
  itemSeed: number,
): { width: number; height: number } {
  if (item.width <= 0 || item.height <= 0) return { width: 0, height: 0 };

  const longEdge = 56 + seededRandom(itemSeed, 1) * 40;
  const aspect = item.width / item.height;
  if (aspect >= 1) {
    return {
      width: longEdge,
      height: longEdge / clamp(1, 2, aspect),
    };
  }

  return {
    width: longEdge * clamp(0.5, 1, aspect),
    height: longEdge,
  };
}

function itemSize(
  item: ScrapItem,
  tier: number,
  itemSeed: number,
): { width: number; height: number } {
  switch (item.kind) {
    case "image":
      return imageSize(item, tier, itemSeed);
    case "button":
      return { width: estimateButtonWidth(item.text), height: 40 };
    case "svg-icon":
      return svgIconSize(item, itemSeed);
    case "cursor":
      return { width: CURSOR_TILE_SIZE, height: CURSOR_TILE_SIZE };
  }
}

function tierBounds(items: ScrapItem[]): { lowerArea: number; upperArea: number } {
  const sortedAreas = items
    .filter(
      (item): item is Extract<ScrapItem, { kind: "image" }> =>
        item.kind === "image",
    )
    .map(naturalArea)
    .sort((a, b) => a - b);
  return {
    lowerArea: sortedAreas[Math.floor((sortedAreas.length - 1) / 3)],
    upperArea: sortedAreas[Math.floor(((sortedAreas.length - 1) * 2) / 3)],
  };
}

function tierForItem(
  item: ScrapItem,
  lowerArea: number,
  upperArea: number,
): number {
  const area = naturalArea(item);
  return item.kind !== "image" || area <= lowerArea
    ? 0
    : area <= upperArea
      ? 1
      : 2;
}

/**
 * Field height for "everything" mode: the container's fixed width is kept,
 * but there's no fixed height to fit into, so rows are derived from the tile
 * count instead of the field being clamped to the container. Column count
 * uses the same sqrt-of-area formula as the fit-to-container layout,
 * treating the container's own (measured) height as the reference aspect
 * ratio so column width stays visually consistent between the two modes.
 * Row height is the actual average tile height (via the same size-tier
 * logic buildLayout uses), not a placeholder square cell, so the estimate
 * tracks the real mix of image/button/icon/cursor tile sizes.
 */
function computeEverythingFieldHeight(
  items: ScrapItem[],
  width: number,
  referenceHeight: number,
  seed: number,
): number {
  if (items.length === 0 || width === 0 || referenceHeight === 0) return 0;

  const aspectRatio = width / referenceHeight;
  const columnCount = Math.max(
    1,
    Math.ceil(Math.sqrt(items.length * aspectRatio)),
  );
  const rowCount = Math.ceil(items.length / columnCount);

  const { lowerArea, upperArea } = tierBounds(items);
  const averageCellHeight =
    items.reduce((sum, item) => {
      const tier = tierForItem(item, lowerArea, upperArea);
      const itemSeed = seed + hashString(item.key);
      return sum + itemSize(item, tier, itemSeed).height;
    }, 0) / items.length;

  return rowCount * averageCellHeight;
}

function buildLayout(
  items: ScrapItem[],
  width: number,
  height: number,
  seed: number,
): ScrapLayout[] {
  if (items.length === 0 || width === 0 || height === 0) return [];

  const { lowerArea, upperArea } = tierBounds(items);
  const aspectRatio = width / height;
  const columnCount = Math.max(
    1,
    Math.ceil(Math.sqrt(items.length * aspectRatio)),
  );
  const rowCount = Math.ceil(items.length / columnCount);
  const cellWidth = width / columnCount;
  const cellHeight = height / rowCount;

  return items.map((item, index) => {
    const tier = tierForItem(item, lowerArea, upperArea);
    const itemSeed = seed + hashString(item.key);
    const itemDimensions = itemSize(item, tier, itemSeed);
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    const jitterX = (seededRandom(itemSeed, 2) - 0.5) * cellWidth * 0.6;
    const jitterY = (seededRandom(itemSeed, 3) - 0.5) * cellHeight * 0.6;
    const unclampedX =
      (column + 0.5) * cellWidth + jitterX - itemDimensions.width / 2;
    const unclampedY =
      (row + 0.5) * cellHeight + jitterY - itemDimensions.height / 2;
    const x = Math.max(
      4,
      Math.min(width - itemDimensions.width - 4, unclampedX),
    );
    const y = Math.max(
      4,
      Math.min(height - itemDimensions.height - 4, unclampedY),
    );

    return {
      item,
      x,
      y,
      width: itemDimensions.width,
      height: itemDimensions.height,
      rotation: seededRandom(itemSeed, 4) * 12 - 6,
      zIndex: Math.floor(seededRandom(itemSeed, 5) * 80) + 1,
      cardAbove: y > height * 0.58,
      cardRightAligned: x > width * 0.68,
    };
  });
}

const COLLAGE_STYLES = `
  .scrap-collage__filters {
    position: absolute;
    top: 12px;
    left: 50%;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    max-width: calc(100% - 24px);
    pointer-events: auto;
    transform: translateX(-50%);
  }

  .scrap-collage__filter {
    appearance: none;
    padding: 4px 10px;
    border: 1px solid rgba(61, 56, 51, 0.18);
    border-radius: 999px;
    background: #f5f0e8;
    color: #3d3833;
    cursor: pointer;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    line-height: 1.4;
    white-space: nowrap;
    transition:
      transform 140ms ease,
      box-shadow 140ms ease,
      border-color 140ms ease,
      background-color 140ms ease,
      color 140ms ease;
  }

  .scrap-collage__filter-count {
    color: #8a8279;
  }

  .scrap-collage__filter[aria-pressed="true"] {
    border-color: #4a9a8a;
    background: rgba(74, 154, 138, 0.1);
    color: #4a9a8a;
  }

  .scrap-collage__filter[aria-pressed="true"] .scrap-collage__filter-count {
    color: #4a9a8a;
  }

  .scrap-collage__filter:hover,
  .scrap-collage__filter:focus-visible {
    border-color: #4a9a8a;
    box-shadow: 0 5px 10px rgba(61, 56, 51, 0.14);
    transform: translateY(-2px);
  }

  .scrap-collage__filter:focus-visible {
    outline: 2px solid rgba(74, 154, 138, 0.45);
    outline-offset: 2px;
  }

  .scrap-collage__filter--everything[aria-pressed="true"] {
    border-color: #c4724e;
    background: rgba(196, 114, 78, 0.1);
    color: #c4724e;
  }

  .scrap-collage__filter--everything[aria-pressed="true"] .scrap-collage__filter-count {
    color: #c4724e;
  }

  .scrap-collage__filter--everything:hover,
  .scrap-collage__filter--everything:focus-visible {
    border-color: #c4724e;
  }

  .scrap-collage__filter--everything:focus-visible {
    outline-color: rgba(196, 114, 78, 0.45);
  }

  .scrap-collage__scroll {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    overflow-x: hidden;
    height: 100%;
  }

  .scrap-collage__field {
    position: relative;
    width: 100%;
  }

  .scrap-collage__tile {
    position: absolute;
    display: block;
    color: inherit;
    text-decoration: none;
    transform: rotate(var(--scrap-rotation));
    transform-origin: center;
    transition: transform 160ms ease, filter 160ms ease;
  }

  .scrap-collage__tile:hover,
  .scrap-collage__tile:focus-visible {
    z-index: 200 !important;
    transform: rotate(var(--scrap-rotation)) scale(1.06) translateY(-4px);
    filter: drop-shadow(0 12px 12px rgba(61, 56, 51, 0.2));
    outline: none;
  }

  .scrap-collage__image {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }

  .scrap-collage__button {
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .scrap-collage__button-icon {
    display: inline-flex;
    width: 1em;
    height: 1em;
    flex: 0 0 auto;
    margin-right: 0.45em;
    pointer-events: none;
  }

  .scrap-collage__button-icon > svg {
    width: 100%;
    height: 100%;
    display: block;
  }

  .scrap-collage__svg {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .scrap-collage__svg > svg {
    max-width: 100%;
    max-height: 100%;
    display: block;
  }

  .scrap-collage__cursor {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 32px;
    height: 32px;
    display: block;
    object-fit: contain;
    image-rendering: pixelated;
    pointer-events: none;
    transform: translate(-50%, -50%);
  }

  .scrap-collage__provenance {
    position: absolute;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: max-content;
    max-width: 240px;
    padding: 9px 10px;
    border: 1px solid rgba(61, 56, 51, 0.18);
    border-radius: 3px;
    background: rgba(250, 249, 246, 0.96);
    box-shadow: 0 6px 18px rgba(61, 56, 51, 0.14);
    color: #3d3833;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    line-height: 1.45;
    opacity: 0;
    pointer-events: none;
    transform: translateY(3px);
    transition: opacity 120ms ease, transform 120ms ease;
  }

  .scrap-collage__tile:hover .scrap-collage__provenance,
  .scrap-collage__tile:focus-visible .scrap-collage__provenance {
    opacity: 1;
    transform: translateY(0);
  }

  .scrap-collage__favicon {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    border-radius: 3px;
    object-fit: cover;
  }

  .scrap-collage__details {
    display: block;
    min-width: 0;
  }

  .scrap-collage__title {
    display: block;
    max-width: 196px;
    overflow: hidden;
    color: #3d3833;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scrap-collage__metadata {
    display: block;
    margin-top: 2px;
    color: #827a72;
  }
`;

function scrapTitle(item: ScrapItem): string {
  if (item.pageTitle.trim()) return item.pageTitle;

  switch (item.kind) {
    case "image":
      return item.alt?.trim() || "image";
    case "button":
      return item.text.trim() || "button";
    case "svg-icon":
      return "icon";
    case "cursor":
      return "cursor";
  }
}

function isRenderableScrap(item: ScrapItem): boolean {
  switch (item.kind) {
    case "image":
      return (
        item.src.trim().length > 0 &&
        item.naturalWidth > 0 &&
        item.naturalHeight > 0
      );
    case "button":
      return Boolean(item.text.trim() || item.innerSvg?.trim());
    case "svg-icon":
      return Boolean(item.markup.trim() && item.width > 0 && item.height > 0);
    case "cursor":
      return item.url.trim().length > 0;
  }
}

interface ScrapContentProps {
  item: ScrapItem;
  onError: () => void;
}

function ScrapContent({ item, onError }: ScrapContentProps) {
  switch (item.kind) {
    case "image":
      return (
        <img
          className="scrap-collage__image"
          src={item.src}
          alt={item.alt ?? ""}
          loading="lazy"
          draggable={false}
          onError={onError}
        />
      );
    case "button":
      return (
        <span
          className="scrap-collage__button"
          style={{
            ...(item.styles as React.CSSProperties),
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            whiteSpace: "nowrap",
          }}
        >
          {item.innerSvg && (
            <span
              className="scrap-collage__button-icon"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: item.innerSvg }}
            />
          )}
          {item.text}
        </span>
      );
    case "svg-icon":
      return (
        <div
          className="scrap-collage__svg"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: item.markup }}
        />
      );
    case "cursor":
      return (
        <img
          className="scrap-collage__cursor"
          src={item.url}
          alt=""
          loading="lazy"
          draggable={false}
          onError={onError}
        />
      );
  }
}

export function ScrapCollage({
  items,
  seed,
  targetCount,
  perDomainCap,
  showKindFilter = false,
}: ScrapCollageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [selectedKind, setSelectedKind] =
    useState<ScrapKindFilter>("all");
  const [everythingMode, setEverythingMode] = useState(false);
  const [failedScraps, setFailedScraps] = useState<Set<string>>(
    () => new Set(),
  );
  const [failedFavicons, setFailedFavicons] = useState<Set<string>>(
    () => new Set(),
  );

  const kindCounts = useMemo(() => {
    const counts: Record<ScrapKind, number> = {
      image: 0,
      button: 0,
      "svg-icon": 0,
      cursor: 0,
    };
    const seenCanonicalKeys = new Set<string>();
    for (const item of items) {
      const canonicalKey = canonicalScrapKey(item);
      if (seenCanonicalKeys.has(canonicalKey)) continue;
      seenCanonicalKeys.add(canonicalKey);
      counts[item.kind] += 1;
    }
    return counts;
  }, [items]);
  const filteredItems = useMemo(
    () =>
      selectedKind === "all"
        ? items
        : items.filter((item) => item.kind === selectedKind),
    [items, selectedKind],
  );
  const everythingScraps = useMemo(
    () =>
      curateScraps(filteredItems, {
        seed,
        perDomainCap: Infinity,
        targetCount: Infinity,
      }),
    [filteredItems, seed],
  );
  const curated = useMemo(
    () =>
      everythingMode
        ? everythingScraps
        : curateScraps(filteredItems, { seed, targetCount, perDomainCap }),
    [everythingMode, everythingScraps, filteredItems, perDomainCap, seed, targetCount],
  );
  const fieldHeight = useMemo(
    () =>
      everythingMode
        ? Math.max(
            containerSize.height,
            computeEverythingFieldHeight(
              curated,
              containerSize.width,
              containerSize.height,
              seed,
            ),
          )
        : containerSize.height,
    [containerSize.height, containerSize.width, curated, everythingMode, seed],
  );
  const layout = useMemo(
    () => buildLayout(curated, containerSize.width, fieldHeight, seed),
    [containerSize.width, curated, fieldHeight, seed],
  );

  useEffect(() => {
    if (selectedKind !== "all" && kindCounts[selectedKind] === 0) {
      setSelectedKind("all");
    }
  }, [kindCounts, selectedKind]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateSize = () => {
      const bounds = container.getBoundingClientRect();
      setContainerSize({ width: bounds.width, height: bounds.height });
    };
    updateSize();

    const observer = new ResizeObserver(updateSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const removeScrap = (key: string) => {
    setFailedScraps((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  };

  const markFaviconFailed = (domain: string) => {
    setFailedFavicons((current) => {
      if (current.has(domain)) return current;
      const next = new Set(current);
      next.add(domain);
      return next;
    });
  };

  const tiles = layout.map((scrap) => {
    if (failedScraps.has(scrap.item.key) || !isRenderableScrap(scrap.item)) {
      return null;
    }

    const faviconFailed = failedFavicons.has(scrap.item.domain);
    const faviconSrc =
      scrap.item.faviconUrl ||
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(scrap.item.domain)}&sz=32`;
    const tileStyle = {
      left: scrap.x,
      top: scrap.y,
      width: scrap.width,
      height: scrap.height,
      zIndex: scrap.zIndex,
      "--scrap-rotation": `${scrap.rotation}deg`,
    } as React.CSSProperties & { "--scrap-rotation": string };
    const title = scrapTitle(scrap.item);

    return (
      <a
        key={scrap.item.key}
        className="scrap-collage__tile"
        href={scrap.item.pageUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open source page for ${title}`}
        style={tileStyle}
      >
        <ScrapContent
          item={scrap.item}
          onError={() => removeScrap(scrap.item.key)}
        />
        <div
          className="scrap-collage__provenance"
          style={{
            ...(scrap.cardAbove
              ? { bottom: "calc(100% + 10px)" }
              : { top: "calc(100% + 10px)" }),
            ...(scrap.cardRightAligned ? { right: 0 } : { left: 0 }),
          }}
        >
          {faviconFailed ? (
            <span
              className="scrap-collage__favicon"
              style={{
                backgroundColor: placeholderColor(scrap.item.domain),
              }}
            />
          ) : (
            <img
              className="scrap-collage__favicon"
              src={faviconSrc}
              alt=""
              onError={() => markFaviconFailed(scrap.item.domain)}
            />
          )}
          <span className="scrap-collage__details">
            <span className="scrap-collage__title">{title}</span>
            <span className="scrap-collage__metadata">
              {scrap.item.kind} · {scrap.item.domain}
              <br />
              collected {formatCollectedDate(scrap.item.ts)}
            </span>
          </span>
        </div>
      </a>
    );
  });

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <style>{COLLAGE_STYLES}</style>
      {showKindFilter && (
        <div className="scrap-collage__filters" aria-label="Filter scraps">
          <button
            type="button"
            className="scrap-collage__filter"
            aria-pressed={selectedKind === "all"}
            onClick={() => setSelectedKind("all")}
          >
            all{" "}
            <span className="scrap-collage__filter-count">{items.length}</span>
          </button>
          {SCRAP_KIND_OPTIONS.map(({ kind, label }) =>
            kindCounts[kind] > 0 ? (
              <button
                key={kind}
                type="button"
                className="scrap-collage__filter"
                aria-pressed={selectedKind === kind}
                onClick={() => setSelectedKind(kind)}
              >
                {label}{" "}
                <span className="scrap-collage__filter-count">
                  {kindCounts[kind]}
                </span>
              </button>
            ) : null,
          )}
          <button
            type="button"
            className="scrap-collage__filter scrap-collage__filter--everything"
            aria-pressed={everythingMode}
            onClick={() => setEverythingMode((current) => !current)}
          >
            everything{" "}
            <span className="scrap-collage__filter-count">
              {everythingScraps.length}
            </span>
          </button>
        </div>
      )}
      {everythingMode ? (
        <div className="scrap-collage__scroll">
          <div
            className="scrap-collage__field"
            style={{ height: fieldHeight }}
          >
            {tiles}
          </div>
        </div>
      ) : (
        tiles
      )}
    </div>
  );
}
