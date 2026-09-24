// ABOUTME: Curates collected image scraps and arranges them in a deterministic scatter collage.
// ABOUTME: Shows source provenance on hover and links each surviving image to its page.

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ScrapFilters,
  scrapPassesFilters,
  type ScrapKindFilter,
} from "./ScrapFilters";
import type { FilterChip } from "../utils/eventUtils";
import { hashString, seededRandom } from "../utils/styleUtils";
import { ScrapLightbox, type ScrapOrigin } from "./ScrapLightbox";
import { useScrapImageSrc } from "../utils/scrapImageSource";
import {
  isImageContentHash,
  canonicalButtonKey,
  canonicalCursorKey,
  canonicalHeadingKey,
  canonicalImageKey,
  canonicalSvgIconKey,
} from "../utils/scrapIdentity";

import {
  groupPhotoEncounters,
  type ScrapSource,
} from "../utils/scrapPhotoGroups";

/**
 * Where a scrap sat on the page it was taken from: its centre in document
 * coordinates, plus that document's scroll size. Absent on scraps collected
 * before the extension recorded it.
 */
export interface ScrapPosition {
  pageX: number;
  pageY: number;
  pageWidth: number;
  pageHeight: number;
}

interface ScrapItemBase {
  sources?: ScrapSource[];
  encounterCount?: number;
  encounterDay?: string;
  id: string;
  key: string;
  pageTitle: string;
  faviconUrl?: string;
  domain: string;
  pageUrl: string;
  ts: number;
  position?: ScrapPosition;
}

export type ScrapItem = ScrapItemBase &
  (
    | {
        kind: "image";
        src: string;
        contentHash?: string;
        alt?: string;
        naturalWidth: number;
        naturalHeight: number;
      }
    | {
        kind: "button";
        text: string;
        styles: Record<string, string>;
        innerSvg?: string;
        backdropColor?: string;
      }
    | {
        kind: "svg-icon";
        markup: string;
        width: number;
        height: number;
      }
    | {
        kind: "heading";
        text: string;
        level: 1 | 2 | 3;
        styles: Record<string, string>;
        /** A heading is words-material: it never carries a backdrop. */
        backdropColor?: never;
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

type ScrapView = "drift" | "archive";
type ScrapDisplay = "pile" | "grid";
const DISPLAY_STORAGE_KEY = "scraps-display";
function readScrapDisplay(): ScrapDisplay {
  try {
    return localStorage.getItem(DISPLAY_STORAGE_KEY) === "grid"
      ? "grid"
      : "pile";
  } catch {
    return "pile";
  }
}
function archiveCell(display: ScrapDisplay) {
  return display === "pile"
    ? { width: 76, height: 74 }
    : { width: ARCHIVE_CELL_WIDTH, height: ARCHIVE_ROW_HEIGHT };
}

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
const SCRAPS_PER_VIEWPORT_AREA = 5_600;
const MIN_AUTO_TARGET_COUNT = 100;
const MAX_AUTO_TARGET_COUNT = 500;
const ARCHIVE_CELL_WIDTH = 160;
const ARCHIVE_ROW_HEIGHT = 112;
const ARCHIVE_OVERSCAN_VIEWPORTS = 0.25;
const ARCHIVE_STACK_LAYER_COUNT = 3;
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
/** Captured font sizes range from hairline to billboard; display needs a narrower band. */
const MIN_HEADING_DISPLAY_FONT_SIZE = 11;
const MAX_HEADING_DISPLAY_FONT_SIZE = 34;
const HEADING_TILE_HEIGHT = 44;
/** Line spacing headings are drawn at, replacing the page's captured value. */
const HEADING_LINE_HEIGHT = 1.15;

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
    case "heading": {
      const size = headingTileSize(item);
      return size.width * size.height;
    }
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
      return isImageContentHash(item.contentHash)
        ? `image:sha256:${item.contentHash}`
        : canonicalImageKey(item.src);
    case "button":
      return canonicalButtonKey(
        item.domain,
        item.text,
        item.styles.backgroundColor,
      );
    case "svg-icon":
      return canonicalSvgIconKey(item.domain, item.markup);
    case "heading":
      return canonicalHeadingKey(item.domain, item.text);
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

function newestUniqueScraps(items: ScrapItem[]): ScrapItem[] {
  const newestByCanonicalKey = new Map<string, ScrapItem>();
  for (const item of groupPhotoEncounters(items)) {
    const canonicalKey = canonicalScrapKey(item);
    const current = newestByCanonicalKey.get(canonicalKey);
    if (!current || item.ts > current.ts) {
      newestByCanonicalKey.set(canonicalKey, item);
    }
  }

  const newestByKey = new Map<string, ScrapItem>();
  for (const item of newestByCanonicalKey.values()) {
    const current = newestByKey.get(item.key);
    if (!current || item.ts > current.ts) {
      newestByKey.set(item.key, item);
    }
  }
  return Array.from(newestByKey.values());
}

/** Counts scraps the way the archive lists them, once per scrap however often it was met. */
function countUniqueScraps(items: ScrapItem[]): number {
  return newestUniqueScraps(items).length;
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

  const scrapsByDomain = new Map<string, ScrapItem[]>();
  for (const item of newestUniqueScraps(items)) {
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
  return state.ashore.reduce(
    (count, key) => (key === null ? count : count + 1),
    0,
  );
}

function randomBetween(
  rand: () => number,
  minimum: number,
  maximum: number,
): number {
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

  const wantsWashIn =
    ashoreCount < floor
      ? true
      : ashoreCount >= targetCount
        ? false
        : rand() < 0.5;
  const kind: TideEventKind =
    wantsWashIn && canWashIn ? "in" : canWashOut ? "out" : "in";

  const delayMs = Math.round(
    randomBetween(rand, TIDE_GAP_MIN_MS, TIDE_GAP_MAX_MS),
  );

  if (
    kind === "out" &&
    ashoreCount > TIDE_WAVE_MIN_COUNT &&
    rand() < TIDE_WAVE_CHANCE
  ) {
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

/**
 * Advance per character as a share of font size, wide enough that a broad
 * typeface still fits the tile measured for it.
 */
const HEADING_CHARACTER_ADVANCE = 0.68;
const HEADING_TILE_PADDING = 16;
const MAX_HEADING_TILE_WIDTH = 340;

/**
 * The size a heading is drawn at: its captured size brought into a band the
 * collage can hold, then reduced so the wording fits the width available to
 * it. A billboard headline and a hairline subhead both end up legible scraps
 * rather than clipped ones. `availableWidth` is the laid-out tile width when
 * the caller knows it, and otherwise the widest tile a heading is given.
 */
export function headingDisplayFontSize(
  styles: Record<string, string>,
  text = "",
  availableWidth = MAX_HEADING_TILE_WIDTH,
): number {
  const capturedSize = Number.parseFloat(styles.fontSize ?? "");
  const bandedSize = Number.isFinite(capturedSize) && capturedSize > 0
    ? clamp(
        MIN_HEADING_DISPLAY_FONT_SIZE,
        MAX_HEADING_DISPLAY_FONT_SIZE,
        capturedSize,
      )
    : MIN_HEADING_DISPLAY_FONT_SIZE;

  const characterCount = text.trim().length;
  if (characterCount === 0) return bandedSize;

  const widthBudget = Math.max(
    HEADING_TILE_PADDING,
    availableWidth - HEADING_TILE_PADDING,
  );
  const sizeThatFits =
    widthBudget / (characterCount * HEADING_CHARACTER_ADVANCE);
  return Math.round(
    Math.max(MIN_HEADING_DISPLAY_FONT_SIZE, Math.min(bandedSize, sizeThatFits)),
  );
}

/**
 * The box a heading needs at display size: wide enough for its wording on one
 * line where that fits inside the widest tile a heading gets, and otherwise as
 * wide as that tile and tall enough for the lines the wording wraps onto.
 */
function headingTileSize(item: Extract<ScrapItem, { kind: "heading" }>): {
  width: number;
  height: number;
} {
  const fontSize = headingDisplayFontSize(item.styles, item.text);
  const textWidth =
    item.text.trim().length * fontSize * HEADING_CHARACTER_ADVANCE;
  const width = clamp(
    90,
    MAX_HEADING_TILE_WIDTH,
    HEADING_TILE_PADDING + textWidth,
  );
  return { width, height: headingHeightAtWidth(item, width) };
}

/**
 * How tall a heading needs to be once its words wrap to `width`. Used both to
 * size a heading in the tide and to re-derive its height after the archive has
 * scaled its width down to a cell.
 */
function headingHeightAtWidth(
  item: Extract<ScrapItem, { kind: "heading" }>,
  width: number,
): number {
  const fontSize = headingDisplayFontSize(item.styles, item.text, width);
  const textWidth =
    item.text.trim().length * fontSize * HEADING_CHARACTER_ADVANCE;
  const lineCount = Math.max(
    1,
    Math.ceil(textWidth / Math.max(1, width - HEADING_TILE_PADDING)),
  );
  return Math.max(
    HEADING_TILE_HEIGHT,
    lineCount * fontSize * HEADING_LINE_HEIGHT + 12,
  );
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
    case "heading":
      return headingTileSize(item);
    case "cursor":
      return { width: CURSOR_TILE_SIZE, height: CURSOR_TILE_SIZE };
  }
}

function tierBounds(items: ScrapItem[]): {
  lowerArea: number;
  upperArea: number;
} {
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

export function buildArchiveWindow(
  items: ScrapItem[],
  width: number,
  scrollTop: number,
  viewportHeight: number,
  seed: number,
  sizeBounds = tierBounds(items),
  display: ScrapDisplay = "grid",
): { fieldHeight: number; layout: ScrapLayout[] } {
  if (items.length === 0 || width <= 0 || viewportHeight <= 0) {
    return { fieldHeight: 0, layout: [] };
  }

  const cell = archiveCell(display);
  const columnCount = Math.max(1, Math.floor(width / cell.width));
  const rowCount = Math.ceil(items.length / columnCount);
  const fieldHeight = Math.max(viewportHeight, rowCount * cell.height);
  const cellWidth = width / columnCount;
  const overscan = viewportHeight * ARCHIVE_OVERSCAN_VIEWPORTS;
  const firstRow = Math.max(
    0,
    Math.floor((scrollTop - overscan) / cell.height),
  );
  const lastRow = Math.min(
    rowCount - 1,
    Math.ceil((scrollTop + viewportHeight + overscan) / cell.height),
  );
  const firstIndex = firstRow * columnCount;
  const lastIndex = Math.min(items.length, (lastRow + 1) * columnCount);
  const layout: ScrapLayout[] = [];

  for (let index = firstIndex; index < lastIndex; index += 1) {
    const item = items[index];
    const itemSeed = seed + hashString(item.key);
    const tier = tierForItem(item, sizeBounds.lowerArea, sizeBounds.upperArea);
    const dimensions = itemSize(item, tier, itemSeed);
    const rotation =
      display === "pile" ? seededRandom(itemSeed, 4) * 12 - 6 : 0;
    {
      const angle = (Math.abs(rotation) * Math.PI) / 180;
      const rotatedWidth =
        dimensions.width * Math.cos(angle) +
        dimensions.height * Math.sin(angle);
      const rotatedHeight =
        dimensions.height * Math.cos(angle) +
        dimensions.width * Math.sin(angle);
      const scale = Math.min(
        1,
        (cellWidth * (display === "pile" ? 1.05 : 0.8)) / rotatedWidth,
        (cell.height * (display === "pile" ? 1.05 : 0.8)) / rotatedHeight,
      );
      dimensions.width *= scale;
      dimensions.height *= scale;
      if (item.kind === "heading") {
        // A heading's words wrap to whatever width survives the scale, so its
        // height follows from that width rather than scaling with it.
        dimensions.height = Math.min(
          cell.height,
          headingHeightAtWidth(item, dimensions.width),
        );
      }
    }
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    const jitterX =
      (display === "pile" ? seededRandom(itemSeed, 2) - 0.5 : 0) *
      cellWidth *
      (item.kind === "image" ? 0.2 : 0.45);
    const jitterY =
      (display === "pile" ? seededRandom(itemSeed, 3) - 0.5 : 0) *
      cell.height *
      (item.kind === "image" ? 0.2 : 0.35);
    const unclampedX =
      (column + 0.5) * cellWidth + jitterX - dimensions.width / 2;
    const unclampedY =
      (row + 0.5) * cell.height + jitterY - dimensions.height / 2;
    const x = Math.max(4, Math.min(width - dimensions.width - 4, unclampedX));
    const y = Math.max(
      4,
      Math.min(fieldHeight - dimensions.height - 4, unclampedY),
    );

    layout.push({
      item,
      slotIndex: index,
      x,
      y,
      width: dimensions.width,
      height: dimensions.height,
      rotation,
      zIndex:
        Math.floor(seededRandom(itemSeed, 5) * ARCHIVE_STACK_LAYER_COUNT) + 1,
      cardAbove: y - scrollTop > viewportHeight * 0.58,
      cardRightAligned: x > width * 0.68,
    });
  }

  return { fieldHeight, layout };
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
  display: ScrapDisplay,
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
    if (display === "grid") {
      const scale = Math.min(
        1,
        (cellWidth * 0.8) / itemDimensions.width,
        (cellHeight * 0.8) / itemDimensions.height,
      );
      itemDimensions.width *= scale;
      itemDimensions.height *= scale;
    }
    const column = index % columnCount;
    const row = Math.floor(index / columnCount);
    const jitterX =
      (display === "pile" ? seededRandom(itemSeed, 2) - 0.5 : 0) *
      cellWidth *
      0.6;
    const jitterY =
      (display === "pile" ? seededRandom(itemSeed, 3) - 0.5 : 0) *
      cellHeight *
      0.6;
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
        rotation: display === "pile" ? seededRandom(itemSeed, 4) * 12 - 6 : 0,
        zIndex: Math.floor(seededRandom(itemSeed, 5) * 80) + 1,
        cardAbove: y > height * 0.58,
        cardRightAligned: x > width * 0.68,
      },
    ];
  });
}

export const COLLAGE_STYLES = `
  .scrap-collage__controls {
    position: absolute;
    bottom: 12px;
    left: 50%;
    z-index: 300;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    box-sizing: border-box;
    width: 560px;
    max-width: calc(100% - 24px);
    padding: 8px;
    border: 1px solid rgba(61, 56, 51, 0.2);
    border-radius: 8px;
    background: #f5f0e8;
    box-shadow: 0 8px 24px rgba(61, 56, 51, 0.2);
    pointer-events: auto;
    transform: translateX(-50%);
  }

  .scrap-collage__controls--collapsed {
    width: auto;
    padding: 0;
    border: 0;
    background: transparent;
    box-shadow: none;
  }

  .scrap-collage__controls-header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .scrap-collage__controls-header > :not(.scrap-collage__controls-spacer) {
    flex: 0 0 auto;
  }

  .scrap-collage__shuffle-mark {
    font-size: 12px;
  }

  .scrap-collage__controls-spacer {
    flex: 1 1 auto;
  }

  .scrap-collage__controls-filters {
    padding-top: 8px;
    border-top: 1px solid rgba(61, 56, 51, 0.12);
  }

  .scrap-collage__view-switch {
    display: inline-flex;
    align-items: stretch;
    box-sizing: border-box;
    height: 28px;
    padding: 2px;
    border: 1px solid rgba(61, 56, 51, 0.18);
    border-radius: 999px;
    background: rgba(61, 56, 51, 0.05);
  }

  .scrap-collage__view-option {
    appearance: none;
    display: inline-flex;
    align-items: center;
    padding: 0 12px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: #827a72;
    cursor: pointer;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    line-height: 1;
  }

  .scrap-collage__view-option[aria-pressed="true"] {
    background: #faf9f6;
    box-shadow: 0 1px 4px rgba(61, 56, 51, 0.18);
    color: #3d3833;
  }

  .scrap-collage__view-option:focus-visible {
    outline: 2px solid rgba(74, 154, 138, 0.45);
    outline-offset: 1px;
  }

  .scrap-collage__archive-summary {
    color: #827a72;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    white-space: nowrap;
  }

  .scrap-collage__filter {
    appearance: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    box-sizing: border-box;
    height: 28px;
    padding: 0 11px;
    border: 1px solid rgba(61, 56, 51, 0.18);
    border-radius: 999px;
    background: transparent;
    color: #3d3833;
    cursor: pointer;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
    line-height: 1;
    white-space: nowrap;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease,
      background-color 120ms ease;
  }

  .scrap-collage__controls--collapsed .scrap-collage__filter {
    background: #f5f0e8;
  }

  .scrap-collage__filter--collapse {
    width: 28px;
    padding: 0;
    color: #827a72;
  }

  .scrap-collage__filter:hover {
    border-color: rgba(61, 56, 51, 0.38);
  }

  .scrap-collage__filter:focus-visible {
    outline: none;
    border-color: #4a9a8a;
    box-shadow: 0 0 0 3px rgba(74, 154, 138, 0.16);
  }

  @media (max-width: 619px) {
    .scrap-collage__view-option {
      padding: 0 9px;
    }
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

  /* The torn-out patch: the element's box plus an even margin, square edges. */
  .scrap-collage__backdrop {
    box-sizing: border-box;
    display: flex;
    width: 100%;
    height: 100%;
    padding: 3px;
    align-items: center;
    justify-content: center;
    pointer-events: none;
  }

  .scrap-collage__heading {
    box-sizing: border-box;
    display: flex;
    width: 100%;
    height: 100%;
    padding: 0 4px;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    text-align: center;
    /* Wording too long for its tile at the smallest legible size wraps and
       breaks rather than running off the edge. */
    overflow-wrap: anywhere;
    pointer-events: none;
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
    case "heading":
      return item.text.trim() || "heading";
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
    case "heading":
      return item.text.trim().length > 0;
    case "cursor":
      return item.url.trim().length > 0;
  }
}

export interface ScrapContentProps {
  item: ScrapItem;
  loaded: boolean;
  onError: () => void;
  onLoad: () => void;
  /** Laid-out tile width, so text-bearing scraps can size themselves to it. */
  tileWidth?: number;
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

/**
 * Paints the color a see-through element was read against as a snug patch
 * behind it, so the scrap carries the contrast its page supplied and reads as
 * a piece torn out rather than text floating on the collage's paper. Scraps
 * collected before the backdrop was recorded simply render without one.
 */
export function ScrapBackdrop({
  color,
  children,
}: {
  color?: string;
  children: React.ReactNode;
}) {
  if (!color) return <>{children}</>;
  return (
    <span className="scrap-collage__backdrop" style={{ background: color }}>
      {children}
    </span>
  );
}

export function ScrapContent({
  item,
  loaded,
  onError,
  onLoad,
  tileWidth,
}: ScrapContentProps) {
  const imageSrc = useScrapImageSrc(
    item.kind === "image" ? item.src : undefined,
  );
  switch (item.kind) {
    case "image":
      return (
        <>
          <ScrapSwatch domain={item.domain} loaded={loaded} />
          <img
            className={`scrap-collage__image scrap-collage__developing${
              loaded ? " scrap-collage__developed" : ""
            }`}
            src={imageSrc ?? undefined}
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
        <ScrapBackdrop color={item.backdropColor}>
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
        </ScrapBackdrop>
      );
    case "svg-icon":
      return (
        <div
          className="scrap-collage__svg"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: item.markup }}
        />
      );
    case "heading":
      return (
        <span
          className="scrap-collage__heading"
          style={{
            ...(item.styles as React.CSSProperties),
            fontSize: headingDisplayFontSize(item.styles, item.text, tileWidth),
            // The captured line height belongs to the captured font size; at
            // display size it would space wrapped lines far too far apart.
            lineHeight: HEADING_LINE_HEIGHT,
          }}
        >
          {item.text}
        </span>
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
  const archiveScrollRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [selectedKind, setSelectedKind] = useState<ScrapKindFilter>("all");
  const [places, setPlaces] = useState<FilterChip[]>([]);
  const [search, setSearch] = useState("");
  const [controlsFocused, setControlsFocused] = useState(false);
  const [view, setView] = useState<ScrapView>("drift");
  const [display, setDisplay] = useState<ScrapDisplay>(readScrapDisplay);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const pendingScrollRef = useRef<number | null>(null);
  const shufflePreviousKeysRef = useRef(new Set<string>());
  const [archiveScrollTop, setArchiveScrollTop] = useState(0);
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
  const tidePaused =
    prefersReducedMotion ||
    hovered ||
    focused ||
    controlsFocused ||
    examining !== null;
  const examineTriggerRef = useRef<HTMLElement | null>(null);
  // Rendered tile elements by scrap key, so arrow-key navigation can re-anchor
  // the examine view on the next scrap's actual slot.
  const tileElementsRef = useRef(new Map<string, HTMLElement>());
  const archiveMode = view === "archive";
  const layoutSeed = seed + (archiveMode ? 0 : shuffleIndex * 10_007);
  const selectedTargetCount =
    targetCount ??
    responsiveTargetCount(containerSize.width, containerSize.height);
  const changeDisplay = (next: ScrapDisplay) => {
    if (next === display) return;
    setWashingOut([]);
    if (archiveMode) {
      const oldCell = archiveCell(display),
        nextCell = archiveCell(next);
      const index =
        Math.floor(archiveScrollTop / oldCell.height) *
        Math.max(1, Math.floor(containerSize.width / oldCell.width));
      pendingScrollRef.current =
        Math.floor(
          index / Math.max(1, Math.floor(containerSize.width / nextCell.width)),
        ) * nextCell.height;
    }
    setDisplay(next);
    try {
      localStorage.setItem(DISPLAY_STORAGE_KEY, next);
    } catch {
      /* Layout still changes when storage is unavailable. */
    }
  };
  useLayoutEffect(() => {
    if (pendingScrollRef.current === null) return;
    const top = pendingScrollRef.current;
    pendingScrollRef.current = null;
    if (archiveScrollRef.current) archiveScrollRef.current.scrollTop = top;
    setArchiveScrollTop(top);
  }, [display]);

  const groupedItems = useMemo(() => groupPhotoEncounters(items), [items]);
  const uniqueItems = useMemo(
    () => newestUniqueScraps(groupedItems),
    [groupedItems],
  );
  const filteredItems = useMemo(
    () =>
      groupedItems.filter((item) =>
        scrapPassesFilters(item, selectedKind, places, search),
      ),
    [groupedItems, selectedKind, places, search],
  );
  const archiveScraps = useMemo(
    () =>
      newestUniqueScraps(filteredItems).sort(
        (first, second) =>
          second.ts - first.ts || first.key.localeCompare(second.key),
      ),
    [filteredItems],
  );
  const archiveSizeBounds = useMemo(
    () => tierBounds(archiveScraps),
    [archiveScraps],
  );
  const curatedScraps = useMemo(
    () =>
      curateScraps(filteredItems, {
        seed: layoutSeed,
        targetCount: selectedTargetCount,
        perDomainCap: perDomainCap ?? Infinity,
      }),
    [filteredItems, layoutSeed, perDomainCap, selectedTargetCount],
  );
  /**
   * Every scrap the tide can reach, ordered so the front of the queue is the
   * day-seeded curated selection: those wash ashore first, and everything else
   * waits its turn in the order `curateScraps` would have reached it.
   */
  const tidePool = useMemo(() => {
    const byKey = new Map(archiveScraps.map((item) => [item.key, item]));
    const ordered: ScrapItem[] = [];
    for (const item of curatedScraps) {
      if (byKey.delete(item.key)) ordered.push(item);
    }
    const pool = [...ordered, ...byKey.values()];
    if (shuffleIndex > 0)
      pool.sort(
        (a, b) =>
          Number(shufflePreviousKeysRef.current.has(a.key)) -
            Number(shufflePreviousKeysRef.current.has(b.key)) ||
          itemOrder(a, layoutSeed) - itemOrder(b, layoutSeed),
      );
    return pool;
  }, [archiveScraps, curatedScraps, shuffleIndex, layoutSeed]);
  const tideCapacity = Math.min(curatedScraps.length, tidePool.length);
  const tideAvailable = !archiveMode && tidePool.length > tideCapacity;
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
        shuffled ? undefined : (current ?? undefined),
      );
    });
  }, [shuffleIndex, tideCapacity, tidePool]);

  /**
   * The shore as slots: one entry per position, `null` where a scrap has washed
   * off and nothing has yet washed back in.
   */
  const slots = useMemo<(ScrapItem | null)[]>(() => {
    if (!tide) return curatedScraps;
    return tide.ashore.map((key) =>
      key === null ? null : (poolByKey.get(key) ?? null),
    );
  }, [curatedScraps, poolByKey, tide]);
  const archiveWindow = useMemo(
    () =>
      archiveMode
        ? buildArchiveWindow(
            archiveScraps,
            containerSize.width,
            archiveScrollTop,
            containerSize.height,
            layoutSeed,
            archiveSizeBounds,
            display,
          )
        : { fieldHeight: 0, layout: [] },
    [
      archiveMode,
      archiveScraps,
      archiveScrollTop,
      archiveSizeBounds,
      display,
      containerSize,
      layoutSeed,
    ],
  );
  const fieldHeight = archiveMode
    ? archiveWindow.fieldHeight
    : containerSize.height;
  const layout = useMemo(
    () =>
      archiveMode
        ? archiveWindow.layout
        : buildLayout(
            slots,
            containerSize.width,
            containerSize.height,
            layoutSeed,
            display,
          ),
    [
      archiveMode,
      archiveWindow.layout,
      containerSize,
      layoutSeed,
      slots,
      display,
    ],
  );

  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // Keys rendered on the previous pass, so the render below can tell a scrap
  // that just washed in from one that was already ashore.
  const renderedKeysRef = useRef<Set<string> | null>(null);

  useLayoutEffect(() => {
    if (archiveScrollRef.current) archiveScrollRef.current.scrollTop = 0;
    setArchiveScrollTop(0);
    setHovered(false);
    setFocused(false);
    setWashingOut([]);
  }, [archiveMode, selectedKind, places, search]);

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
    const timeout = window.setTimeout(
      () => {
        const cutoff = Date.now();
        setWashingOut((current) =>
          current.filter(
            (scrap) => cutoff - scrap.startedAt < TIDE_WASH_OUT_MS,
          ),
        );
      },
      Math.max(soonest, 0),
    );
    return () => window.clearTimeout(timeout);
  }, [washingOut]);

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
    .filter((item) => !failedScraps.has(item.key) && isRenderableScrap(item));
  const examineIndex = examining
    ? examinableScraps.findIndex((item) => item.key === examining.key)
    : -1;
  const examinedItem =
    examineIndex >= 0 ? examinableScraps[examineIndex] : null;

  const openExamine = (item: ScrapItem, element: HTMLElement) => {
    const bounds = element.getBoundingClientRect();
    const layoutEntry = layout.find((scrap) => scrap.item.key === item.key);
    examineTriggerRef.current = element;
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
    const bounds = tileElementsRef.current
      .get(next.key)
      ?.getBoundingClientRect();
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
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
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
          tileWidth={scrap.width}
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
  if (!archiveMode && !prefersReducedMotion && renderedKeysRef.current) {
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
      washInKeys.has(scrap.item.key) ? " scrap-collage__tile--washing-in" : "",
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
          onFocus={() => setControlsFocused(true)}
          onBlur={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              setControlsFocused(false);
          }}
          aria-label="Scrap controls"
        >
          {controlsExpanded ? (
            <>
              <div className="scrap-collage__controls-header">
                <div
                  className="scrap-collage__view-switch"
                  role="group"
                  aria-label="Scrap view"
                >
                  <button
                    type="button"
                    className="scrap-collage__view-option"
                    aria-pressed={!archiveMode}
                    onClick={() => setView("drift")}
                  >
                    drift
                  </button>
                  <button
                    type="button"
                    className="scrap-collage__view-option"
                    aria-pressed={archiveMode}
                    onClick={() => setView("archive")}
                  >
                    archive
                  </button>
                </div>
                <div
                  className="scrap-collage__view-switch"
                  role="group"
                  aria-label="Scrap layout"
                >
                  {(["pile", "grid"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      className="scrap-collage__view-option"
                      aria-pressed={display === option}
                      onClick={() => changeDisplay(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <span className="scrap-collage__controls-spacer" />
                {archiveMode ? (
                  <span className="scrap-collage__archive-summary">
                    newest first · {archiveScraps.length} of{" "}
                    {uniqueItems.length}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="scrap-collage__filter"
                    onClick={() => {
                      shufflePreviousKeysRef.current = new Set(
                        tideRef.current?.ashore.filter(
                          (key): key is string => key !== null,
                        ) ?? [],
                      );
                      setShuffleIndex((current) => current + 1);
                    }}
                  >
                    <span
                      className="scrap-collage__shuffle-mark"
                      aria-hidden="true"
                    >
                      ⟳
                    </span>{" "}
                    shuffle
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
              </div>
              <div className="scrap-collage__controls-filters">
                <ScrapFilters
                  items={groupedItems}
                  places={places}
                  onPlaces={setPlaces}
                  kind={selectedKind}
                  onKind={setSelectedKind}
                  search={search}
                  onSearch={setSearch}
                  matchCount={archiveScraps.length}
                  countScraps={countUniqueScraps}
                />
              </div>
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
      {filteredItems.length === 0 && (
        <div
          role="status"
          style={{
            position: "absolute",
            top: "40%",
            width: "100%",
            textAlign: "center",
            color: "#827a72",
            fontFamily: "monospace",
          }}
        >
          No scraps match these filters.
        </div>
      )}
      {washingOut.map((scrap) => (
        <React.Fragment key={`washing-out-${scrap.washOutId}`}>
          {renderTile(scrap.layout, " scrap-collage__tile--washing-out")}
        </React.Fragment>
      ))}
      {archiveMode ? (
        <div
          ref={archiveScrollRef}
          className="scrap-collage__scroll"
          onScroll={(event) =>
            setArchiveScrollTop(event.currentTarget.scrollTop)
          }
        >
          <div className="scrap-collage__field" style={{ height: fieldHeight }}>
            {tiles}
          </div>
        </div>
      ) : (
        tiles
      )}
      {examining &&
        examinedItem &&
        createPortal(
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
          />,
          document.body,
        )}
    </div>
  );
}
