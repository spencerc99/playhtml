// ABOUTME: Filters scraps by where and when they were found, their kind, and an always-visible search field.
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
  type FilterChip,
} from "../utils/eventUtils";
import {
  ANY_TIME,
  isAnyTime,
  matchesScrapFilters,
  matchesScrapWhen,
  scrapDays,
  scrapLocations,
  scrapSightings,
  type ScrapWhenFilter,
} from "../utils/scrapFilters";
import type { TimeOfDayFilter } from "../config";
import { formatTimeOfDay, localDayKey } from "../utils/timeOfDay";
import { DAY_GRID_WIDTH, DayGrid, formatSingleDate } from "./DayGrid";
import { TimeOfDayInputs } from "./TimeOfDayInputs";

export { ANY_TIME, isAnyTime, type ScrapWhenFilter };

export type ScrapKindFilter = ScrapItem["kind"] | "all";

const kinds: { kind: ScrapKindFilter; label: string }[] = [
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
  places: FilterChip[],
  search: string,
  when: ScrapWhenFilter,
): boolean {
  return (
    (kind === "all" || item.kind === kind) &&
    matchesScrapFilters(item, places, search) &&
    matchesScrapWhen(item, when)
  );
}

/** The chip's short summary of a day and time-of-day filter. */
export function formatScrapWhen(when: ScrapWhenFilter): string {
  const parts = [
    when.day === null ? null : formatSingleDate(when.day),
    when.timeOfDay === null ? null : formatTimeOfDay(when.timeOfDay),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? "any time" : parts.join(" · ");
}

interface Props {
  items: readonly ScrapItem[];
  places: FilterChip[];
  onPlaces: (places: FilterChip[]) => void;
  kind: ScrapKindFilter;
  onKind: (kind: ScrapKindFilter) => void;
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

type Panel = "places" | "type" | "when";

const countEach = (group: ScrapItem[]) => group.length;

export function ScrapFilters({
  items,
  places,
  onPlaces,
  kind,
  onKind,
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
  const root = useRef<HTMLDivElement>(null);
  const placeAnchor = useRef<HTMLSpanElement>(null);
  const typeAnchor = useRef<HTMLSpanElement>(null);
  const placeButton = useRef<HTMLButtonElement>(null);
  const typeButton = useRef<HTMLButtonElement>(null);
  const whenAnchor = useRef<HTMLSpanElement>(null);
  const whenButton = useRef<HTMLButtonElement>(null);
  const whenPanel = useRef<HTMLElement>(null);
  const placeInput = useRef<HTMLInputElement>(null);
  /** A site row to hand focus back to once toggling it has moved it. */
  const refocusPlace = useRef<string | null>(null);
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
  const domains = useMemo(
    () =>
      Array.from(
        new Set(items.flatMap((item) => [...itemDomains(item)])),
      ).sort(),
    [items],
  );
  // Counts answer "how many would I see if I picked this", so each facet
  // honours the other filters but not its own.
  const domainCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (panel !== "places") return counts;
    for (const domain of domains) counts.set(domain, 0);
    const byDomain = new Map<string, ScrapItem[]>();
    for (const item of items) {
      if (!scrapPassesFilters(item, kind, [], search, when)) continue;
      for (const domain of itemDomains(item)) {
        const group = byDomain.get(domain) ?? [];
        group.push(item);
        byDomain.set(domain, group);
      }
    }
    for (const [domain, group] of byDomain)
      counts.set(domain, countScraps(group));
    return counts;
  }, [panel, items, domains, kind, search, when, countScraps]);
  const kindCounts = useMemo(() => {
    const counts = new Map<ScrapKindFilter, number>();
    if (panel !== "type") return counts;
    const matching = items.filter(
      (item) =>
        matchesScrapFilters(item, places, search) &&
        matchesScrapWhen(item, when),
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
  }, [panel, items, places, search, when, countScraps]);
  // Every day anything was seen stays in the grid, so narrowing another
  // filter thins a day's texture rather than moving the calendar around.
  const dayCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (panel !== "when") return counts;
    for (const item of items)
      for (const ts of scrapSightings(item)) counts.set(localDayKey(ts), 0);
    const byDay = new Map<string, ScrapItem[]>();
    for (const item of items) {
      if (!scrapPassesFilters(item, kind, places, search, ANY_TIME)) continue;
      for (const day of scrapDays(item, when.timeOfDay)) {
        const group = byDay.get(day) ?? [];
        group.push(item);
        byDay.set(day, group);
      }
    }
    for (const [day, group] of byDay) counts.set(day, countScraps(group));
    return counts;
  }, [panel, items, kind, places, search, when.timeOfDay, countScraps]);

  const selected = places.map(formatFilterChip);
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
  const togglePlace = (label: string) => {
    if (selected.includes(label))
      onPlaces(places.filter((place) => formatFilterChip(place) !== label));
    else onPlaces([...places, parseFilterChip(label)]);
  };
  // Toggling a site moves its row between the picked and unpicked groups,
  // which drops focus to the page; put it back so the keyboard stays here.
  useEffect(() => {
    const label = refocusPlace.current;
    if (label === null) return;
    refocusPlace.current = null;
    Array.from(
      root.current?.querySelectorAll<HTMLButtonElement>("[data-place]") ?? [],
    )
      .find((row) => row.dataset.place === label)
      ?.focus();
  });
  const panelButton = {
    places: placeButton,
    type: typeButton,
    when: whenButton,
  };
  const panelAnchor = {
    places: placeAnchor,
    type: typeAnchor,
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
  // inside the drawer, or inside the window when it floats over the page.
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
    if (bounds.left + nudge < left + margin) nudge = left + margin - bounds.left;
    element.style.setProperty("--scrap-filters-nudge", `${nudge}px`);
  }, [panel, layout]);

  const siteLabel =
    selected.length === 0
      ? "anywhere"
      : selected.length === 1
        ? selected[0]
        : `${selected.length} sites`;
  const kindLabel = kinds.find((option) => option.kind === kind)?.label;

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
        placeholder="search titles, urls, alt text"
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
                <button type="submit" className="scrap-filters__option">
                  <span className="scrap-filters__name">
                    Use {candidateLabel}
                  </span>
                </button>
              )}
            </form>
            <div className="scrap-filters__options">
              {pinned.map((domain) => placeRow(domain, true))}
              {pinned.length > 0 && rest.length > 0 && (
                <hr className="scrap-filters__separator" />
              )}
              {rest.map((domain) => placeRow(domain, false))}
              {listed.length === 0 && (
                <p className="scrap-filters__empty">no sites match</p>
              )}
            </div>
          </section>
        </>
      )}
    </span>
  );

  function placeRow(domain: string, on: boolean) {
    const count = domainCounts.get(domain);
    return (
      <button
        type="button"
        key={domain}
        className="scrap-filters__option"
        data-place={domain}
        aria-pressed={on}
        onClick={() => {
          refocusPlace.current = domain;
          togglePlace(domain);
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
    );
  }

  const typeChip = (
    <span className="scrap-filters__anchor" ref={typeAnchor}>
      <button
        type="button"
        ref={typeButton}
        className="scrap-filters__chip"
        data-on={kind !== "all" || undefined}
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
              {kinds.map((option) => (
                <div key={option.kind} className="scrap-filters__kind">
                  <button
                    type="button"
                    className="scrap-filters__option"
                    data-scrap-kind={option.kind}
                    aria-pressed={option.kind === kind}
                    onClick={() => {
                      onKind(option.kind);
                      typeButton.current?.focus();
                      setPanel(null);
                    }}
                  >
                    <span className="scrap-filters__radio" aria-hidden="true" />
                    <span className="scrap-filters__name">{option.label}</span>
                    <span className="scrap-filters__count">
                      {kindCounts.get(option.kind)}
                    </span>
                  </button>
                  {option.kind === "all" && (
                    <hr className="scrap-filters__separator" />
                  )}
                </div>
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
      {layout === "drawer" ? (
        <>
          <div className="scrap-filters__row">
            {searchField}
            {searchAccessory}
          </div>
          <div className="scrap-filters__row">
            {placesChip}
            {typeChip}
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
          {whenChip}
        </div>
      )}
    </div>
  );
}

const styles = `
.scrap-filters { display:flex; flex-direction:column; gap:8px; min-width:0; font-family:"Martian Mono",monospace; color:#3d3833; }
.scrap-filters__row { display:flex; align-items:center; gap:6px; min-width:0; }
.scrap-filters--bar .scrap-filters__row { flex-wrap:nowrap; }
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
.scrap-filters__popover--when { width:${DAY_GRID_WIDTH + 22}px; }
.scrap-filters--bar .scrap-filters__popover--when { right:0; }
.scrap-filters__heading--time { margin-top:10px; }
.scrap-filters__times { display:flex; flex-wrap:wrap; gap:4px; }
.scrap-filters .scrap-filters__time { flex:1 1 auto; height:22px; padding:0 6px; border:1px solid rgba(61,56,51,.18); border-radius:999px; background:#faf9f6; font-size:9px; }
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
.scrap-filters__check { display:grid; place-items:center; flex:0 0 auto; box-sizing:border-box; width:12px; height:12px; border:1px solid rgba(61,56,51,.3); border-radius:3px; background:#faf9f6; color:#fff; font-size:8px; line-height:1; }
.scrap-filters__option[aria-pressed=true] .scrap-filters__check { border-color:#4a9a8a; background:#4a9a8a; }
.scrap-filters__radio { flex:0 0 auto; box-sizing:border-box; width:12px; height:12px; border:1px solid rgba(61,56,51,.3); border-radius:999px; background:#faf9f6; }
.scrap-filters__option[aria-pressed=true] .scrap-filters__radio { border:4px solid #4a9a8a; }
.scrap-filters__option[aria-pressed=true] .scrap-filters__name { color:#2f6b60; }
.scrap-filters__separator { height:1px; margin:4px 2px; border:0; background:rgba(61,56,51,.14); }
.scrap-filters__empty { margin:6px; color:#827a72; }

@media (max-width:619px) {
  .scrap-filters--bar .scrap-filters__row { flex-wrap:wrap; }
  .scrap-filters--bar .scrap-filters__search { flex-basis:100%; }
}
@media (pointer:coarse) {
  .scrap-filters__chip,.scrap-filters__search { height:auto; min-height:40px; }
  .scrap-filters .scrap-filters__option { min-height:40px; }
  .scrap-filters input { font-size:16px; }
}
`;
