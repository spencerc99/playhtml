// ABOUTME: Resizable drawer of collected scraps to pick material from, newest first.
// ABOUTME: Renders only the rows in view so thousands of scraps stay responsive.

import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ScrapContent,
  type ScrapItem,
} from "@movement/components/ScrapCollage";
import {
  ScrapFilters,
  scrapPassesFilters,
  type ScrapKindFilter,
} from "@movement/components/ScrapFilters";
import type { FilterChip } from "@movement/utils/eventUtils";
import {
  DRAWER_RAIL_WIDTH,
  SLOT_SIZE_NAMES,
  clampDrawerWidth,
  defaultDrawerWidth,
  drawerColumns,
  type DrawerSlotSize,
} from "./drawerPreference";
import { cellLeft, layOutDrawer } from "./drawerLayout";
import { ProvenanceLines } from "./ProvenancePeek";
import {
  backingForKind,
  couldBeTransparent,
  readTransparency,
  rememberedTransparency,
} from "./scrapTransparency";

/** How far above and below the view thumbnails are kept mounted, in pixels. */
const OVERSCAN = 400;
/** Room a full label needs above a slot before it drops below it instead. */
const LABEL_ROOM = 56;
/** The widest a label gets, from the peek label's own max-width. */
const LABEL_WIDTH = 240;

interface ScrapTrayProps {
  items: readonly ScrapItem[];
  width: number;
  collapsed: boolean;
  slotSize: DrawerSlotSize;
  onWidth: (width: number) => void;
  onCollapsed: (collapsed: boolean) => void;
  onSlotSize: (slotSize: DrawerSlotSize) => void;
  onPlace: (item: ScrapItem) => void;
  onDragStart: (item: ScrapItem, event: React.DragEvent) => void;
}

export function ScrapTray({
  items,
  width,
  collapsed,
  slotSize,
  onWidth,
  onCollapsed,
  onSlotSize,
  onPlace,
  onDragStart,
}: ScrapTrayProps) {
  const [kind, setKind] = useState<ScrapKindFilter>("all");
  const [places, setPlaces] = useState<FilterChip[]>([]);
  const [search, setSearch] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const resizingRef = useRef(false);
  /** The scrap under the pointer or focus, and where its slot sits on screen. */
  const [pointed, setPointed] = useState<{
    item: ScrapItem;
    box: DOMRect;
  } | null>(null);

  const filtered = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.ts - a.ts);
    return sorted.filter((item) =>
      scrapPassesFilters(item, kind, places, search),
    );
  }, [items, kind, places, search]);
  const filtering = kind !== "all" || places.length > 0 || search.trim() !== "";

  const columns = drawerColumns(width, slotSize);
  // Every thumbnail keeps its own proportions, so the placement is worked out
  // once and the visible range is then a lookup rather than a measurement.
  const layout = useMemo(
    () => layOutDrawer(filtered, width, columns),
    [filtered, width, columns],
  );
  const visible = useMemo(
    () =>
      layout.cells.filter(
        (cell) =>
          cell.top + cell.height >= scrollTop - OVERSCAN &&
          cell.top <= scrollTop + viewportHeight + OVERSCAN,
      ),
    [layout, scrollTop, viewportHeight],
  );

  /**
   * Pictures found to have see-through pixels, so only those get a chequer
   * behind them. The sampling happens once per picture, on load.
   */
  const [transparent, setTransparent] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  /** Pictures already asked about, so one is only ever fetched once. */
  const askedRef = useRef<Set<string>>(new Set());
  const noteTransparency = useCallback((src: string) => {
    if (askedRef.current.has(src)) return;
    askedRef.current.add(src);
    const remembered = rememberedTransparency(src);
    if (remembered !== undefined) {
      if (remembered) {
        setTransparent((current) => new Set(current).add(src));
      }
      return;
    }
    readTransparency(src)
      .then((seeThrough) => {
        if (!seeThrough) return;
        setTransparent((current) => new Set(current).add(src));
      })
      .catch(() => {
        // A picture whose pixels cannot be read sits on the paper rather than
        // getting a chequer that may be wrong.
      });
  }, []);

  const scrollTopRef = useRef(0);
  scrollTopRef.current = scrollTop;
  /**
   * Runs once each time the scroll box is put back, as when the drawer is
   * reopened. The box comes back scrolled to the top, but only the rows near
   * the remembered scroll are mounted, so it is returned to that scroll.
   */
  const attachScroll = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    node.scrollTop = scrollTopRef.current;
    setScrollTop(node.scrollTop);
    setViewportHeight(node.clientHeight);
  }, []);

  if (collapsed) {
    return (
      <aside
        className="collage-tray collage-tray--tucked"
        style={{ width: DRAWER_RAIL_WIDTH }}
      >
        <button
          type="button"
          className="collage-tray__rail"
          title="Open the scrap drawer (\\)"
          aria-label="Open the scrap drawer"
          aria-expanded={false}
          onClick={() => onCollapsed(false)}
        >
          scraps
        </button>
      </aside>
    );
  }

  return (
    <aside className="collage-tray" style={{ width }}>
      <ScrapFilters
        items={items}
        places={places}
        onPlaces={setPlaces}
        kind={kind}
        onKind={setKind}
        search={search}
        onSearch={setSearch}
        matchCount={filtered.length}
        layout="drawer"
        placement="below"
        searchAccessory={
          <button
            type="button"
            className="collage-tray__tuck"
            title="Tuck the scrap drawer away (\\)"
            aria-label="Tuck the scrap drawer away"
            aria-expanded={true}
            onClick={() => onCollapsed(true)}
          >
            &#8249;
          </button>
        }
        chipsAccessory={
          <div className="collage-tray__sizes">
            {SLOT_SIZE_NAMES.map((name) => (
              <button
                key={name}
                type="button"
                className={`collage-tray__size${
                  name === slotSize ? " collage-tray__size--on" : ""
                }`}
                title={`Show scraps ${name}`}
                aria-label={`Show scraps ${name}`}
                aria-pressed={name === slotSize}
                onClick={() => onSlotSize(name)}
              >
                {name[0]}
              </button>
            ))}
          </div>
        }
      />
      <p className="collage-studio__label collage-tray__count">
        {filtering ? (
          <>
            {filtered.length} of {items.length} ·{" "}
            <button
              type="button"
              className="collage-tray__reset"
              onClick={() => {
                setSearch("");
                setPlaces([]);
                setKind("all");
              }}
            >
              reset
            </button>
          </>
        ) : (
          <>{filtered.length} to draw from</>
        )}
      </p>
      <div
        className="collage-tray__scroll"
        ref={attachScroll}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          // The label was placed against where the slot used to be.
          setPointed(null);
        }}
      >
        <div className="collage-tray__runway" style={{ height: layout.height }}>
          {visible.map((cell) => {
            const { item } = cell;
            // A chequer means "this has holes in it", so it only goes behind
            // material that really does: an icon, a cursor, or a picture whose
            // own pixels turned out to be see-through.
            const src = item.kind === "image" ? item.src : "";
            const backing =
              backingForKind(item) ??
              (transparent.has(src) ? "checker" : "paper");
            const small = item.kind === "svg-icon" || item.kind === "cursor";
            return (
              <button
                key={item.id}
                type="button"
                className="collage-tray__slot"
                draggable
                aria-label={`${item.domain} — ${item.pageTitle}`}
                style={{
                  top: cell.top,
                  left: cellLeft(cell, layout.columnWidth),
                  width: layout.columnWidth,
                  height: cell.height,
                }}
                onDragStart={(event) => {
                  setPointed(null);
                  onDragStart(item, event);
                }}
                onClick={() => onPlace(item)}
                onPointerEnter={(event) =>
                  setPointed({
                    item,
                    box: event.currentTarget.getBoundingClientRect(),
                  })
                }
                onPointerLeave={() => setPointed(null)}
                onFocus={(event) =>
                  setPointed({
                    item,
                    box: event.currentTarget.getBoundingClientRect(),
                  })
                }
                onBlur={() => setPointed(null)}
              >
                <span
                  className={`collage-tray__thumb collage-tray__thumb--${backing}${
                    small ? " collage-tray__thumb--small" : ""
                  }`}
                  // A picture whose format could carry alpha is read once, the
                  // first time it comes into view; one that could not — a JPEG
                  // — is never read at all.
                  ref={
                    item.kind === "image" && couldBeTransparent(src)
                      ? () => noteTransparency(src)
                      : undefined
                  }
                >
                  <ScrapContent
                    item={item}
                    loaded={true}
                    onLoad={() => {}}
                    onError={() => {}}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </div>
      {pointed && (
        // The same archive label a piece carries in the collage, so a scrap
        // can be traced back to its page before it is placed.
        <div
          className="collage-peek collage-peek--tray"
          aria-hidden="true"
          style={{
            left: Math.max(
              4,
              Math.min(pointed.box.left, window.innerWidth - LABEL_WIDTH),
            ),
            ...(pointed.box.top >= LABEL_ROOM
              ? { bottom: window.innerHeight - pointed.box.top + 3 }
              : { top: pointed.box.bottom + 3 }),
          }}
        >
          <ProvenanceLines scrap={pointed.item} />
        </div>
      )}
      <div
        className="collage-tray__grip"
        role="separator"
        aria-label="Resize the scrap drawer"
        aria-orientation="vertical"
        onPointerDown={(event) => {
          resizingRef.current = true;
          (event.target as Element).setPointerCapture?.(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!resizingRef.current) return;
          onWidth(clampDrawerWidth(event.clientX, window.innerWidth, slotSize));
        }}
        onPointerUp={() => {
          resizingRef.current = false;
        }}
        onPointerCancel={() => {
          resizingRef.current = false;
        }}
        onDoubleClick={() => onWidth(defaultDrawerWidth(slotSize))}
      />
    </aside>
  );
}
