// ABOUTME: Curates collected image scraps and arranges them in a deterministic scatter collage.
// ABOUTME: Shows source provenance on hover and links each surviving image to its page.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { hashString, seededRandom } from "../utils/styleUtils";
import { ScrapLightbox, type ScrapOrigin } from "./ScrapLightbox";
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

type VisibleScrapCount = "auto" | "everything" | 100 | 200 | 300 | 500;

interface ScrapLayout {
  item: ScrapItem;
  /** Position in the tide's slot array, so a departing scrap keeps its place. */
  slotIndex: number;
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
const SCRAPS_PER_VIEWPORT_AREA = 8_000;
const MIN_AUTO_TARGET_COUNT = 100;
const MAX_AUTO_TARGET_COUNT = 400;
const TIDE_WASH_OUT_MS = 1400;
/** Bounds of the jittered gap between tide events. */
const TIDE_GAP_MIN_MS = 1000;
const TIDE_GAP_MAX_MS = 7000;
/** Share of events that arrive as a wave rather than a single scrap. */
const TIDE_WAVE_CHANCE = 1 / 6;
const TIDE_WAVE_MIN_COUNT = 2;
const TIDE_WAVE_MAX_COUNT = 4;
/** Spacing between the individual wash-outs inside one wave. */
const TIDE_WAVE_STAGGER_MIN_MS = 100;
const TIDE_WAVE_STAGGER_MAX_MS = 300;
/**
 * How far below the target the ashore count is allowed to drift before the
 * tide starts insisting on wash-ins, and how far above it may sit at all.
 */
const TIDE_BAND_BELOW = 0.15;
const TIDE_BAND_ABOVE = 0.05;
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

export function responsiveTargetCount(width: number, height: number): number {
  if (width <= 0 || height <= 0) return DEFAULT_TARGET_COUNT;
  return clamp(
    MIN_AUTO_TARGET_COUNT,
    MAX_AUTO_TARGET_COUNT,
    Math.round((width * height) / SCRAPS_PER_VIEWPORT_AREA),
  );
}

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

/**
 * Rotating window over the curated pool. `ashore` is the slot array currently
 * rendered; a `null` slot is bare sand a scrap has washed off and nothing has
 * yet washed into, so departures never reflow the scraps around them.
 * `offshore` is the queue of keys waiting to wash in. Both hold `item.key`
 * rather than the items themselves so the state survives re-derivation of the
 * pool.
 */
export interface TideState {
  ashore: (string | null)[];
  offshore: string[];
}

/** A tide event: one scrap in, one scrap out, or a wave taking several out. */
export type TideEventKind = "in" | "out" | "wave";

export interface TideEvent {
  kind: TideEventKind;
  /** Scraps this event moves; always 1 for "in" and "out". */
  count: number;
  /** Jittered wait before the event fires. */
  delayMs: number;
  /** Gap between the individual wash-outs of a wave; 0 for single events. */
  staggerMs: number;
}

function tideAshoreCount(state: TideState): number {
  return state.ashore.reduce((count, key) => (key === null ? count : count + 1), 0);
}

function randomBetween(rand: () => number, minimum: number, maximum: number): number {
  return minimum + rand() * (maximum - minimum);
}

/**
 * Decides what the tide does next, given only the current state and a source of
 * randomness, so the rhythm is testable without timers. The ashore count is
 * allowed to breathe inside a band below the target: under the floor the tide
 * insists on bringing scraps back, at or above the target it can only shed, and
 * inside the band it goes either way. Waves only happen on the shedding side,
 * so a burst of departures is always followed by a slow, single-file refill.
 */
export function nextTideEvent(
  state: TideState,
  targetCount: number,
  rand: () => number,
): TideEvent {
  const ashoreCount = tideAshoreCount(state);
  const floor = Math.max(0, Math.floor(targetCount * (1 - TIDE_BAND_BELOW)));
  const ceiling = Math.max(1, Math.round(targetCount * (1 + TIDE_BAND_ABOVE)));
  const canWashIn = state.offshore.length > 0 && ashoreCount < ceiling;
  const canWashOut = ashoreCount > 0;

  const wantsWashIn = ashoreCount < floor
    ? true
    : ashoreCount >= targetCount
      ? false
      : rand() < 0.5;
  const kind: TideEventKind =
    wantsWashIn && canWashIn ? "in" : canWashOut ? "out" : "in";

  const delayMs = Math.round(
    randomBetween(rand, TIDE_GAP_MIN_MS, TIDE_GAP_MAX_MS),
  );

  if (kind === "out" && ashoreCount > TIDE_WAVE_MIN_COUNT && rand() < TIDE_WAVE_CHANCE) {
    const count = Math.min(
      ashoreCount,
      Math.floor(
        randomBetween(rand, TIDE_WAVE_MIN_COUNT, TIDE_WAVE_MAX_COUNT + 1),
      ),
    );
    return {
      kind: "wave",
      count,
      delayMs,
      staggerMs: Math.round(
        randomBetween(rand, TIDE_WAVE_STAGGER_MIN_MS, TIDE_WAVE_STAGGER_MAX_MS),
      ),
    };
  }

  return { kind, count: 1, delayMs, staggerMs: 0 };
}

/**
 * Re-derives the tide from a pool, preserving the current ashore/offshore
 * ordering for keys that are still present. Keys that disappeared from the pool
 * (filter change, failed load) drop out; new keys join the back of the offshore
 * queue. Bare slots are dropped so a re-derivation starts from a full shore.
 * Used both for the initial tide and whenever the pool changes.
 */
export function deriveTideState(
  poolKeys: string[],
  targetCount: number,
  previous?: TideState,
): TideState {
  const poolKeySet = new Set(poolKeys);
  const seen = new Set<string>();
  const ordered: string[] = [];

  if (previous) {
    for (const key of [...previous.ashore, ...previous.offshore]) {
      if (key === null || !poolKeySet.has(key) || seen.has(key)) continue;
      seen.add(key);
      ordered.push(key);
    }
  }
  for (const key of poolKeys) {
    if (seen.has(key)) continue;
    seen.add(key);
    ordered.push(key);
  }

  const ashoreCount = Math.min(Math.max(0, targetCount), ordered.length);
  return {
    ashore: ordered.slice(0, ashoreCount),
    offshore: ordered.slice(ashoreCount),
  };
}

/**
 * The scrap in `slotIndex` washes out: its slot goes bare and the key joins the
 * back of the offshore queue, so it takes its turn behind everything else
 * waiting. Returns the same state when the slot is already bare or invalid.
 */
export function washOutTide(state: TideState, slotIndex: number): TideState {
  if (slotIndex < 0 || slotIndex >= state.ashore.length) return state;
  const outgoing = state.ashore[slotIndex];
  if (outgoing === null) return state;

  const ashore = state.ashore.slice();
  ashore[slotIndex] = null;
  return { ashore, offshore: [...state.offshore, outgoing] };
}

/**
 * The head of the offshore queue washes into the given bare slot. When
 * `slotIndex` is omitted (or its slot is already occupied) the tide picks the
 * first bare slot, and with no bare slot at all the scrap takes a new slot at
 * the end of the shore. Returns the same state when nothing is offshore.
 */
export function washInTide(state: TideState, slotIndex?: number): TideState {
  if (state.offshore.length === 0) return state;

  const [incoming, ...restOffshore] = state.offshore;
  const ashore = state.ashore.slice();
  const target =
    slotIndex !== undefined &&
    slotIndex >= 0 &&
    slotIndex < ashore.length &&
    ashore[slotIndex] === null
      ? slotIndex
      : ashore.indexOf(null);

  if (target === -1) {
    ashore.push(incoming);
  } else {
    ashore[target] = incoming;
  }
  return { ashore, offshore: restOffshore };
}

/** Slot indices holding a scrap, for picking which one the tide takes next. */
export function occupiedTideSlots(state: TideState): number[] {
  const slots: number[] = [];
  state.ashore.forEach((key, index) => {
    if (key !== null) slots.push(index);
  });
  return slots;
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

/**
 * Lays out one scrap per slot. Slots are positional, so passing `null` for a
 * bare slot keeps every other scrap exactly where it was -- the grid is sized
 * from the slot count, not from how many slots currently hold a scrap, and bare
 * slots simply render nothing.
 */
function buildLayout(
  slots: (ScrapItem | null)[],
  width: number,
  height: number,
  seed: number,
): ScrapLayout[] {
  if (slots.length === 0 || width === 0 || height === 0) return [];

  const items = slots.filter((item): item is ScrapItem => item !== null);
  if (items.length === 0) return [];

  const { lowerArea, upperArea } = tierBounds(items);
  const aspectRatio = width / height;
  const columnCount = Math.max(
    1,
    Math.ceil(Math.sqrt(slots.length * aspectRatio)),
  );
  const rowCount = Math.ceil(slots.length / columnCount);
  const cellWidth = width / columnCount;
  const cellHeight = height / rowCount;

  return slots.flatMap((item, index) => {
    if (item === null) return [];
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

    return [
      {
        item,
        slotIndex: index,
        x,
        y,
        width: itemDimensions.width,
        height: itemDimensions.height,
        rotation: seededRandom(itemSeed, 4) * 12 - 6,
        zIndex: Math.floor(seededRandom(itemSeed, 5) * 80) + 1,
        cardAbove: y > height * 0.58,
        cardRightAligned: x > width * 0.68,
      },
    ];
  });
}

const COLLAGE_STYLES = `
  .scrap-collage__controls {
    position: absolute;
    bottom: 12px;
    left: 50%;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    box-sizing: border-box;
    max-width: calc(100% - 24px);
    padding: 7px;
    border: 1px solid rgba(61, 56, 51, 0.2);
    border-radius: 5px;
    background: #f5f0e8;
    box-shadow: 0 8px 24px rgba(61, 56, 51, 0.2);
    pointer-events: auto;
    transform: translateX(-50%);
  }

  .scrap-collage__controls--collapsed {
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .scrap-collage__control-group {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .scrap-collage__control-label {
    color: #827a72;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    letter-spacing: 0.03em;
  }

  .scrap-collage__select {
    appearance: none;
    min-width: 112px;
    padding: 4px 24px 4px 9px;
    border: 1px solid rgba(61, 56, 51, 0.18);
    border-radius: 3px;
    background-color: #faf9f6;
    background-image:
      linear-gradient(45deg, transparent 50%, #827a72 50%),
      linear-gradient(135deg, #827a72 50%, transparent 50%);
    background-position:
      calc(100% - 11px) 50%,
      calc(100% - 7px) 50%;
    background-repeat: no-repeat;
    background-size: 4px 4px, 4px 4px;
    color: #3d3833;
    cursor: pointer;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    line-height: 1.4;
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

  .scrap-collage__filter--collapse {
    min-width: 30px;
    padding-inline: 8px;
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

  .scrap-collage__select:focus-visible {
    border-color: #4a9a8a;
    outline: 2px solid rgba(74, 154, 138, 0.45);
    outline-offset: 2px;
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

  .scrap-collage__filter--tide[aria-pressed="true"] {
    border-color: #5b8db8;
    background: rgba(91, 141, 184, 0.1);
    color: #5b8db8;
  }

  .scrap-collage__filter--tide:hover,
  .scrap-collage__filter--tide:focus-visible {
    border-color: #5b8db8;
  }

  .scrap-collage__filter--tide:focus-visible {
    outline-color: rgba(91, 141, 184, 0.45);
  }

  .scrap-collage__scroll {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    overflow-x: hidden;
    height: 100%;
  }

  @media (max-width: 620px) {
    .scrap-collage__controls:not(.scrap-collage__controls--collapsed) {
      width: calc(100% - 24px);
      flex-wrap: wrap;
    }

    .scrap-collage__control-group {
      flex: 1 1 auto;
    }

    .scrap-collage__select {
      flex: 1 1 auto;
      min-width: 0;
    }
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

  .scrap-collage__swatch {
    position: absolute;
    inset: 0;
    display: block;
    pointer-events: none;
    transition: opacity 420ms ease;
  }

  .scrap-collage__swatch--settled {
    opacity: 0;
  }

  .scrap-collage__developing {
    filter: blur(10px) saturate(0.35);
    opacity: 0;
    transition:
      filter 760ms ease,
      opacity 760ms ease;
  }

  .scrap-collage__developing.scrap-collage__developed {
    filter: blur(0) saturate(1);
    opacity: 1;
  }

  .scrap-collage__tile--washing-in {
    animation: scrap-collage-wash-in 900ms ease forwards;
  }

  .scrap-collage__tile--washing-out {
    animation: scrap-collage-wash-out ${TIDE_WASH_OUT_MS}ms ease forwards;
    pointer-events: none;
  }

  @keyframes scrap-collage-wash-in {
    from {
      opacity: 0;
      transform: rotate(var(--scrap-rotation)) translateY(-18px);
    }
    to {
      opacity: 1;
      transform: rotate(var(--scrap-rotation)) translateY(0);
    }
  }

  @keyframes scrap-collage-wash-out {
    from {
      opacity: 1;
      transform: rotate(var(--scrap-rotation)) translateY(0);
    }
    to {
      opacity: 0;
      transform: rotate(var(--scrap-rotation)) translateY(30px);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .scrap-collage__swatch,
    .scrap-collage__developing {
      transition: none;
    }

    .scrap-collage__developing {
      filter: none;
      opacity: 1;
    }

    .scrap-collage__tile--washing-in,
    .scrap-collage__tile--washing-out {
      animation: none;
    }
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
  loaded: boolean;
  onError: () => void;
  onLoad: () => void;
}

/**
 * Tinted stand-in occupying the exact box the remote image will fill, so the
 * scrap holds its footprint from first paint and the image develops in over it
 * rather than popping into an empty slot.
 */
function ScrapSwatch({
  domain,
  loaded,
  style,
}: {
  domain: string;
  loaded: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`scrap-collage__swatch${loaded ? " scrap-collage__swatch--settled" : ""}`}
      aria-hidden="true"
      style={{ backgroundColor: placeholderColor(domain), ...style }}
    />
  );
}

function ScrapContent({ item, loaded, onError, onLoad }: ScrapContentProps) {
  switch (item.kind) {
    case "image":
      return (
        <>
          <ScrapSwatch domain={item.domain} loaded={loaded} />
          <img
            className={`scrap-collage__image scrap-collage__developing${
              loaded ? " scrap-collage__developed" : ""
            }`}
            src={item.src}
            alt={item.alt ?? ""}
            loading="lazy"
            draggable={false}
            onLoad={onLoad}
            onError={onError}
          />
        </>
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
        <>
          <ScrapSwatch
            domain={item.domain}
            loaded={loaded}
            style={{
              inset: "auto",
              left: "50%",
              top: "50%",
              width: 32,
              height: 32,
              transform: "translate(-50%, -50%)",
            }}
          />
          <img
            className={`scrap-collage__cursor scrap-collage__developing${
              loaded ? " scrap-collage__developed" : ""
            }`}
            src={item.url}
            alt=""
            loading="lazy"
            draggable={false}
            onLoad={onLoad}
            onError={onError}
          />
        </>
      );
  }
}

/**
 * A scrap that has left the tide but is still on screen for the duration of its
 * wash-out animation. It keeps the layout it had in its old slot so it drifts
 * away from where it sat rather than jumping.
 */
interface WashingOutScrap {
  layout: ScrapLayout;
  washOutId: number;
  /** When the wash-out animation began, so removal survives a paused tide. */
  startedAt: number;
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
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
  const [visibleScrapCount, setVisibleScrapCount] =
    useState<VisibleScrapCount>("auto");
  const [controlsExpanded, setControlsExpanded] = useState(true);
  const [shuffleIndex, setShuffleIndex] = useState(0);
  const [failedScraps, setFailedScraps] = useState<Set<string>>(
    () => new Set(),
  );
  const [failedFavicons, setFailedFavicons] = useState<Set<string>>(
    () => new Set(),
  );
  const [loadedScraps, setLoadedScraps] = useState<Set<string>>(
    () => new Set(),
  );
  const prefersReducedMotion = usePrefersReducedMotion();
  const [tidePaused, setTidePaused] = useState(prefersReducedMotion);
  const [tide, setTide] = useState<TideState | null>(null);
  const tideShuffleIndexRef = useRef(shuffleIndex);
  const tideRef = useRef(tide);
  tideRef.current = tide;
  const [washingOut, setWashingOut] = useState<WashingOutScrap[]>([]);
  const washOutIdRef = useRef(0);
  /**
   * The scrap being examined, plus the collage tile geometry it was lifted from
   * so the lightbox can animate out of and back into its slot.
   */
  const [examining, setExamining] = useState<{
    key: string;
    origin: ScrapOrigin;
  } | null>(null);
  // Tide state to restore when the examine view closes; the tide holds still
  // while a scrap is being looked at.
  const tidePausedBeforeExamineRef = useRef<boolean | null>(null);
  const examineTriggerRef = useRef<HTMLElement | null>(null);
  // Rendered tile elements by scrap key, so arrow-key navigation can re-anchor
  // the examine view on the next scrap's actual slot.
  const tileElementsRef = useRef(new Map<string, HTMLElement>());
  const everythingMode = visibleScrapCount === "everything";
  const layoutSeed = seed + shuffleIndex * 10_007;
  const selectedTargetCount =
    targetCount ??
    (visibleScrapCount === "auto" || visibleScrapCount === "everything"
      ? responsiveTargetCount(containerSize.width, containerSize.height)
      : visibleScrapCount);

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
  const totalScrapCount = Object.values(kindCounts).reduce(
    (total, count) => total + count,
    0,
  );
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
        seed: layoutSeed,
        perDomainCap: Infinity,
        targetCount: Infinity,
      }),
    [filteredItems, layoutSeed],
  );
  const curatedScraps = useMemo(
    () =>
      curateScraps(filteredItems, {
        seed: layoutSeed,
        targetCount: selectedTargetCount,
        perDomainCap,
      }),
    [filteredItems, layoutSeed, perDomainCap, selectedTargetCount],
  );
  /**
   * Every scrap the tide can reach, ordered so the front of the queue is the
   * day-seeded curated selection: those wash ashore first, and everything else
   * waits its turn in the order `curateScraps` would have reached it.
   */
  const tidePool = useMemo(() => {
    const byKey = new Map(everythingScraps.map((item) => [item.key, item]));
    const ordered: ScrapItem[] = [];
    for (const item of curatedScraps) {
      if (byKey.delete(item.key)) ordered.push(item);
    }
    return [...ordered, ...byKey.values()];
  }, [curatedScraps, everythingScraps]);
  const tideCapacity = Math.min(curatedScraps.length, tidePool.length);
  const tideAvailable = !everythingMode && tidePool.length > tideCapacity;
  const poolByKey = useMemo(
    () => new Map(tidePool.map((item) => [item.key, item])),
    [tidePool],
  );

  useEffect(() => {
    setTide((current) => {
      const shuffled = tideShuffleIndexRef.current !== shuffleIndex;
      tideShuffleIndexRef.current = shuffleIndex;
      return deriveTideState(
        tidePool.map((item) => item.key),
        tideCapacity,
        shuffled ? undefined : current ?? undefined,
      );
    });
  }, [shuffleIndex, tideCapacity, tidePool]);

  /**
   * The shore as slots: one entry per position, `null` where a scrap has washed
   * off and nothing has yet washed back in.
   */
  const slots = useMemo<(ScrapItem | null)[]>(() => {
    if (everythingMode) return everythingScraps;
    if (!tide) return curatedScraps;
    return tide.ashore.map((key) =>
      key === null ? null : poolByKey.get(key) ?? null,
    );
  }, [curatedScraps, everythingMode, everythingScraps, poolByKey, tide]);
  const fieldHeight = useMemo(
    () =>
      everythingMode
        ? Math.max(
            containerSize.height,
            computeEverythingFieldHeight(
              slots.filter((item): item is ScrapItem => item !== null),
              containerSize.width,
              containerSize.height,
              layoutSeed,
            ),
          )
        : containerSize.height,
    [
      containerSize.height,
      containerSize.width,
      slots,
      everythingMode,
      layoutSeed,
    ],
  );
  const layout = useMemo(
    () => buildLayout(slots, containerSize.width, fieldHeight, layoutSeed),
    [containerSize.width, slots, fieldHeight, layoutSeed],
  );

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // Keys rendered on the previous pass, so the render below can tell a scrap
  // that just washed in from one that was already ashore.
  const renderedKeysRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (selectedKind !== "all" && kindCounts[selectedKind] === 0) {
      setSelectedKind("all");
    }
  }, [kindCounts, selectedKind]);

  /**
   * Drives the tide as a chain of self-scheduling events rather than a metronome:
   * each event decides its own kind and how long the tide rests before the next
   * one, so wash-outs and wash-ins are independent and the gaps are irregular.
   */
  useEffect(() => {
    if (!tideAvailable || tidePaused) return;

    let cancelled = false;
    const timeouts = new Set<number>();
    const wait = (delayMs: number, run: () => void) => {
      const timeout = window.setTimeout(() => {
        timeouts.delete(timeout);
        if (!cancelled) run();
      }, delayMs);
      timeouts.add(timeout);
    };

    const washOutOneScrap = () => {
      const current = tideRef.current;
      if (!current) return;
      const occupied = occupiedTideSlots(current);
      if (occupied.length === 0) return;
      const slotIndex = occupied[Math.floor(Math.random() * occupied.length)];
      const outgoingLayout = prefersReducedMotion
        ? undefined
        : layoutRef.current.find((scrap) => scrap.slotIndex === slotIndex);
      setTide(washOutTide(current, slotIndex));
      if (!outgoingLayout) return;

      washOutIdRef.current += 1;
      const washOutId = washOutIdRef.current;
      setWashingOut((currentWashingOut) => [
        ...currentWashingOut,
        { layout: outgoingLayout, washOutId, startedAt: Date.now() },
      ]);
    };

    const runEvent = () => {
      // Read through the ref so the scheduler stays off the effect's dependency
      // list and a rest is never cut short by an unrelated re-render.
      const current = tideRef.current;
      if (!current) return;

      const event = nextTideEvent(current, tideCapacity, Math.random);
      if (event.kind === "in") {
        setTide(washInTide(current));
      } else {
        washOutOneScrap();
        for (let index = 1; index < event.count; index += 1) {
          wait(index * event.staggerMs, washOutOneScrap);
        }
      }
      wait(event.delayMs, runEvent);
    };

    wait(
      Math.round(
        TIDE_GAP_MIN_MS + Math.random() * (TIDE_GAP_MAX_MS - TIDE_GAP_MIN_MS),
      ),
      runEvent,
    );

    return () => {
      cancelled = true;
      for (const timeout of timeouts) window.clearTimeout(timeout);
    };
  }, [prefersReducedMotion, tideAvailable, tideCapacity, tidePaused]);

  /**
   * Retires wash-out ghosts once their animation has played out. This is owned
   * separately from the scheduler so pausing the tide — which restarts the
   * scheduler effect — never strands an invisible ghost on the page.
   */
  useEffect(() => {
    if (washingOut.length === 0) return;

    const now = Date.now();
    const expired = washingOut.filter(
      (scrap) => now - scrap.startedAt >= TIDE_WASH_OUT_MS,
    );
    if (expired.length > 0) {
      const expiredIds = new Set(expired.map((scrap) => scrap.washOutId));
      setWashingOut((current) =>
        current.filter((scrap) => !expiredIds.has(scrap.washOutId)),
      );
      return;
    }

    const soonest = Math.min(
      ...washingOut.map((scrap) => scrap.startedAt + TIDE_WASH_OUT_MS - now),
    );
    const timeout = window.setTimeout(() => {
      const cutoff = Date.now();
      setWashingOut((current) =>
        current.filter(
          (scrap) => cutoff - scrap.startedAt < TIDE_WASH_OUT_MS,
        ),
      );
    }, Math.max(soonest, 0));
    return () => window.clearTimeout(timeout);
  }, [washingOut]);

  useEffect(() => {
    if (!tideAvailable) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(active.tagName))
      ) {
        return;
      }
      event.preventDefault();
      setTidePaused((current) => !current);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [tideAvailable]);

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

  const markScrapLoaded = (key: string) => {
    setLoadedScraps((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
  };

  /**
   * Scraps the examine view can step through with the arrow keys: the order
   * they are currently laid out in, so left/right follow what the eye sees.
   */
  const examinableScraps = layout
    .map((scrap) => scrap.item)
    .filter(
      (item) => !failedScraps.has(item.key) && isRenderableScrap(item),
    );
  const examineIndex = examining
    ? examinableScraps.findIndex((item) => item.key === examining.key)
    : -1;
  const examinedItem = examineIndex >= 0 ? examinableScraps[examineIndex] : null;

  const openExamine = (item: ScrapItem, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    const layoutEntry = layout.find((scrap) => scrap.item.key === item.key);
    examineTriggerRef.current = element;
    if (tidePausedBeforeExamineRef.current === null) {
      tidePausedBeforeExamineRef.current = tidePaused;
      setTidePaused(true);
    }
    setExamining({
      key: item.key,
      origin: {
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        rotation: layoutEntry?.rotation ?? 0,
      },
    });
  };

  const closeExamine = () => {
    setExamining(null);
    if (tidePausedBeforeExamineRef.current !== null) {
      setTidePaused(tidePausedBeforeExamineRef.current);
      tidePausedBeforeExamineRef.current = null;
    }
    // The origin tile can be gone (a filter change, a wash-out); fall back to
    // the collage itself so focus never escapes to the top of the document.
    const trigger = examineTriggerRef.current;
    if (trigger?.isConnected) {
      trigger.focus();
    } else {
      const fallback =
        containerRef.current?.querySelector<HTMLElement>("[data-scrap-key]");
      fallback?.focus();
    }
    examineTriggerRef.current = null;
  };
  const closeExamineRef = useRef(closeExamine);
  closeExamineRef.current = closeExamine;

  /**
   * The examined scrap can vanish from the visible set while the lightbox is
   * open (a kind filter is pressed, the scrap fails to load). Run the full close
   * path rather than letting the dialog unmount with the tide still held.
   */
  useEffect(() => {
    if (examining && !examinedItem) closeExamineRef.current();
  }, [examinedItem, examining]);

  /**
   * Steps to a neighbouring scrap, re-anchoring the lightbox on that scrap's
   * own tile so closing puts it back where it actually lives.
   */
  const stepExamine = (delta: number) => {
    const next = examinableScraps[examineIndex + delta];
    if (!next) return;
    const layoutEntry = layout.find((scrap) => scrap.item.key === next.key);
    const bounds = tileElementsRef.current.get(next.key)?.getBoundingClientRect();
    setExamining({
      key: next.key,
      origin: bounds
        ? {
            left: bounds.left,
            top: bounds.top,
            width: bounds.width,
            height: bounds.height,
            rotation: layoutEntry?.rotation ?? 0,
          }
        : { left: 0, top: 0, width: 0, height: 0, rotation: 0 },
    });
  };

  const renderTile = (scrap: ScrapLayout, modifier: string) => {
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
        className={`scrap-collage__tile${modifier}`}
        href={scrap.item.pageUrl}
        data-scrap-key={scrap.item.key}
        ref={(element) => {
          // A washing-out tile is a departing copy of a scrap that may already
          // be ashore again elsewhere, so it never claims the key.
          if (modifier.includes("washing-out")) return;
          if (element) {
            tileElementsRef.current.set(scrap.item.key, element);
          } else {
            tileElementsRef.current.delete(scrap.item.key);
          }
        }}
        aria-label={`Examine ${title}`}
        aria-haspopup="dialog"
        style={tileStyle}
        onClick={(event) => {
          // Plain clicks open the examine view; modifier clicks keep the
          // anchor's normal "open the source page" behaviour.
          if (
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          openExamine(scrap.item, event.currentTarget);
        }}
      >
        <ScrapContent
          item={scrap.item}
          loaded={loadedScraps.has(scrap.item.key)}
          onLoad={() => markScrapLoaded(scrap.item.key)}
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
  };

  const washInKeys = new Set<string>();
  if (!everythingMode && !prefersReducedMotion && renderedKeysRef.current) {
    for (const scrap of layout) {
      if (!renderedKeysRef.current.has(scrap.item.key)) {
        washInKeys.add(scrap.item.key);
      }
    }
  }
  renderedKeysRef.current = new Set(layout.map((scrap) => scrap.item.key));

  const tiles = layout.map((scrap) =>
    renderTile(
      scrap,
      washInKeys.has(scrap.item.key)
        ? " scrap-collage__tile--washing-in"
        : "",
    ),
  );

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <style>{COLLAGE_STYLES}</style>
      {showKindFilter && (
        <div
          className={`scrap-collage__controls${
            controlsExpanded ? "" : " scrap-collage__controls--collapsed"
          }`}
          aria-label="Scrap controls"
        >
          {controlsExpanded ? (
            <>
              <label className="scrap-collage__control-group">
                <span className="scrap-collage__control-label">show</span>
                <select
                  className="scrap-collage__select"
                  aria-label="Kinds of scraps shown"
                  value={selectedKind}
                  onChange={(event) =>
                    setSelectedKind(event.currentTarget.value as ScrapKindFilter)
                  }
                >
                  <option value="all">all · {totalScrapCount}</option>
                  {SCRAP_KIND_OPTIONS.map(({ kind, label }) =>
                    kindCounts[kind] > 0 ? (
                      <option key={kind} value={kind}>
                        {label} · {kindCounts[kind]}
                      </option>
                    ) : null,
                  )}
                </select>
              </label>
              <label className="scrap-collage__control-group">
                <span className="scrap-collage__control-label">amount</span>
                <select
                  className="scrap-collage__select"
                  aria-label="Number of scraps shown"
                  value={visibleScrapCount}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setVisibleScrapCount(
                      value === "auto" || value === "everything"
                        ? value
                        : (Number(value) as VisibleScrapCount),
                    );
                  }}
                >
                  <option value="auto">fill screen · {selectedTargetCount}</option>
                  <option value="100">100</option>
                  <option value="200">200</option>
                  <option value="300">300</option>
                  <option value="500">500</option>
                  <option value="everything">
                    everything · {everythingScraps.length}
                  </option>
                </select>
              </label>
              <button
                type="button"
                className="scrap-collage__filter"
                onClick={() => setShuffleIndex((current) => current + 1)}
              >
                shuffle
              </button>
              {tideAvailable && (
                <button
                  type="button"
                  className="scrap-collage__filter scrap-collage__filter--tide"
                  aria-pressed={!tidePaused}
                  title="Pause or resume the tide (spacebar)"
                  onClick={() => setTidePaused((current) => !current)}
                >
                  {tidePaused ? "tide paused" : "tide moving"}
                </button>
              )}
              <button
                type="button"
                className="scrap-collage__filter scrap-collage__filter--collapse"
                aria-label="Collapse scrap controls"
                title="Collapse controls"
                onClick={() => setControlsExpanded(false)}
              >
                ↓
              </button>
            </>
          ) : (
            <button
              type="button"
              className="scrap-collage__filter"
              aria-expanded="false"
              onClick={() => setControlsExpanded(true)}
            >
              controls ↑
            </button>
          )}
        </div>
      )}
      {washingOut.map((scrap) => (
        <React.Fragment key={`washing-out-${scrap.washOutId}`}>
          {renderTile(scrap.layout, " scrap-collage__tile--washing-out")}
        </React.Fragment>
      ))}
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
      {examining && examinedItem && (
        <ScrapLightbox
          key={examinedItem.key}
          item={examinedItem}
          origin={examining.origin}
          faviconSrc={
            examinedItem.faviconUrl ||
            `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
              examinedItem.domain,
            )}&sz=64`
          }
          faviconAvailable={!failedFavicons.has(examinedItem.domain)}
          onFaviconError={() => markFaviconFailed(examinedItem.domain)}
          placeholderColor={placeholderColor(examinedItem.domain)}
          hasPrevious={examineIndex > 0}
          hasNext={examineIndex < examinableScraps.length - 1}
          prefersReducedMotion={prefersReducedMotion}
          currentOrigin={() => {
            const element = tileElementsRef.current.get(examinedItem.key);
            if (!element?.isConnected) return null;
            const bounds = element.getBoundingClientRect();
            const layoutEntry = layoutRef.current.find(
              (scrap) => scrap.item.key === examinedItem.key,
            );
            return {
              left: bounds.left,
              top: bounds.top,
              width: bounds.width,
              height: bounds.height,
              rotation: layoutEntry?.rotation ?? 0,
            };
          }}
          onClose={closeExamine}
          onPrevious={() => stepExamine(-1)}
          onNext={() => stepExamine(1)}
        />
      )}
    </div>
  );
}
