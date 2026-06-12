// ABOUTME: Pure model + layout logic for the night-shift skyline visualization.
// ABOUTME: Derives per-person "lights" from cursor events and lays out buildings.

import type { CollectionEvent } from "../types";
import {
  extractDomain,
  getColorForParticipant,
  hashParticipantId,
} from "./eventUtils";
import { resolveOwner, type Owner } from "./corporations";

/** Trailing window used to measure how vigorously someone is moving. */
export const RATE_WINDOW_MS = 8_000;

/** One person's light: where they are, who owns it, and how alive they are. */
export interface PersonLight {
  pid: string;
  domain: string;
  owner: Owner;
  tz?: string;
  color: string;
  /** ts of their most recent event, clamped to `now` (client clocks skew). */
  lastTs: number;
  lastClickTs: number;
  /** Events seen within RATE_WINDOW_MS of `now` — drives window flicker. */
  recentCount: number;
}

/**
 * Fold raw cursor events into one PersonLight per participant. Order-tolerant:
 * the latest event by ts wins for domain/owner, so callers don't need to sort.
 */
export function derivePeople(
  events: CollectionEvent[],
  now: number,
): Map<string, PersonLight> {
  const people = new Map<string, PersonLight>();
  for (const e of events) {
    if (e.type !== "cursor") continue;
    const pid = e.meta?.pid;
    const url = e.meta?.url;
    if (!pid || !url) continue;
    const domain = extractDomain(url);
    if (!domain) continue;
    const ts = Math.min(e.ts, now);

    let p = people.get(pid);
    if (!p) {
      p = {
        pid,
        domain,
        owner: resolveOwner(domain),
        tz: e.meta.tz,
        color: e.meta.cursor_color || getColorForParticipant(pid),
        lastTs: ts,
        lastClickTs: 0,
        recentCount: 0,
      };
      people.set(pid, p);
    }
    if (ts >= p.lastTs) {
      p.lastTs = ts;
      if (domain !== p.domain) {
        p.domain = domain;
        p.owner = resolveOwner(domain);
      }
      if (e.meta.tz) p.tz = e.meta.tz;
    }
    if (e.meta.cursor_color) p.color = e.meta.cursor_color;
    if (e.data?.event === "click" || e.data?.event === "hold") {
      p.lastClickTs = Math.max(p.lastClickTs, ts);
    }
    if (ts > now - RATE_WINDOW_MS) p.recentCount++;
  }
  return people;
}

/** Building a person belongs to: corporate towers collapse a whole portfolio
 * of domains into one owner; every independent domain is its own little house. */
export function buildingKeyFor(person: PersonLight): string {
  return person.owner.kind === "indie"
    ? `indie:${person.domain}`
    : person.owner.id;
}

// ── Layout ────────────────────────────────────────────────────────────────────

export interface WindowSlot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Building {
  key: string;
  owner: Owner;
  /** Set for indie houses — the one domain this house holds. */
  domain?: string;
  label: string;
  x: number;
  w: number;
  /** Top edge of the building body (roof decorations draw above this). */
  topY: number;
  baseY: number;
  floors: number;
  cols: number;
  /** Window slots ordered bottom-floor-first so lights cluster near street level. */
  slots: WindowSlot[];
  /** Stable per-building hash for silhouette/roof variation. */
  seed: number;
}

export interface SkylineLayout {
  buildings: Building[];
  /** Indie domains that didn't fit on the street. */
  overflowDomains: number;
  /** Horizontal scale applied when the natural layout exceeded the canvas. */
  scale: number;
}

export interface TowerInput {
  owner: Owner;
  /** Cumulative events observed for this owner — drives tower height. */
  cumEvents: number;
  occupants: number;
}

export interface HouseInput {
  domain: string;
  occupants: number;
  lastTs: number;
}

const WIN_W = 11;
const WIN_H = 13;
const WIN_GAP_X = 8;
const WIN_GAP_Y = 8;
const PAD = 10;
const FLOOR_H = WIN_H + WIN_GAP_Y;
const TOWER_GAP = 18;
const HOUSE_GAP = 12;
const STREET_GAP = 56; // breathing room between the corporate district and the indie street
const MARGIN = 28;
export const MAX_HOUSES = 36;

function buildSlots(
  x: number,
  baseY: number,
  cols: number,
  floors: number,
): WindowSlot[] {
  const slots: WindowSlot[] = [];
  for (let f = 0; f < floors; f++) {
    const y = baseY - PAD - WIN_H - f * FLOOR_H;
    for (let c = 0; c < cols; c++) {
      slots.push({ x: x + PAD + c * (WIN_W + WIN_GAP_X), y, w: WIN_W, h: WIN_H });
    }
  }
  return slots;
}

function widthFor(cols: number): number {
  return cols * WIN_W + (cols - 1) * WIN_GAP_X + PAD * 2;
}

function hashString(s: string): number {
  return hashParticipantId(s);
}

/**
 * Lay the city out along the ground line. Corporate + nonprofit towers go on
 * the left, sorted by cumulative attention (height encodes share); the
 * independent web is a low street of houses on the right, most recently lit
 * first. When the natural layout is wider than the canvas, the whole city is
 * compressed horizontally rather than dropping buildings.
 */
export function layoutSkyline(opts: {
  width: number;
  groundY: number;
  maxHeight: number;
  towers: TowerInput[];
  houses: HouseInput[];
}): SkylineLayout {
  const { width, groundY, maxHeight, towers, houses } = opts;

  const maxFloors = Math.max(3, Math.floor((maxHeight - 30) / FLOOR_H));
  const totalCum = towers.reduce((sum, t) => sum + t.cumEvents, 0) || 1;

  const buildings: Building[] = [];
  let x = MARGIN;

  const sortedTowers = [...towers].sort((a, b) => b.cumEvents - a.cumEvents);
  for (const t of sortedTowers) {
    const share = t.cumEvents / totalCum;
    const cols = t.occupants > 12 ? 5 : t.occupants > 6 ? 4 : 3;
    let floors = Math.round(3 + Math.sqrt(share) * 20);
    // A crowd always gets room: grow past the share-derived height if needed.
    floors = Math.max(floors, Math.ceil(t.occupants / cols));
    floors = Math.min(Math.max(floors, 3), maxFloors);

    const w = widthFor(cols);
    buildings.push({
      key: t.owner.id,
      owner: t.owner,
      label: t.owner.name,
      x,
      w,
      topY: groundY - (floors * FLOOR_H + PAD + WIN_GAP_Y),
      baseY: groundY,
      floors,
      cols,
      slots: buildSlots(x, groundY, cols, floors),
      seed: hashString(t.owner.id),
    });
    x += w + TOWER_GAP;
  }

  if (buildings.length > 0) x += STREET_GAP - TOWER_GAP;

  // Most recently lit houses first; the street trails off into the dark.
  const sortedHouses = [...houses]
    .sort((a, b) => b.lastTs - a.lastTs)
    .slice(0, MAX_HOUSES);
  let overflowDomains = Math.max(0, houses.length - sortedHouses.length);

  for (const h of sortedHouses) {
    const seed = hashString(h.domain);
    const cols = 2;
    let floors = 1 + (seed % 2);
    floors = Math.max(floors, Math.ceil(h.occupants / cols));
    floors = Math.min(floors, 4);
    const w = widthFor(cols);
    buildings.push({
      key: `indie:${h.domain}`,
      owner: { id: "indie", name: "the independent web", kind: "indie" },
      domain: h.domain,
      label: h.domain,
      x,
      w,
      topY: groundY - (floors * FLOOR_H + PAD + WIN_GAP_Y),
      baseY: groundY,
      floors,
      cols,
      slots: buildSlots(x, groundY, cols, floors),
      seed,
    });
    x += w + HOUSE_GAP;
  }

  const naturalWidth = x - HOUSE_GAP + MARGIN;
  let scale = 1;
  if (naturalWidth > width && buildings.length > 0) {
    scale = Math.max(0.45, (width - MARGIN) / naturalWidth);
    // Compress horizontally only: building x/width and window x/width scale,
    // floor heights stay legible.
    for (const b of buildings) {
      b.x *= scale;
      b.w *= scale;
      const slotW = WIN_W * scale;
      const gapX = WIN_GAP_X * scale;
      const pad = PAD * scale;
      let i = 0;
      for (let f = 0; f < b.floors; f++) {
        const y = b.baseY - PAD - WIN_H - f * FLOOR_H;
        for (let c = 0; c < b.cols; c++) {
          b.slots[i] = {
            x: b.x + pad + c * (slotW + gapX),
            y,
            w: slotW,
            h: WIN_H,
          };
          i++;
        }
      }
    }
    // If even compressed houses run past the edge, drop the trailing ones.
    const visible = buildings.filter((b) => b.x + b.w <= width - 4);
    overflowDomains += buildings.length - visible.length;
    buildings.length = 0;
    buildings.push(...visible);
  }

  return { buildings, overflowDomains, scale };
}
