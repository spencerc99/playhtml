// ABOUTME: Curates collected image scraps and arranges them in a deterministic scatter collage.
// ABOUTME: Shows source provenance on hover and links each surviving image to its page.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { hashString, seededRandom } from "../utils/styleUtils";

export interface ScrapItem {
  id: string;
  src: string;
  alt?: string;
  pageTitle: string;
  faviconUrl?: string;
  domain: string;
  pageUrl: string;
  ts: number;
  naturalWidth: number;
  naturalHeight: number;
}

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

function naturalArea(item: ScrapItem): number {
  return item.naturalWidth * item.naturalHeight;
}

function itemOrder(item: ScrapItem, seed: number): number {
  return seededRandom(seed + hashString(item.src));
}

function compareDomainScraps(
  a: ScrapItem,
  b: ScrapItem,
  seed: number,
): number {
  const areaDifference = naturalArea(b) - naturalArea(a);
  if (areaDifference !== 0) return areaDifference;

  const recencyDifference = b.ts - a.ts;
  if (recencyDifference !== 0) return recencyDifference;

  const seededDifference = itemOrder(a, seed) - itemOrder(b, seed);
  if (seededDifference !== 0) return seededDifference;

  return a.src.localeCompare(b.src);
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

  const newestBySrc = new Map<string, ScrapItem>();
  for (const item of items) {
    const current = newestBySrc.get(item.src);
    if (!current || item.ts > current.ts) {
      newestBySrc.set(item.src, item);
    }
  }

  const scrapsByDomain = new Map<string, ScrapItem[]>();
  for (const item of newestBySrc.values()) {
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

function buildLayout(
  items: ScrapItem[],
  width: number,
  height: number,
  seed: number,
): ScrapLayout[] {
  if (items.length === 0 || width === 0 || height === 0) return [];

  const sortedAreas = items.map(naturalArea).sort((a, b) => a - b);
  const lowerArea = sortedAreas[Math.floor((sortedAreas.length - 1) / 3)];
  const upperArea = sortedAreas[Math.floor(((sortedAreas.length - 1) * 2) / 3)];
  const aspectRatio = width / height;
  const columnCount = Math.max(
    1,
    Math.ceil(Math.sqrt(items.length * aspectRatio)),
  );
  const rowCount = Math.ceil(items.length / columnCount);
  const cellWidth = width / columnCount;
  const cellHeight = height / rowCount;

  return items.map((item, index) => {
    const area = naturalArea(item);
    const tier = area <= lowerArea ? 0 : area <= upperArea ? 1 : 2;
    const itemSeed = seed + hashString(item.src);
    const longEdge =
      LONG_EDGE_BY_TIER[tier] * (0.92 + seededRandom(itemSeed, 1) * 0.16);
    const naturalLongEdge = Math.max(item.naturalWidth, item.naturalHeight);
    const imageWidth = longEdge * (item.naturalWidth / naturalLongEdge);
    const imageHeight = longEdge * (item.naturalHeight / naturalLongEdge);
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    const jitterX = (seededRandom(itemSeed, 2) - 0.5) * cellWidth * 0.6;
    const jitterY = (seededRandom(itemSeed, 3) - 0.5) * cellHeight * 0.6;
    const unclampedX = (column + 0.5) * cellWidth + jitterX - imageWidth / 2;
    const unclampedY = (row + 0.5) * cellHeight + jitterY - imageHeight / 2;
    const x = Math.max(4, Math.min(width - imageWidth - 4, unclampedX));
    const y = Math.max(4, Math.min(height - imageHeight - 4, unclampedY));

    return {
      item,
      x,
      y,
      width: imageWidth,
      height: imageHeight,
      rotation: seededRandom(itemSeed, 4) * 12 - 6,
      zIndex: Math.floor(seededRandom(itemSeed, 5) * 80) + 1,
      cardAbove: y > height * 0.58,
      cardRightAligned: x > width * 0.68,
    };
  });
}

const COLLAGE_STYLES = `
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

export function ScrapCollage({
  items,
  seed,
  targetCount,
  perDomainCap,
}: ScrapCollageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [failedScraps, setFailedScraps] = useState<Set<string>>(
    () => new Set(),
  );
  const [failedFavicons, setFailedFavicons] = useState<Set<string>>(
    () => new Set(),
  );

  const curated = useMemo(
    () => curateScraps(items, { seed, targetCount, perDomainCap }),
    [items, perDomainCap, seed, targetCount],
  );
  const layout = useMemo(
    () =>
      buildLayout(
        curated,
        containerSize.width,
        containerSize.height,
        seed,
      ),
    [containerSize.height, containerSize.width, curated, seed],
  );

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

  const removeScrap = (src: string) => {
    setFailedScraps((current) => {
      if (current.has(src)) return current;
      const next = new Set(current);
      next.add(src);
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

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <style>{COLLAGE_STYLES}</style>
      {layout.map((scrap) => {
        if (failedScraps.has(scrap.item.src)) return null;

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

        return (
          <a
            key={scrap.item.src}
            className="scrap-collage__tile"
            href={scrap.item.pageUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open source page for ${scrap.item.pageTitle}`}
            style={tileStyle}
          >
            <img
              className="scrap-collage__image"
              src={scrap.item.src}
              alt={scrap.item.alt ?? ""}
              loading="lazy"
              draggable={false}
              onError={() => removeScrap(scrap.item.src)}
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
                <span className="scrap-collage__title">
                  {scrap.item.pageTitle}
                </span>
                <span className="scrap-collage__metadata">
                  {scrap.item.domain}
                  <br />
                  collected {formatCollectedDate(scrap.item.ts)}
                </span>
              </span>
            </div>
          </a>
        );
      })}
    </div>
  );
}
