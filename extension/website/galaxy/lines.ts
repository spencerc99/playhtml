// ABOUTME: Metro line contract, grouping-level stop resolution, and shared-segment offsets.
// ABOUTME: Also collapses a route's hops into ride segments so it can be narrated by line.

import type { GroupLevel, Route, RouteLeg } from "./graph-model";

// ---------------------------------------------------------------------------
// Data contract
// ---------------------------------------------------------------------------

export interface TransitLine {
  id: string;
  name: string;
  /** Hex colour from the generator, used verbatim so lines stay recognisable. */
  color: string;
  loop: boolean;
  /** Ordered domains. These are graph node ids, not necessarily visible stops. */
  stops: string[];
  /**
   * Lines sharing at least one edge with this one, when the generator supplies
   * it. Purely a hint: shared spans are always recomputed from the resolved
   * stop sequences, because grouping changes which spans actually coincide.
   */
  sharedWith?: string[];
}

export interface LineInterchange {
  domain: string;
  lines: string[];
}

export interface LinesMeta {
  generatedAt: string;
  [key: string]: unknown;
}

export interface LinesFile {
  meta: LinesMeta;
  lines: TransitLine[];
  interchanges: LineInterchange[];
}

/**
 * A line as it exists at one grouping level: its stops resolved to the stops
 * actually on screen, with runs that collapsed into a single stop folded away.
 */
export interface ResolvedLine {
  line: TransitLine;
  /** Visible stop ids in order, no two consecutive entries equal. */
  stops: string[];
  /**
   * Which underlying domains each visible stop stands for, in line order. A
   * collapsed run is why a ride can pass "through" stations that share a stop.
   */
  coveredBy: Map<string, string[]>;
  /** Parsed once so the renderer is not re-parsing hex every frame. */
  rgb: readonly [number, number, number];
}

/** One drawn span between two adjacent visible stops on a line. */
export interface LineSegment {
  lineId: string;
  from: string;
  to: string;
  /**
   * Lateral offset in multiples of the line gap, centred on zero. Lines sharing
   * a span fan out so their colours stay separable.
   */
  offset: number;
}

export interface LineIndex {
  resolved: ResolvedLine[];
  byId: Map<string, ResolvedLine>;
  /** Segment key `lo|hi` to the lines drawn on it, for edge de-duplication. */
  segments: Map<string, LineSegment[]>;
  /** Visible stop id to the lines calling there, in stable id order. */
  linesAtStop: Map<string, string[]>;
  /** Visible stop ids serving two or more lines. */
  interchangeStops: Set<string>;
  /** Membership test for the underlay: is this pair drawn as a line? */
  coveredEdges: Set<string>;
}

export function segmentKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Parse `#rrggbb`. Throws rather than silently drawing a line in black. */
export function parseHex(hex: string): readonly [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match || !match[1]) throw new Error(`line colour ${hex} is not #rrggbb`);
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function lineRgba(rgb: readonly [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * Lines are generated against ungrouped domains, but the map draws grouped
 * stops. Resolve each stop through the level's `stopOf` mapping — the same one
 * search and routing use — then drop consecutive repeats, which are runs of
 * stations that folded into a single stop at this level. A line whose stops all
 * collapse to one place has nothing left to draw and is dropped.
 */
export function buildLineIndex(
  level: GroupLevel,
  lines: readonly TransitLine[],
  /** How far apart parallel lines sit, in world units. */
  gap = 4.4,
): LineIndex {
  const resolved: ResolvedLine[] = [];
  const byId = new Map<string, ResolvedLine>();

  for (const line of lines) {
    const stops: string[] = [];
    const coveredBy = new Map<string, string[]>();
    for (const domain of line.stops) {
      const stopId = level.stopOf.get(domain);
      // A stop the crawl knows but this graph does not is a data error, not
      // something to paper over with a skipped station.
      if (stopId === undefined) {
        throw new Error(`line ${line.id} calls at ${domain}, which is not on the map`);
      }
      const covered = coveredBy.get(stopId);
      if (covered) covered.push(domain);
      else coveredBy.set(stopId, [domain]);
      if (stops[stops.length - 1] === stopId) continue;
      stops.push(stopId);
    }
    if (stops.length < 2) continue;
    const entry: ResolvedLine = {
      line,
      stops,
      coveredBy,
      rgb: parseHex(line.color),
    };
    resolved.push(entry);
    byId.set(line.id, entry);
  }

  // Sort by id so shared-span fan order — and therefore the drawn map — is the
  // same on every load regardless of file ordering.
  resolved.sort((a, b) => (a.line.id < b.line.id ? -1 : a.line.id > b.line.id ? 1 : 0));

  const segments = new Map<string, LineSegment[]>();
  const coveredEdges = new Set<string>();
  for (const entry of resolved) {
    for (let i = 0; i + 1 < entry.stops.length; i++) {
      const from = entry.stops[i];
      const to = entry.stops[i + 1];
      if (from === undefined || to === undefined) continue;
      const key = segmentKey(from, to);
      coveredEdges.add(key);
      const bucket = segments.get(key);
      const segment: LineSegment = { lineId: entry.line.id, from, to, offset: 0 };
      if (bucket) bucket.push(segment);
      else segments.set(key, [segment]);
    }
  }

  assignCorridorOrder(segments, gap);

  const linesAtStop = new Map<string, string[]>();
  for (const entry of resolved) {
    for (const stopId of entry.stops) {
      const list = linesAtStop.get(stopId);
      if (list) {
        if (!list.includes(entry.line.id)) list.push(entry.line.id);
      } else {
        linesAtStop.set(stopId, [entry.line.id]);
      }
    }
  }

  const interchangeStops = new Set<string>();
  for (const [stopId, ids] of linesAtStop) {
    if (ids.length >= 2) interchangeStops.add(stopId);
  }

  return { resolved, byId, segments, linesAtStop, interchangeStops, coveredEdges };
}

/**
 * Give every line a single side of each corridor and hold it for the whole
 * shared run, so ribbons stay parallel instead of braiding across each other.
 *
 * Assigning offsets span by span — the obvious approach — makes a line's index
 * depend on which OTHER lines happen to share that one span, so a line's offset
 * jumps whenever a neighbour joins or leaves. On screen that reads as lines
 * weaving through one another, which is exactly what a real transit map never
 * does.
 *
 * Instead every line gets one global rank, and each span simply sorts the lines
 * present by that rank. A swap pass orders the ranks so lines that share track
 * sit near each other, which is the cheap stand-in for the ILP a full metro-map
 * renderer would solve.
 */

/**
 * Widest a shared bundle may get, in world units. Past this the per-line gap
 * shrinks instead of the corridor growing, so a busy trunk stays a ribbon.
 */
const MAX_BUNDLE_WIDTH = 26;

function assignCorridorOrder(
  segments: Map<string, LineSegment[]>,
  gap: number,
): void {
  // Every line gets ONE rank for the whole map, and its side of any corridor is
  // read from that single rank. Deriving the side per corridor — even per
  // maximal shared run — still lets a line's slot jump wherever the set of
  // companions changes, which is precisely the braiding this must prevent.
  //
  // The rank is a global left-to-right ordering of all lines that ever share
  // track. Seeded by id so it is stable across loads, then improved by a swap
  // pass that pulls lines sharing corridors toward each other.
  const sharing = new Set<string>();
  for (const bucket of segments.values()) {
    if (bucket.length > 1) for (const s of bucket) sharing.add(s.lineId);
  }
  const ranked = [...sharing].sort();
  const order = reduceCrossings(ranked, [...segments.values()]);
  const rankOf = new Map<string, number>();
  order.forEach((id, i) => rankOf.set(id, i));

  for (const bucket of segments.values()) {
    if (bucket.length <= 1) {
      // A lone line sits exactly on its road.
      const only = bucket[0];
      if (only) only.offset = 0;
      continue;
    }
    // Order this span's lines by their GLOBAL rank, then centre the group on
    // the road. A line keeps the same neighbours-relative side everywhere it
    // runs, so ribbons stay parallel; only the group's width changes as lines
    // join or leave, which is what a real transit map does at a junction.
    const present = [...bucket].sort(
      (a, b) =>
        (rankOf.get(a.lineId) ?? 0) - (rankOf.get(b.lineId) ?? 0) ||
        (a.lineId < b.lineId ? -1 : 1),
    );
    // Squeeze the gap on very busy corridors. A bundle that keeps a fixed gap
    // per line grows without bound — twenty lines at full spacing is wider than
    // the stops it connects, and reads as a fan rather than a corridor.
    const spacing = Math.min(gap, MAX_BUNDLE_WIDTH / Math.max(1, present.length - 1));
    present.forEach((segment, i) => {
      segment.offset = (i - (present.length - 1) / 2) * spacing;
    });
  }
}

/**
 * Adjacent-swap pass over the global line order. Lines that run through the
 * same stops should sit near each other in the ordering, so where they share
 * track their ribbons are neighbours and can peel off without crossing the
 * whole bundle.
 *
 * Cost charges each pair that shares stops by how far apart the order puts
 * them; a swap is kept only when it lowers that total, and passes stop as soon
 * as one changes nothing, so this always terminates.
 */
function reduceCrossings(
  order: string[],
  buckets: LineSegment[][],
): string[] {
  // The stops each line touches anywhere it shares track. Two lines with many
  // stops in common belong side by side in the ordering.
  const exits = new Map<string, Set<string>>();
  for (const bucket of buckets) {
    if (bucket.length <= 1) continue;
    for (const segment of bucket) {
      let set = exits.get(segment.lineId);
      if (!set) {
        set = new Set<string>();
        exits.set(segment.lineId, set);
      }
      set.add(segment.from);
      set.add(segment.to);
    }
  }

  const cost = (candidate: string[]): number => {
    let total = 0;
    for (let i = 0; i < candidate.length; i++) {
      for (let j = i + 1; j < candidate.length; j++) {
        const a = exits.get(candidate[i] ?? "");
        const b = exits.get(candidate[j] ?? "");
        if (!a || !b) continue;
        // Lines that share no endpoint at all are strangers passing through;
        // keeping them apart costs nothing. Lines that share endpoints want to
        // be neighbours, so charge for the distance between them.
        let shared = 0;
        for (const stop of a) if (b.has(stop)) shared++;
        if (shared > 0) total += (j - i - 1) * shared;
      }
    }
    return total;
  };

  let best = [...order];
  let bestCost = cost(best);
  // Bounded: each pass is O(n^2) on a handful of lines, and we stop early.
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let i = 0; i + 1 < best.length; i++) {
      const swapped = [...best];
      const a = swapped[i];
      const b = swapped[i + 1];
      if (a === undefined || b === undefined) continue;
      swapped[i] = b;
      swapped[i + 1] = a;
      const next = cost(swapped);
      if (next < bestCost) {
        best = swapped;
        bestCost = next;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return best;
}

/**
 * Disambiguating labels. The generator names a line after its busiest station,
 * so several lines share a name ("are.na line" x4). Numbering them by their
 * termini would change as grouping collapses stops, so number by stable id
 * order instead and only where a name actually repeats.
 */
export function buildLineLabels(lines: readonly TransitLine[]): Map<string, string> {
  const byName = new Map<string, TransitLine[]>();
  for (const line of lines) {
    const bucket = byName.get(line.name);
    if (bucket) bucket.push(line);
    else byName.set(line.name, [line]);
  }
  const labels = new Map<string, string>();
  for (const [name, bucket] of byName) {
    if (bucket.length === 1) {
      const only = bucket[0];
      if (only) labels.set(only.id, name);
      continue;
    }
    const ordered = [...bucket].sort((a, b) => (a.id < b.id ? -1 : 1));
    ordered.forEach((line, i) => {
      labels.set(line.id, `${name} ${romanNumeral(i + 1)}`);
    });
  }
  return labels;
}

const NUMERALS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

function romanNumeral(n: number): string {
  return NUMERALS[n - 1] ?? String(n);
}

// ---------------------------------------------------------------------------
// Route narration
// ---------------------------------------------------------------------------

/**
 * One narrated piece of a trip: either a ride along a single line, or a walk
 * along roads that no line covers.
 */
export interface RouteSegment {
  kind: "ride" | "walk";
  /** Set for a ride. */
  lineId?: string;
  from: string;
  to: string;
  /** Every stop on this segment, endpoints included. */
  stops: string[];
  /** Hop count, which for a ride is the number of stations travelled. */
  hops: number;
}

/**
 * Which line, if any, carries a hop. A hop can be covered by several lines;
 * prefer the line the previous segment was already riding, so a trip that could
 * stay aboard is not narrated as a pointless transfer.
 */
function lineForHop(
  index: LineIndex,
  from: string,
  to: string,
  preferred: string | undefined,
): string | undefined {
  const bucket = index.segments.get(segmentKey(from, to));
  if (!bucket || bucket.length === 0) return undefined;
  if (preferred && bucket.some((s) => s.lineId === preferred)) return preferred;
  // Stable pick: segments were built in sorted line order.
  return bucket[0]?.lineId;
}

/**
 * Collapse consecutive hops on one line into a ride. Hops no line covers become
 * walk segments, so a mixed trip reads "walk, board, transfer, walk off".
 */
export function narrateRoute(
  index: LineIndex,
  legs: readonly RouteLeg[],
): RouteSegment[] {
  const segments: RouteSegment[] = [];
  for (const leg of legs) {
    const last = segments[segments.length - 1];
    const preferred = last?.kind === "ride" ? last.lineId : undefined;
    const lineId = lineForHop(index, leg.from, leg.to, preferred);
    const kind: "ride" | "walk" = lineId ? "ride" : "walk";
    if (
      last &&
      last.kind === kind &&
      last.lineId === lineId &&
      last.to === leg.from
    ) {
      last.to = leg.to;
      last.stops.push(leg.to);
      last.hops += 1;
      continue;
    }
    const segment: RouteSegment = {
      kind,
      from: leg.from,
      to: leg.to,
      stops: [leg.from, leg.to],
      hops: 1,
    };
    if (lineId) segment.lineId = lineId;
    segments.push(segment);
  }
  return segments;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Turn narrated segments into transit-app prose. `express` gives the collapsed
 * account; local additionally calls out every intermediate station.
 */
export function describeRoute(
  segments: readonly RouteSegment[],
  labels: ReadonlyMap<string, string>,
  express: boolean,
): string[] {
  const out: string[] = [];
  segments.forEach((segment, i) => {
    const previous = segments[i - 1];
    if (segment.kind === "walk") {
      out.push(
        i === 0
          ? `Walk from ${segment.from} to ${segment.to} (${plural(segment.hops, "hop")})`
          : `Walk to ${segment.to} (${plural(segment.hops, "hop")})`,
      );
      return;
    }
    const name = segment.lineId ? labels.get(segment.lineId) ?? "line" : "line";
    const board =
      previous?.kind === "ride"
        ? `Transfer at ${segment.from} to the ${name}`
        : `Board the ${name} at ${segment.from}`;
    out.push(`${board} — ride ${plural(segment.hops, "stop")} to ${segment.to}`);
    if (!express && segment.stops.length > 2) {
      out.push(`calling at: ${segment.stops.slice(1, -1).join(", ")}`);
    }
  });
  const last = segments[segments.length - 1];
  if (last) out.push(`Arrive ${last.to}`);
  return out;
}

/** One-line summary for the panel header: how many rides and transfers. */
export function summarizeRoute(segments: readonly RouteSegment[]): string {
  const rides = segments.filter((s) => s.kind === "ride").length;
  const walks = segments.filter((s) => s.kind === "walk").length;
  if (rides === 0) return `${plural(walks, "walking leg")}`;
  const transfers = Math.max(0, rides - 1);
  const parts = [plural(rides, "ride")];
  if (transfers > 0) parts.push(plural(transfers, "transfer"));
  if (walks > 0) parts.push(plural(walks, "walking leg"));
  return parts.join(", ");
}

/** Copyable text for a route, including line names and the routing mode. */
export function routeToText(
  segments: readonly RouteSegment[],
  labels: ReadonlyMap<string, string>,
  route: Pick<Route, "distance" | "mode">,
  express: boolean,
): string {
  const lines = describeRoute(segments, labels, express);
  const suffix = `(${summarizeRoute(segments)}, distance ${route.distance.toFixed(
    2,
  )}, via ${route.mode}${express ? "" : ", local"})`;
  return [...lines, suffix].join("\n");
}
