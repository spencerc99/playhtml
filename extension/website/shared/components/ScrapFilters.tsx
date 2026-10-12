// ABOUTME: Filters scraps by where (kept or hidden sites) and when they were found, their kind and shape, and an always-visible search field.
// ABOUTME: Lays out as one bar or as two drawer rows; popovers anchor to their chip and return focus.

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ScrapItem } from "./ScrapCollage";
import {
  extractDomain,
  formatFilterChip,
  parseFilterChip,
} from "../utils/eventUtils";
import {
  ANY_TIME,
  isAnyTime,
  matchesScrapFilters,
  matchesScrapWhen,
  scrapDays,
  scrapLocations,
  scrapShape,
  scrapSightings,
  type ScrapPlace,
  type ScrapShape,
  type ScrapWhenFilter,
} from "../utils/scrapFilters";
import type { TimeOfDayFilter } from "../config";
import { formatTimeOfDay, localDayKey } from "../utils/timeOfDay";
import { DAY_GRID_WIDTH, DayGrid } from "./DayGrid";
import { TimeOfDayInputs } from "./TimeOfDayInputs";

export { ANY_TIME, isAnyTime, type ScrapPlace, type ScrapWhenFilter };

/** The scrap kinds to show; an empty list shows every kind. */
export type ScrapKindFilter = ScrapItem["kind"][];

type KindOption = ScrapItem["kind"] | "all";

/** The scrap shapes to show; an empty list shows every shape. */
export type ScrapShapeFilter = ScrapShape[];

/** Each shape with the proportions of the rectangle drawn for it, widest first. */
const shapes: {
  shape: ScrapShape;
  label: string;
  width: number;
  height: number;
}[] = [
  { shape: "very-wide", label: "very wide", width: 16, height: 6 },
  { shape: "wide", label: "wide", width: 15, height: 10 },
  { shape: "square", label: "square", width: 12, height: 12 },
  { shape: "tall", label: "tall", width: 10, height: 15 },
  { shape: "very-tall", label: "very tall", width: 6, height: 16 },
];

/** A shape drawn as an outlined rectangle centred in a square box. */
function ShapeIcon({
  width,
  height,
  size,
}: {
  width: number;
  height: number;
  size: number;
}) {
  return (
    <svg
      className="scrap-filters__shape-icon"
      viewBox="0 0 18 18"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <rect
        x={(18 - width) / 2}
        y={(18 - height) / 2}
        width={width}
        height={height}
        rx="1"
        fill="currentColor"
        fillOpacity="var(--scrap-filters-shape-fill, 0)"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

/** An eye with a slash through it, for hiding a site's scraps. */
function HideIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path
        d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <circle
        cx="8"
        cy="8"
        r="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <path d="m2.5 13.5 11-11" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

const kinds: { kind: KindOption; label: string }[] = [
  { kind: "all", label: "all" },
  { kind: "image", label: "images" },
  { kind: "button", label: "buttons" },
  { kind: "svg-icon", label: "icons" },
  { kind: "heading", label: "headings" },
  { kind: "cursor", label: "cursors" },
];

/** Quarter-day windows in local time, offered as starting points for the time of day. */
const timesOfDay: { label: string; window: TimeOfDayFilter }[] = [
  { label: "night", window: { centerMinutes: 180, radiusMinutes: 180 } },
  { label: "morning", window: { centerMinutes: 540, radiusMinutes: 180 } },
  { label: "afternoon", window: { centerMinutes: 900, radiusMinutes: 180 } },
  { label: "evening", window: { centerMinutes: 1260, radiusMinutes: 180 } },
];

/** Whether a scrap passes every filter at once, shared by each surface that filters scraps. */
export function scrapPassesFilters(
  item: ScrapItem,
  kind: ScrapKindFilter,
  shape: ScrapShapeFilter,
  places: ScrapPlace[],
  search: string,
  when: ScrapWhenFilter,
): boolean {
  return (
    (kind.length === 0 || kind.includes(item.kind)) &&
    matchesShape(item, shape) &&
    matchesScrapFilters(item, places, search) &&
    matchesScrapWhen(item, when)
  );
}

function matchesShape(item: ScrapItem, shape: ScrapShapeFilter): boolean {
  if (shape.length === 0) return true;
  const itemShape = scrapShape(item);
  return itemShape !== null && shape.includes(itemShape);
}

/** The chip's short summary of a day and time-of-day filter, naming a quarter-day window when it is one. */
export function formatScrapWhen(when: ScrapWhenFilter): string {
  const { day, timeOfDay } = when;
  const parts = [
    day === null
      ? null
      : new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        }),
    timeOfDay === null
      ? null
      : (timesOfDay.find(
          (option) =>
            option.window.centerMinutes === timeOfDay.centerMinutes &&
            option.window.radiusMinutes === timeOfDay.radiusMinutes,
        )?.label ?? formatTimeOfDay(timeOfDay)),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "any time" : parts.join(" · ");
}

interface Props {
  items: readonly ScrapItem[];
  /** Sites to keep scraps from, and sites (marked `exclude`) to hide them from. */
  places: ScrapPlace[];
  onPlaces: (places: ScrapPlace[]) => void;
  kind: ScrapKindFilter;
  onKind: (kind: ScrapKindFilter) => void;
  shape: ScrapShapeFilter;
  onShape: (shape: ScrapShapeFilter) => void;
  search: string;
  onSearch: (search: string) => void;
  /** The local day and time of day a scrap must have been seen at. */
  when: ScrapWhenFilter;
  onWhen: (when: ScrapWhenFilter) => void;
  /** How many scraps match every filter, shown in the search field while a query is typed. */
  matchCount?: number;
  /** Counts a group of scraps, so a surface that folds repeats counts each scrap once. */
  countScraps?: (items: ScrapItem[]) => number;
  /** "bar" keeps search and chips on one line; "drawer" puts the chips on a second row. */
  layout?: "bar" | "drawer";
  /** Which side of its chip a popover opens on. */
  placement?: "above" | "below";
  /** Sits beside the search field in the drawer layout. */
  searchAccessory?: ReactNode;
  /** Sits at the far end of the chip row in the drawer layout. */
  chipsAccessory?: ReactNode;
}

type Panel = "places" | "type" | "shape" | "when";

/**
 * A phone: a finger on a screen too narrow for the chips to sit beside the
 * search field. There the chips fold behind one "filters" chip, so the search
 * and the scraps under it keep the room.
 */
const PHONE_QUERY = "(pointer: coarse) and (max-width: 619px)";

function usePhoneFilters(): boolean {
  const matches = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(PHONE_QUERY).matches;
  const [phone, setPhone] = useState(matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(PHONE_QUERY);
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
}

const countEach = (group: ScrapItem[]) => group.length;

export function ScrapFilters({
  items,
  places,
  onPlaces,
  kind,
  onKind,
  shape,
  onShape,
  search,
  onSearch,
  when,
  onWhen,
  matchCount,
  countScraps = countEach,
  layout = "bar",
  placement = "above",
  searchAccessory,
  chipsAccessory,
}: Props) {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [draft, setDraft] = useState("");
  const phone = usePhoneFilters();
  const [chipsOpen, setChipsOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const placeAnchor = useRef<HTMLSpanElement>(null);
  const typeAnchor = useRef<HTMLSpanElement>(null);
  const placeButton = useRef<HTMLButtonElement>(null);
  const typeButton = useRef<HTMLButtonElement>(null);
  const shapeAnchor = useRef<HTMLSpanElement>(null);
  const shapeButton = useRef<HTMLButtonElement>(null);
  const shapeOptions = useRef<HTMLDivElement>(null);
  const whenAnchor = useRef<HTMLSpanElement>(null);
  const whenButton = useRef<HTMLButtonElement>(null);
  const whenPanel = useRef<HTMLElement>(null);
  const placeInput = useRef<HTMLInputElement>(null);
  /** A site row's button to hand focus back to once toggling it has moved it. */
  const refocusPlace = useRef<{ label: string; hide: boolean } | null>(null);
  const typeOptions = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const popover = useRef<HTMLElement>(null);
  const id = useId();

  const itemDomains = (item: ScrapItem) =>
    new Set(
      scrapLocations(item)
        .map((source) => extractDomain(source.pageUrl))
        .filter(Boolean),
    );
  // Sites are listed by when a scrap was last met there, newest first.
  const domains = useMemo(() => {
    const lastSeen = new Map<string, number>();
    for (const item of items) {
      for (const location of scrapLocations(item)) {
        const domain = extractDomain(location.pageUrl);
        if (!domain) continue;
        lastSeen.set(domain, Math.max(lastSeen.get(domain) ?? 0, location.ts));
      }
    }
    return Array.from(lastSeen.keys()).sort(
      (a, b) => lastSeen.get(b)! - lastSeen.get(a)! || a.localeCompare(b),
    );
  }, [items]);
  // Counts answer "how many would I see if I picked this", so each facet
  // honours the other filters but not its own.
  const domainCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (panel !== "places") return counts;
    for (const domain of domains) counts.set(domain, 0);
    const byDomain = new Map<string, ScrapItem[]>();
    for (const item of items) {
      if (!scrapPassesFilters(item, kind, shape, [], search, when)) continue;
      for (const domain of itemDomains(item)) {
        const group = byDomain.get(domain) ?? [];
        group.push(item);
        byDomain.set(domain, group);
      }
    }
    for (const [domain, group] of byDomain)
      counts.set(domain, countScraps(group));
    return counts;
  }, [panel, items, domains, kind, shape, search, when, countScraps]);
  const kindCounts = useMemo(() => {
    const counts = new Map<KindOption, number>();
    if (panel !== "type") return counts;
    const matching = items.filter((item) =>
      scrapPassesFilters(item, [], shape, places, search, when),
    );
    counts.set("all", countScraps(matching));
    for (const option of kinds) {
      if (option.kind === "all") continue;
      counts.set(
        option.kind,
        countScraps(matching.filter((item) => item.kind === option.kind)),
      );
    }
    return counts;
  }, [panel, items, shape, places, search, when, countScraps]);
  const shapeCounts = useMemo(() => {
    const counts = new Map<ScrapShape, number>();
    if (panel !== "shape") return counts;
    const matching = items.filter((item) =>
      scrapPassesFilters(item, kind, [], places, search, when),
    );
    for (const option of shapes) {
      counts.set(
        option.shape,
        countScraps(
          matching.filter((item) => scrapShape(item) === option.shape),
        ),
      );
    }
    return counts;
  }, [panel, items, kind, places, search, when, countScraps]);
  // Every day anything was seen stays in the grid, so narrowing another
  // filter thins a day's texture rather than moving the calendar around.
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (panel !== "when") return counts;
    for (const item of items)
      for (const ts of scrapSightings(item)) counts.set(localDayKey(ts), 0);
    const byDay = new Map<string, ScrapItem[]>();
    for (const item of items) {
      if (!scrapPassesFilters(item, kind, shape, places, search, ANY_TIME))
        continue;
      for (const day of scrapDays(item, when.timeOfDay)) {
        const group = byDay.get(day) ?? [];
        group.push(item);
        byDay.set(day, group);
      }
    }
    for (const [day, group] of byDay) counts.set(day, countScraps(group));
    return counts;
  }, [panel, items, kind, shape, places, search, when.timeOfDay, countScraps]);

  const kept = places.filter((place) => !place.exclude).map(formatFilterChip);
  const hidden = places.filter((place) => place.exclude).map(formatFilterChip);
  const selected = [...kept, ...hidden];
  const candidate = parseFilterChip(draft);
  candidate.domain = candidate.domain.toLowerCase();
  const candidateLabel = formatFilterChip(candidate);
  const query = draft.toLowerCase().trim();
  const matchesDraft = (value: string) => value.toLowerCase().includes(query);
  const pinned = selected.filter(matchesDraft);
  const rest = domains.filter(
    (domain) => !selected.includes(domain) && matchesDraft(domain),
  );
  const listed = [...pinned, ...rest];
  /** Keeps, hides, or (with null) forgets a site, replacing whatever it was. */
  const setPlace = (label: string, state: "keep" | "hide" | null) => {
    const others = places.filter((place) => formatFilterChip(place) !== label);
    if (state === null) onPlaces(others);
    else
      onPlaces([
        ...others,
        state === "hide"
          ? { ...parseFilterChip(label), exclude: true }
          : parseFilterChip(label),
      ]);
  };
  // Toggling a site moves its row between the picked and unpicked groups,
  // which drops focus to the page; put it back so the keyboard stays here.
  useEffect(() => {
    const target = refocusPlace.current;
    if (target === null) return;
    refocusPlace.current = null;
    Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>(
        target.hide ? "[data-place-hide]" : "[data-place]",
      ) ?? [],
    )
      .find(
        (row) => (row.dataset.place ?? row.dataset.placeHide) === target.label,
      )
      ?.focus();
  });
  const panelButton = {
    places: placeButton,
    type: typeButton,
    shape: shapeButton,
    when: whenButton,
  };
  const panelAnchor = {
    places: placeAnchor,
    type: typeAnchor,
    shape: shapeAnchor,
    when: whenAnchor,
  };
  const close = () => {
    if (panel) panelButton[panel].current?.focus();
    setPanel(null);
  };

  useEffect(() => {
    if (panel === "places") placeInput.current?.focus();
    if (panel === "type")
      typeOptions.current
        ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?.focus();
    if (panel === "shape")
      (
        shapeOptions.current?.querySelector<HTMLButtonElement>(
          '[aria-pressed="true"]',
        ) ?? shapeOptions.current?.querySelector<HTMLButtonElement>("button")
      )?.focus();
    if (panel === "when")
      (
        whenPanel.current?.querySelector<HTMLElement>(
          '[role="button"][aria-pressed="true"]',
        ) ?? whenPanel.current?.querySelector<HTMLElement>("button")
      )?.focus({ preventScroll: true });
    if (!panel) return;
    const anchor = panelAnchor[panel].current;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !anchor?.contains(event.target))
        setPanel(null);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [panel]);

  // A popover is anchored to its chip, then slid sideways just enough to stay
  // inside the drawer, or inside the window when it floats over the page. A
  // pick can relabel a chip and move it onto another row, so it is measured
  // again after each one.
  useLayoutEffect(() => {
    const element = popover.current;
    if (!element || !root.current) return;
    element.style.setProperty("--scrap-filters-nudge", "0px");
    const rootBounds = root.current.getBoundingClientRect();
    const margin = layout === "drawer" ? 0 : 8;
    const left = layout === "drawer" ? rootBounds.left : 0;
    const right = layout === "drawer" ? rootBounds.right : window.innerWidth;
    if (layout === "drawer" && rootBounds.width > 0)
      element.style.maxWidth = `${rootBounds.width}px`;
    const bounds = element.getBoundingClientRect();
    let nudge = 0;
    if (bounds.right > right - margin) nudge = right - margin - bounds.right;
    if (bounds.left + nudge < left + margin)
      nudge = left + margin - bounds.left;
    element.style.setProperty("--scrap-filters-nudge", `${nudge}px`);
  }, [panel, layout, places, kind, shape, when]);

  const countSites = (labels: string[]) =>
    labels.length === 1 ? labels[0] : `${labels.length} sites`;
  const siteLabel =
    selected.length === 0
      ? "anywhere"
      : [
          kept.length > 0 ? countSites(kept) : null,
          hidden.length > 0 ? `not ${countSites(hidden)}` : null,
        ]
          .filter(Boolean)
          .join(", ");
  const kindLabel =
    kind.length === 0
      ? "all"
      : kind.length <= 2
        ? kinds
            .filter(
              (option) => option.kind !== "all" && kind.includes(option.kind),
            )
            .map((option) => option.label)
            .join(", ")
        : `${kind.length} types`;
  const toggleKind = (option: KindOption) => {
    if (option === "all") {
      onKind([]);
      return;
    }
    const next = kind.includes(option)
      ? kind.filter((value) => value !== option)
      : [...kind, option];
    // Picking every kind is the same as picking none.
    onKind(next.length === kinds.length - 1 ? [] : next);
  };

  const pickedShapes = shapes.filter((option) => shape.includes(option.shape));
  const toggleShape = (option: ScrapShape) => {
    const next = shape.includes(option)
      ? shape.filter((value) => value !== option)
      : [...shape, option];
    // Picking every shape is the same as picking none.
    onShape(next.length === shapes.length ? [] : next);
  };

  const searchField = (
    <label className="scrap-filters__search">
      <svg
        className="scrap-filters__icon"
        viewBox="0 0 16 16"
        width="12"
        height="12"
        aria-hidden="true"
      >
        <circle
          cx="6.5"
          cy="6.5"
          r="4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="m10 10 4.5 4.5" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <input
        ref={searchInput}
        aria-label="Search scraps"
        placeholder="search words, titles, urls"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && search) {
            event.preventDefault();
            event.stopPropagation();
            onSearch("");
          }
        }}
      />
      {search && (
        <>
          {matchCount !== undefined && (
            <span
              className="scrap-filters__matches"
              aria-label={`${matchCount} matching scraps`}
            >
              {matchCount}
            </span>
          )}
          <button
            type="button"
            className="scrap-filters__clear"
            aria-label="Clear search"
            onClick={() => {
              onSearch("");
              searchInput.current?.focus();
            }}
          >
            ×
          </button>
        </>
      )}
    </label>
  );

  const caret = (
    <span
      className={`scrap-filters__caret scrap-filters__caret--${placement}`}
      aria-hidden="true"
    />
  );

  const placesChip = (
    <span className="scrap-filters__anchor" ref={placeAnchor}>
      <button
        type="button"
        ref={placeButton}
        className="scrap-filters__chip"
        data-on={selected.length > 0 || undefined}
        aria-expanded={panel === "places"}
        aria-controls={`${id}-places`}
        onClick={() => setPanel(panel === "places" ? null : "places")}
      >
        <span className="scrap-filters__key">from</span>
        <span className="scrap-filters__value">{siteLabel}</span>
        <span className="scrap-filters__more" aria-hidden="true">
          ▾
        </span>
      </button>
      {panel === "places" && (
        <>
          {caret}
          <section
            ref={popover}
            id={`${id}-places`}
            className={`scrap-filters__popover scrap-filters__popover--places scrap-filters__popover--${placement}`}
            aria-label="Found on filters"
          >
            <div className="scrap-filters__heading">
              <span>found on</span>
              <button
                type="button"
                className="scrap-filters__link"
                onClick={() => onPlaces([])}
              >
                clear
              </button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (candidateLabel && !selected.includes(candidateLabel)) {
                  onPlaces([...places, candidate]);
                  setDraft("");
                }
              }}
            >
              <label className="scrap-filters__find">
                <svg
                  className="scrap-filters__icon"
                  viewBox="0 0 16 16"
                  width="11"
                  height="11"
                  aria-hidden="true"
                >
                  <circle
                    cx="6.5"
                    cy="6.5"
                    r="4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                  <path
                    d="m10 10 4.5 4.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
                <input
                  ref={placeInput}
                  aria-label="Find a domain or page"
                  placeholder="site or page url"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              </label>
              {candidateLabel && !listed.includes(candidateLabel) && (
                <div className="scrap-filters__place">
                  <button type="submit" className="scrap-filters__option">
                    <span className="scrap-filters__name">
                      Use {candidateLabel}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="scrap-filters__hide"
                    aria-label={`Hide ${candidateLabel}`}
                    title={`hide scraps from ${candidateLabel}`}
                    onClick={() => {
                      setPlace(candidateLabel, "hide");
                      setDraft("");
                    }}
                  >
                    <HideIcon />
                  </button>
                </div>
              )}
            </form>
            <div className="scrap-filters__options">
              {pinned.map((domain) => placeRow(domain))}
              {pinned.length > 0 && rest.length > 0 && (
                <hr className="scrap-filters__separator" />
              )}
              {rest.map((domain) => placeRow(domain))}
              {listed.length === 0 && (
                <p className="scrap-filters__empty">no sites match</p>
              )}
            </div>
          </section>
        </>
      )}
    </span>
  );

  function placeRow(domain: string) {
    const count = domainCounts.get(domain);
    const on = kept.includes(domain);
    const off = hidden.includes(domain);
    return (
      <div
        className="scrap-filters__place"
        key={domain}
        data-hidden={off || undefined}
      >
        <button
          type="button"
          className="scrap-filters__option"
          data-place={domain}
          aria-pressed={on}
          title={off ? `show scraps from ${domain} again` : undefined}
          onClick={() => {
            refocusPlace.current = { label: domain, hide: false };
            setPlace(domain, on || off ? null : "keep");
          }}
        >
          <span className="scrap-filters__check" aria-hidden="true">
            {on ? "✓" : ""}
          </span>
          <span className="scrap-filters__name">{domain}</span>
          {count !== undefined && (
            <span className="scrap-filters__count">{count}</span>
          )}
        </button>
        <button
          type="button"
          className="scrap-filters__hide"
          data-place-hide={domain}
          aria-pressed={off}
          aria-label={`Hide ${domain}`}
          title={
            off
              ? `show scraps from ${domain} again`
              : `hide scraps from ${domain}`
          }
          onClick={() => {
            refocusPlace.current = { label: domain, hide: true };
            setPlace(domain, off ? null : "hide");
          }}
        >
          <HideIcon />
        </button>
      </div>
    );
  }

  const typeChip = (
    <span className="scrap-filters__anchor" ref={typeAnchor}>
      <button
        type="button"
        ref={typeButton}
        className="scrap-filters__chip"
        data-on={kind.length > 0 || undefined}
        aria-expanded={panel === "type"}
        aria-controls={`${id}-type`}
        onClick={() => setPanel(panel === "type" ? null : "type")}
      >
        <span className="scrap-filters__key">type</span>
        <span className="scrap-filters__value">{kindLabel}</span>
        <span className="scrap-filters__more" aria-hidden="true">
          ▾
        </span>
      </button>
      {panel === "type" && (
        <>
          {caret}
          <section
            ref={popover}
            id={`${id}-type`}
            className={`scrap-filters__popover scrap-filters__popover--type scrap-filters__popover--${placement}`}
            aria-label="Scrap types"
          >
            <div className="scrap-filters__heading">
              <span>type</span>
            </div>
            <div className="scrap-filters__options" ref={typeOptions}>
              {kinds.map((option) => {
                const on =
                  option.kind === "all"
                    ? kind.length === 0
                    : kind.includes(option.kind);
                return (
                  <div key={option.kind} className="scrap-filters__kind">
                    <button
                      type="button"
                      className="scrap-filters__option"
                      data-scrap-kind={option.kind}
                      aria-pressed={on}
                      onClick={() => toggleKind(option.kind)}
                    >
                      <span className="scrap-filters__check" aria-hidden="true">
                        {on ? "✓" : ""}
                      </span>
                      <span className="scrap-filters__name">
                        {option.label}
                      </span>
                      <span className="scrap-filters__count">
                        {kindCounts.get(option.kind)}
                      </span>
                    </button>
                    {option.kind === "all" && (
                      <hr className="scrap-filters__separator" />
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </span>
  );

  const shapeChip = (
    <span className="scrap-filters__anchor" ref={shapeAnchor}>
      <button
        type="button"
        ref={shapeButton}
        className="scrap-filters__chip"
        data-on={shape.length > 0 || undefined}
        aria-expanded={panel === "shape"}
        aria-controls={`${id}-shape`}
        onClick={() => setPanel(panel === "shape" ? null : "shape")}
      >
        <span className="scrap-filters__key">shape</span>
        {pickedShapes.length === 0 ? (
          <span className="scrap-filters__value">any</span>
        ) : (
          <span
            className="scrap-filters__value scrap-filters__shapes-picked"
            aria-label={pickedShapes.map((option) => option.label).join(", ")}
          >
            {pickedShapes.map((option) => (
              <ShapeIcon
                key={option.shape}
                width={option.width}
                height={option.height}
                size={13}
              />
            ))}
          </span>
        )}
        <span className="scrap-filters__more" aria-hidden="true">
          ▾
        </span>
      </button>
      {panel === "shape" && (
        <>
          {caret}
          <section
            ref={popover}
            id={`${id}-shape`}
            className={`scrap-filters__popover scrap-filters__popover--shape scrap-filters__popover--${placement}`}
            aria-label="Scrap shapes"
          >
            <div className="scrap-filters__heading">
              <span>shape</span>
              <button
                type="button"
                className="scrap-filters__link"
                onClick={() => onShape([])}
              >
                clear
              </button>
            </div>
            <div className="scrap-filters__shapes" ref={shapeOptions}>
              {shapes.map((option) => (
                <button
                  key={option.shape}
                  type="button"
                  className="scrap-filters__shape"
                  data-scrap-shape={option.shape}
                  aria-pressed={shape.includes(option.shape)}
                  aria-label={`${option.label}, ${shapeCounts.get(option.shape) ?? 0} scraps`}
                  title={option.label}
                  onClick={() => toggleShape(option.shape)}
                >
                  <ShapeIcon
                    width={option.width}
                    height={option.height}
                    size={24}
                  />
                  <span className="scrap-filters__count">
                    {shapeCounts.get(option.shape)}
                  </span>
                </button>
              ))}
            </div>
          </section>
        </>
      )}
    </span>
  );

  const whenOn = !isAnyTime(when);
  const whenChip = (
    <span className="scrap-filters__anchor" ref={whenAnchor}>
      <button
        type="button"
        ref={whenButton}
        className="scrap-filters__chip"
        data-on={whenOn || undefined}
        aria-expanded={panel === "when"}
        aria-controls={`${id}-when`}
        onClick={() => setPanel(panel === "when" ? null : "when")}
      >
        <span className="scrap-filters__key">when</span>
        <span className="scrap-filters__value">{formatScrapWhen(when)}</span>
        <span className="scrap-filters__more" aria-hidden="true">
          ▾
        </span>
      </button>
      {panel === "when" && (
        <>
          {caret}
          <section
            ref={(node) => {
              popover.current = node;
              whenPanel.current = node;
            }}
            id={`${id}-when`}
            className={`scrap-filters__popover scrap-filters__popover--when scrap-filters__popover--${placement}`}
            aria-label="When found"
          >
            <div className="scrap-filters__heading">
              <span>day</span>
              <button
                type="button"
                className="scrap-filters__link"
                onClick={() => onWhen(ANY_TIME)}
              >
                clear
              </button>
            </div>
            {dayCounts.size === 0 ? (
              <p className="scrap-filters__empty">no days yet</p>
            ) : (
              <DayGrid
                dayCounts={dayCounts}
                selectedDay={when.day}
                onSelectDay={(day) => onWhen({ ...when, day })}
                style={{
                  flex: "none",
                  maxHeight: "min(170px, 28vh)",
                  padding: 0,
                }}
              />
            )}
            <div className="scrap-filters__heading scrap-filters__heading--time">
              <span>time of day</span>
            </div>
            <div className="scrap-filters__times">
              {timesOfDay.map((option) => {
                const on =
                  when.timeOfDay !== null &&
                  when.timeOfDay.centerMinutes ===
                    option.window.centerMinutes &&
                  when.timeOfDay.radiusMinutes === option.window.radiusMinutes;
                return (
                  <button
                    key={option.label}
                    type="button"
                    className="scrap-filters__time"
                    aria-pressed={on}
                    title={formatTimeOfDay(option.window)}
                    onClick={() =>
                      onWhen({ ...when, timeOfDay: on ? null : option.window })
                    }
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {when.timeOfDay !== null && (
              <div
                className="scrap-filters__window"
                title="Recurring time-of-day window (local time), across every day"
              >
                <TimeOfDayInputs
                  value={when.timeOfDay}
                  onChange={(timeOfDay) => onWhen({ ...when, timeOfDay })}
                />
                <button
                  type="button"
                  className="scrap-filters__clear"
                  aria-label="Clear time of day"
                  onClick={() => onWhen({ ...when, timeOfDay: null })}
                >
                  ×
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </span>
  );

  const activeFilters =
    (places.length > 0 ? 1 : 0) +
    (kind.length > 0 ? 1 : 0) +
    (shape.length > 0 ? 1 : 0) +
    (isAnyTime(when) ? 0 : 1);
  const filtersToggle = (
    <button
      type="button"
      className="scrap-filters__chip scrap-filters__toggle"
      aria-expanded={chipsOpen}
      aria-pressed={activeFilters > 0}
      onClick={() => {
        if (chipsOpen) close();
        setChipsOpen(!chipsOpen);
      }}
    >
      <span className="scrap-filters__key">filters</span>
      {activeFilters > 0 && (
        <span className="scrap-filters__value">{activeFilters}</span>
      )}
      <span className="scrap-filters__more" aria-hidden="true">
        {chipsOpen ? "\u25B4" : "\u25BE"}
      </span>
    </button>
  );

  return (
    <div
      className={`scrap-filters scrap-filters--${layout}`}
      ref={root}
      // The collage studio leaves every key pressed in here to the filters.
      data-owns-keys=""
      onKeyDown={(event) => {
        if (event.key === "Escape" && panel) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <style>{styles}</style>
      {phone ? (
        <>
          <div className="scrap-filters__row">
            {searchField}
            {filtersToggle}
            {searchAccessory}
          </div>
          {chipsOpen && (
            <div className="scrap-filters__row">
              {placesChip}
              {typeChip}
              {shapeChip}
              {whenChip}
              <span className="scrap-filters__spacer" />
              {chipsAccessory}
            </div>
          )}
        </>
      ) : layout === "drawer" ? (
        <>
          <div className="scrap-filters__row">
            {searchField}
            {searchAccessory}
          </div>
          <div className="scrap-filters__row">
            {placesChip}
            {typeChip}
            {shapeChip}
            {whenChip}
            <span className="scrap-filters__spacer" />
            {chipsAccessory}
          </div>
        </>
      ) : (
        <div className="scrap-filters__row">
          {searchField}
          {placesChip}
          {typeChip}
          {shapeChip}
          {whenChip}
        </div>
      )}
    </div>
  );
}

const styles = `
.scrap-filters { display:flex; flex-direction:column; gap:8px; min-width:0; font-family:"Martian Mono",monospace; color:#3d3833; }
.scrap-filters__row { display:flex; align-items:center; gap:6px; min-width:0; }
/* Chips wrap under the search field rather than squeezing it shut. */
.scrap-filters--bar .scrap-filters__row { flex-wrap:wrap; }
.scrap-filters--bar .scrap-filters__search { min-width:140px; }
.scrap-filters--drawer .scrap-filters__row { flex-wrap:wrap; }
.scrap-filters__spacer { flex:1 1 auto; }
.scrap-filters button { font-family:"Martian Mono",monospace; color:inherit; cursor:pointer; }
.scrap-filters__anchor { position:relative; display:inline-flex; flex:0 0 auto; }

.scrap-filters__chip { display:inline-flex; align-items:center; gap:5px; box-sizing:border-box; height:28px; max-width:220px; padding:0 11px; border:1px solid rgba(61,56,51,.18); border-radius:999px; background:#faf9f6; color:#3d3833; font-size:9px; line-height:1; white-space:nowrap; transition:border-color 120ms ease, box-shadow 120ms ease, background-color 120ms ease; }
.scrap-filters__chip:hover { border-color:rgba(61,56,51,.38); }
.scrap-filters__key,.scrap-filters__more { color:#827a72; }
.scrap-filters__value { min-width:0; overflow:hidden; text-overflow:ellipsis; }
.scrap-filters__chip[data-on] { border-color:rgba(74,154,138,.55); background:rgba(74,154,138,.1); color:#2f6b60; }
.scrap-filters__chip[data-on] .scrap-filters__key,.scrap-filters__chip[data-on] .scrap-filters__more { color:#4a9a8a; }
.scrap-filters__chip[aria-expanded=true],.scrap-filters__chip:focus-visible { outline:none; border-color:#4a9a8a; box-shadow:0 0 0 3px rgba(74,154,138,.16); }

.scrap-filters__search { display:flex; align-items:center; gap:7px; flex:1 1 auto; min-width:0; box-sizing:border-box; height:28px; padding:0 5px 0 10px; border:1px solid rgba(61,56,51,.18); border-radius:999px; background:#faf9f6; color:#827a72; cursor:text; transition:border-color 120ms ease, box-shadow 120ms ease; }
.scrap-filters__search:hover { border-color:rgba(61,56,51,.38); }
.scrap-filters__search:focus-within { border-color:#4a9a8a; box-shadow:0 0 0 3px rgba(74,154,138,.16); }
.scrap-filters__search:focus-within .scrap-filters__icon { color:#4a9a8a; }
.scrap-filters__icon { flex:0 0 auto; }
.scrap-filters__search input { flex:1 1 auto; width:0; min-width:0; height:100%; padding:0; border:0; outline:none; background:transparent; color:#3d3833; font:10px "Martian Mono",monospace; }
.scrap-filters input::placeholder { color:#a39b91; }
.scrap-filters__matches { flex:0 0 auto; color:#827a72; font-size:9px; }
.scrap-filters .scrap-filters__clear { display:grid; place-items:center; flex:0 0 auto; width:18px; height:18px; padding:0; border:0; border-radius:999px; background:rgba(61,56,51,.09); color:#3d3833; font-size:11px; line-height:1; }
.scrap-filters .scrap-filters__clear:hover { background:rgba(61,56,51,.16); }
.scrap-filters .scrap-filters__clear:focus-visible { outline:none; box-shadow:0 0 0 2px #4a9a8a; }

.scrap-filters__popover { position:absolute; z-index:3; box-sizing:border-box; width:300px; max-width:calc(100vw - 16px); padding:10px; border:1px solid rgba(61,56,51,.2); border-radius:8px; background:#f5f0e8; box-shadow:0 10px 28px rgba(61,56,51,.22); font-size:9px; line-height:1.4; text-align:left; translate:var(--scrap-filters-nudge,0px) 0; }
.scrap-filters__popover--above { bottom:calc(100% + 12px); }
.scrap-filters__popover--below { top:calc(100% + 10px); }
.scrap-filters--bar .scrap-filters__popover--places { left:50%; transform:translateX(-50%); }
.scrap-filters--bar .scrap-filters__popover--type { right:0; }
.scrap-filters--drawer .scrap-filters__popover { left:0; }
.scrap-filters--drawer .scrap-filters__popover--places { width:280px; }
.scrap-filters__popover--type { width:200px; }
.scrap-filters__popover--shape { width:auto; }
.scrap-filters--bar .scrap-filters__popover--shape { right:0; }
.scrap-filters__popover--when { width:${DAY_GRID_WIDTH + 22}px; }
.scrap-filters--bar .scrap-filters__popover--when { right:0; }
.scrap-filters__heading--time { margin-top:10px; }
.scrap-filters__times { display:grid; grid-template-columns:1fr 1fr; gap:4px; }
.scrap-filters .scrap-filters__time { height:22px; padding:0 6px; border:1px solid rgba(61,56,51,.18); border-radius:999px; background:#faf9f6; font-size:9px; }
.scrap-filters .scrap-filters__time:hover { border-color:rgba(61,56,51,.38); }
.scrap-filters .scrap-filters__time[aria-pressed=true] { border-color:rgba(74,154,138,.55); background:rgba(74,154,138,.1); color:#2f6b60; }
.scrap-filters .scrap-filters__time:focus-visible { outline:none; border-color:#4a9a8a; box-shadow:0 0 0 3px rgba(74,154,138,.16); }
.scrap-filters__window { display:flex; align-items:center; gap:4px; margin-top:8px; font-size:10px; }
.scrap-filters__window .scrap-filters__clear { margin-left:auto; }
.scrap-filters [role=button][data-day]:focus-visible { outline:2px solid #4a9a8a; outline-offset:-2px; }
.scrap-filters__caret { position:absolute; left:50%; z-index:4; box-sizing:border-box; width:9px; height:9px; border:1px solid rgba(61,56,51,.2); background:#f5f0e8; transform:translateX(-50%) rotate(45deg); }
.scrap-filters__caret--above { bottom:calc(100% + 7.5px); border-top-color:transparent; border-left-color:transparent; }
.scrap-filters__caret--below { top:calc(100% + 5.5px); border-bottom-color:transparent; border-right-color:transparent; }

.scrap-filters__heading { display:flex; align-items:center; justify-content:space-between; margin:0 2px 8px; color:#827a72; letter-spacing:.03em; }
.scrap-filters .scrap-filters__link { padding:0; border:0; background:transparent; color:#33796d; font-size:9px; text-decoration:underline; text-underline-offset:2px; }
.scrap-filters .scrap-filters__link:focus-visible { outline:2px solid rgba(74,154,138,.45); outline-offset:2px; border-radius:2px; }
.scrap-filters__find { display:flex; align-items:center; gap:6px; box-sizing:border-box; height:26px; padding:0 8px; border:1px solid rgba(61,56,51,.18); border-radius:6px; background:#faf9f6; color:#827a72; cursor:text; }
.scrap-filters__find:focus-within { border-color:#4a9a8a; box-shadow:0 0 0 3px rgba(74,154,138,.16); color:#4a9a8a; }
.scrap-filters__find input { flex:1 1 auto; width:0; min-width:0; padding:0; border:0; outline:none; background:transparent; color:#3d3833; font:10px "Martian Mono",monospace; }
.scrap-filters__options { max-height:min(220px,35vh); overflow:auto; margin-top:6px; }
.scrap-filters .scrap-filters__option { display:flex; align-items:center; gap:8px; box-sizing:border-box; width:100%; min-height:26px; padding:4px 6px; border:0; border-radius:5px; background:transparent; font-size:9px; text-align:left; }
.scrap-filters .scrap-filters__option:hover { background:rgba(61,56,51,.06); }
.scrap-filters .scrap-filters__option:focus-visible { outline:none; background:rgba(61,56,51,.06); box-shadow:inset 0 0 0 1px #4a9a8a; }
.scrap-filters__name { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.scrap-filters__count { flex:0 0 auto; color:#827a72; }
.scrap-filters__shapes { display:flex; gap:4px; }
.scrap-filters .scrap-filters__shape { display:flex; flex-direction:column; align-items:center; gap:3px; width:40px; padding:6px 0 5px; border:1px solid transparent; border-radius:6px; background:transparent; color:#827a72; font-size:9px; }
.scrap-filters .scrap-filters__shape:hover { background:rgba(61,56,51,.06); color:#3d3833; }
.scrap-filters .scrap-filters__shape:focus-visible { outline:none; box-shadow:inset 0 0 0 1px #4a9a8a; }
.scrap-filters .scrap-filters__shape[aria-pressed=true] { border-color:rgba(74,154,138,.55); background:rgba(74,154,138,.1); color:#2f6b60; --scrap-filters-shape-fill:.35; }
.scrap-filters__shape-icon { display:block; flex:0 0 auto; }
.scrap-filters__shapes-picked { display:inline-flex; align-items:center; gap:1px; --scrap-filters-shape-fill:.35; }
.scrap-filters__check { display:grid; place-items:center; flex:0 0 auto; box-sizing:border-box; width:12px; height:12px; border:1px solid rgba(61,56,51,.3); border-radius:3px; background:#faf9f6; color:#fff; font-size:8px; line-height:1; }
.scrap-filters__option[aria-pressed=true] .scrap-filters__check { border-color:#4a9a8a; background:#4a9a8a; }
.scrap-filters__option[aria-pressed=true] .scrap-filters__name { color:#2f6b60; }
.scrap-filters__place { display:flex; align-items:center; gap:2px; }
.scrap-filters .scrap-filters__hide { display:grid; place-items:center; flex:0 0 auto; width:24px; height:24px; padding:0; border:0; border-radius:5px; background:transparent; color:#b3aba1; }
.scrap-filters .scrap-filters__hide:hover { background:rgba(162,84,47,.1); color:#a2542f; }
.scrap-filters .scrap-filters__hide:focus-visible { outline:none; box-shadow:inset 0 0 0 1px #4a9a8a; color:#a2542f; }
.scrap-filters .scrap-filters__hide[aria-pressed=true] { background:rgba(162,84,47,.12); color:#a2542f; }
.scrap-filters__place[data-hidden] .scrap-filters__name { color:#a2542f; text-decoration:line-through; text-decoration-color:rgba(162,84,47,.6); }
.scrap-filters__place[data-hidden] .scrap-filters__check { border-style:dashed; }
.scrap-filters__separator { height:1px; margin:4px 2px; border:0; background:rgba(61,56,51,.14); }
.scrap-filters__empty { margin:6px; color:#827a72; }

@media (max-width:619px) {
  .scrap-filters--bar .scrap-filters__row { flex-wrap:wrap; }
  .scrap-filters--bar .scrap-filters__search { flex-basis:100%; }
}
@media (pointer:coarse) {
  .scrap-filters__chip,.scrap-filters__search { height:auto; min-height:40px; }
  .scrap-filters .scrap-filters__option { min-height:40px; }
  .scrap-filters .scrap-filters__hide { width:40px; height:40px; }
  .scrap-filters input { font-size:16px; }
}
/* On a phone the bar sits under a thumb on a small screen, so it is compact:
   one search line, with the chips behind the filters chip. The input keeps
   16px text so Safari does not zoom the page to type, and the hint under it
   stays small. */
@media (pointer:coarse) and (max-width:619px) {
  .scrap-filters { gap:6px; }
  .scrap-filters__row { flex-wrap:wrap; gap:5px; }
  .scrap-filters__chip { min-height:32px; padding:0 10px; }
  .scrap-filters__search, .scrap-filters--bar .scrap-filters__search { min-height:34px; flex:1 1 0; min-width:0; }
  .scrap-filters input::placeholder { font-size:11px; }
  .scrap-filters .scrap-filters__option { min-height:36px; }
  .scrap-filters .scrap-filters__hide { width:36px; height:36px; }
}
.scrap-filters__toggle[aria-pressed=true] { border-color:rgba(74,154,138,.55); background:rgba(74,154,138,.1); color:#2f6b60; }
`;
