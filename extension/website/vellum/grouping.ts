// ABOUTME: Groups raw cursor/viewport/navigation events into VellumSheets per the configured grouping mode.
// ABOUTME: Filters sparse groups, ranks survivors by activity, then orders them oldest-first for stacking.
import type { CollectionEvent } from "../shared/types";
import { extractDomain } from "../shared/utils/eventUtils";
import type { VellumSettings } from "./settings";
import type { VellumSheet } from "./types";

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function localDay(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatClock(ts: number): { hm: string; period: "am" | "pm" } {
  const d = new Date(ts);
  let hours = d.getHours();
  const minutes = d.getMinutes();
  const period: "am" | "pm" = hours >= 12 ? "pm" : "am";
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return { hm: `${hours}:${String(minutes).padStart(2, "0")}`, period };
}

/** Compact time-range label like "3:12–3:40 pm" — the am/pm suffix is only
 * repeated when it differs between the start and end of the range. */
function formatTimeRange(startTs: number, endTs: number): string {
  const start = formatClock(startTs);
  const end = formatClock(endTs);
  if (start.hm === end.hm && start.period === end.period) {
    return `${start.hm} ${start.period}`;
  }
  if (start.period === end.period) {
    return `${start.hm}–${end.hm} ${end.period}`;
  }
  return `${start.hm} ${start.period}–${end.hm} ${end.period}`;
}

interface GroupAccumulator {
  key: string;
  domain: string;
  /** Representative URL for this group — the first event's URL. For
   * page-visit grouping this is the group's single URL; for domain/day
   * grouping (which spans many pages) it's just "a" page in that group, used
   * as PagePlate's best-effort iframe target. */
  url: string;
  cursorEvents: CollectionEvent[];
  viewportEvents: CollectionEvent[];
  navigationEvents: CollectionEvent[];
}

function keyForEvent(
  event: CollectionEvent,
  groupingMode: VellumSettings["groupingMode"],
): { key: string; domain: string; url: string } {
  const url = event.meta?.url ?? "";
  const domain = event.domain ?? extractDomain(url);
  switch (groupingMode) {
    case "domain":
      return { key: domain || "unknown", domain, url };
    case "day":
      return { key: localDay(event.ts), domain, url };
    case "page-visit":
    default:
      return {
        key: `${event.meta?.pid ?? ""}|${event.meta?.sid ?? ""}|${url}`,
        domain,
        url,
      };
  }
}

/** Best-effort page title for a group: the most recent navigation event's
 * `data.title` whose URL matches the group (page-visit mode only — domain/day
 * groups span many URLs, so any navigation event in the group qualifies). */
function bestTitle(
  group: GroupAccumulator,
  groupingMode: VellumSettings["groupingMode"],
): string | undefined {
  let title: string | undefined;
  let bestTs = -Infinity;
  for (const nav of group.navigationEvents) {
    if (groupingMode === "page-visit" && nav.meta?.url !== group.url) continue;
    const data = nav.data as unknown as Record<string, unknown> | undefined;
    const navTitle = typeof data?.title === "string" ? (data.title as string) : undefined;
    if (navTitle && nav.ts >= bestTs) {
      title = navTitle;
      bestTs = nav.ts;
    }
  }
  return title;
}

export function buildSheets(
  events: CollectionEvent[],
  settings: Pick<VellumSettings, "groupingMode" | "maxSheets" | "minEventsPerSheet">,
): VellumSheet[] {
  const groups = new Map<string, GroupAccumulator>();

  for (const event of events) {
    if (event.type !== "cursor" && event.type !== "viewport" && event.type !== "navigation") {
      continue;
    }
    const { key, domain, url } = keyForEvent(event, settings.groupingMode);
    let group = groups.get(key);
    if (!group) {
      group = { key, domain, url, cursorEvents: [], viewportEvents: [], navigationEvents: [] };
      groups.set(key, group);
    }
    if (event.type === "cursor") group.cursorEvents.push(event);
    else if (event.type === "viewport") group.viewportEvents.push(event);
    else group.navigationEvents.push(event);
  }

  const sheets: VellumSheet[] = [];
  for (const group of groups.values()) {
    const eventCount = group.cursorEvents.length + group.viewportEvents.length;
    if (eventCount < settings.minEventsPerSheet) continue;

    const allTimed = [...group.cursorEvents, ...group.viewportEvents, ...group.navigationEvents];
    if (allTimed.length === 0) continue;
    // Plain loop rather than Math.min(...allTimed.map(...)): a day-grouping
    // group can hold tens of thousands of cursor events, and spreading that
    // many arguments into Math.min/max risks a call-stack RangeError.
    let startTs = Infinity;
    let endTs = -Infinity;
    for (const e of allTimed) {
      if (e.ts < startTs) startTs = e.ts;
      if (e.ts > endTs) endTs = e.ts;
    }
    const domain = group.domain || "unknown";
    const title = bestTitle(group, settings.groupingMode);

    let label: string;
    let sublabel: string;
    if (settings.groupingMode === "day") {
      label = group.key;
      sublabel = `${eventCount} events`;
    } else if (settings.groupingMode === "domain") {
      label = domain;
      sublabel = `${eventCount} events`;
    } else {
      label = domain;
      sublabel = formatTimeRange(startTs, endTs);
    }

    sheets.push({
      id: group.key,
      label,
      sublabel,
      url: group.url,
      domain,
      title,
      cursorEvents: group.cursorEvents,
      viewportEvents: group.viewportEvents,
      startTs,
      endTs,
      eventCount,
      seed: hashString(group.key),
    });
  }

  // Rank by activity and keep the top `maxSheets`, then re-order the KEPT
  // sheets oldest-first so the stack renders with the oldest sheet on the
  // bottom (index 0) and the newest on top.
  sheets.sort((a, b) => b.eventCount - a.eventCount);
  const kept = sheets.slice(0, Math.max(0, settings.maxSheets));
  kept.sort((a, b) => a.startTs - b.startTs);
  return kept;
}
