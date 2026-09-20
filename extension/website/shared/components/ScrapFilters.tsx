// ABOUTME: Provides source and type popovers with an inline scrap search field.
// ABOUTME: Keeps selected locations visible and supports keyboard dismissal and focus return.

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ScrapItem } from "./ScrapCollage";
import {
  extractDomain,
  formatFilterChip,
  parseFilterChip,
  type FilterChip,
} from "../utils/eventUtils";
import { scrapLocations } from "../utils/scrapFilters";

type Kind = ScrapItem["kind"] | "all";
const kinds: { kind: Kind; label: string }[] = [
  { kind: "all", label: "all" },
  { kind: "image", label: "images" },
  { kind: "button", label: "buttons" },
  { kind: "svg-icon", label: "icons" },
  { kind: "heading", label: "headings" },
  { kind: "cursor", label: "cursors" },
];

interface Props {
  items: ScrapItem[];
  places: FilterChip[];
  onPlaces: (places: FilterChip[]) => void;
  kind: Kind;
  onKind: (kind: Kind) => void;
  search: string;
  onSearch: (search: string) => void;
}

export function ScrapFilters({
  items,
  places,
  onPlaces,
  kind,
  onKind,
  search,
  onSearch,
}: Props) {
  const [panel, setPanel] = useState<"places" | "type" | null>(null);
  const [draft, setDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(Boolean(search));
  const root = useRef<HTMLDivElement>(null);
  const placeButton = useRef<HTMLButtonElement>(null);
  const typeButton = useRef<HTMLButtonElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const placeInput = useRef<HTMLInputElement>(null);
  const typeOptions = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const searchWasOpen = useRef(searchOpen);
  const id = useId();
  const domains = useMemo(
    () =>
      Array.from(
        new Set(
          items
            .flatMap((item) =>
              scrapLocations(item).map((source) =>
                extractDomain(source.pageUrl),
              ),
            )
            .filter(Boolean),
        ),
      ).sort(),
    [items],
  );
  const selected = places.map(formatFilterChip);
  const candidate = parseFilterChip(draft);
  candidate.domain = candidate.domain.toLowerCase();
  const candidateLabel = formatFilterChip(candidate);
  const options = Array.from(new Set([...selected, ...domains])).filter(
    (value) => value.toLowerCase().includes(draft.toLowerCase().trim()),
  );
  const togglePlace = (label: string) => {
    if (selected.includes(label))
      onPlaces(places.filter((place) => formatFilterChip(place) !== label));
    else onPlaces([...places, parseFilterChip(label)]);
  };
  const close = () => {
    (panel === "places" ? placeButton : typeButton).current?.focus();
    setPanel(null);
  };
  useEffect(() => {
    if (panel === "places") placeInput.current?.focus();
    if (panel === "type")
      typeOptions.current
        ?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
        ?.focus();
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setPanel(null);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
    };
  }, [panel]);
  useEffect(() => {
    if (searchOpen) searchInput.current?.focus();
    else if (searchWasOpen.current) searchButton.current?.focus();
    searchWasOpen.current = searchOpen;
  }, [searchOpen]);

  return (
    <div
      className="scrap-filters"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && panel) {
          event.stopPropagation();
          close();
        }
      }}
    >
      <style>{styles}</style>
      <button
        type="button"
        ref={placeButton}
        className="scrap-filters__chip"
        aria-expanded={panel === "places"}
        aria-controls={`${id}-places`}
        onClick={() => setPanel(panel === "places" ? null : "places")}
      >
        <span className="scrap-filters__label">Found on</span>{" "}
        {selected.length === 0 && <span>anywhere</span>}{" "}
        <span aria-hidden="true">▾</span>
      </button>
      {selected.map((site) => (
        <button
          type="button"
          key={site}
          className="scrap-filters__site"
          aria-label={`Edit source filter ${site}`}
          aria-expanded={panel === "places"}
          aria-controls={`${id}-places`}
          onClick={() => setPanel("places")}
        >
          {site}
        </button>
      ))}
      <button
        type="button"
        ref={typeButton}
        className="scrap-filters__chip"
        aria-expanded={panel === "type"}
        aria-controls={`${id}-type`}
        onClick={() => setPanel(panel === "type" ? null : "type")}
      >
        <span className="scrap-filters__label">Type</span>{" "}
        {kinds.find((option) => option.kind === kind)?.label}{" "}
        <span aria-hidden="true">▾</span>
      </button>
      <button
        type="button"
        ref={searchButton}
        className="scrap-filters__search-toggle"
        aria-label="Search scraps"
        aria-expanded={searchOpen}
        hidden={searchOpen}
        onClick={() => {
          setSearchOpen(true);
          setPanel(null);
        }}
      >
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
          <circle
            cx="8"
            cy="8"
            r="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path d="m12 12 5 5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {searchOpen && (
        <div className="scrap-filters__search">
          <input
            ref={searchInput}
            aria-label="Search scraps"
            placeholder="Search titles, URLs, alt text…"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
          <button
            type="button"
            aria-label="Clear and close search"
            onClick={() => {
              onSearch("");
              setSearchOpen(false);
            }}
          >
            ×
          </button>
        </div>
      )}
      {panel === "places" && (
        <section
          id={`${id}-places`}
          className="scrap-filters__popover"
          aria-label="Found on filters"
        >
          <div className="scrap-filters__heading">
            <span>Found on</span>
            <button type="button" onClick={() => onPlaces([])}>
              Clear
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
            <input
              ref={placeInput}
              aria-label="Find a domain or page"
              placeholder="Domain or page URL…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            {candidateLabel && !options.includes(candidateLabel) && (
              <button type="submit" className="scrap-filters__domain">
                Use {candidateLabel}
              </button>
            )}
          </form>
          <div className="scrap-filters__domains">
            {options.map((domain) => (
              <button
                type="button"
                key={domain}
                className="scrap-filters__domain"
                aria-pressed={selected.includes(domain)}
                onClick={() => togglePlace(domain)}
              >
                <span aria-hidden="true">
                  {selected.includes(domain) ? "✓" : "+"}
                </span>
                {domain}
              </button>
            ))}
          </div>
        </section>
      )}
      {panel === "type" && (
        <section
          id={`${id}-type`}
          className="scrap-filters__popover scrap-filters__popover--type"
          aria-label="Scrap types"
        >
          <div className="scrap-filters__heading">Type</div>
          <div className="scrap-filters__types" ref={typeOptions}>
            {kinds.map((option) => (
              <button
                type="button"
                key={option.kind}
                data-scrap-kind={option.kind}
                aria-pressed={option.kind === kind}
                onClick={() => onKind(option.kind)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const styles = `
.scrap-filters { display:flex; flex-wrap:wrap; align-items:center; gap:6px; min-width:0; }
.scrap-filters button,.scrap-filters input { font:10px/1.5 "Martian Mono",monospace; color:#3d3833; }
.scrap-filters button { cursor:pointer; border:1px solid #cec8bf; background:#faf9f6; border-radius:4px; padding:6px 8px; }
.scrap-filters button:focus-visible,.scrap-filters input:focus-visible { outline:2px solid #4a9a8a; outline-offset:2px; }
.scrap-filters [hidden] { display:none; }
.scrap-filters__chip { display:flex; align-items:center; flex-wrap:wrap; gap:6px; max-width:100%; text-align:left; overflow-wrap:anywhere; }
.scrap-filters__chip[aria-expanded=true] { border-color:#4a9a8a; }
.scrap-filters__label { color:#827a72; }
.scrap-filters .scrap-filters__site { color:#33796d; max-width:100%; overflow-wrap:anywhere; text-align:left; }
.scrap-filters__search { display:flex; flex:1 1 170px; width:170px; min-width:120px; border:1px solid #cec8bf; border-radius:4px; background:#faf9f6; }
.scrap-filters__search input { flex:1; width:0; min-width:0; padding:6px 8px; border:0; background:transparent; }
.scrap-filters__search button { border:0; }
.scrap-filters__popover { position:absolute; bottom:calc(100% + 12px); left:0; z-index:2; width:300px; max-width:100%; box-sizing:border-box; padding:14px; border:1px solid #cec8bf; border-radius:6px; background:#f5f0e8; box-shadow:0 8px 24px #3d383333; font:11px/1.5 "Martian Mono",monospace; }
.scrap-filters__popover--type { left:auto; right:0; width:260px; }
.scrap-filters__heading { display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; }
.scrap-filters__heading button { border:0; background:transparent; padding:0; }
.scrap-filters__popover input { width:100%; box-sizing:border-box; padding:7px; border:1px solid #cec8bf; border-radius:4px; background:#faf9f6; }
.scrap-filters__domains { max-height:min(220px,35vh); overflow:auto; margin-top:6px; }
.scrap-filters .scrap-filters__domain { display:flex; gap:8px; width:100%; border:0; text-align:left; background:transparent; overflow-wrap:anywhere; }
.scrap-filters__domain[aria-pressed=true] { color:#33796d; }
.scrap-filters__types { display:flex; flex-wrap:wrap; gap:7px; }
.scrap-filters__types button[aria-pressed=true] { background:#4a9a8a; color:#fff; border-color:#4a9a8a; }
@media(pointer:coarse) { .scrap-filters button { min-height:40px; } .scrap-filters input { font-size:16px; } }
`;
