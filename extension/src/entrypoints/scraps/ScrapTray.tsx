// ABOUTME: Resizable drawer of collected scraps to pick material from, newest first.
// ABOUTME: Renders only the rows in view so thousands of scraps stay responsive.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ScrapContent,
  type ScrapItem,
} from "@movement/components/ScrapCollage";
import {
  ANY_TIME,
  ScrapFilters,
  isAnyTime,
  scrapPassesFilters,
  type ScrapKindFilter,
  type ScrapShapeFilter,
  type ScrapWhenFilter,
} from "@movement/components/ScrapFilters";
import type { FilterChip } from "@movement/utils/eventUtils";
import {
  DRAWER_RAIL_WIDTH,
  clampDrawerWidth,
  defaultDrawerWidth,
  drawerColumns,
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

/**
 * Where the drawer sits: beside the collage, at the width it was dragged to,
 * or along the bottom of a phone screen, as wide as the screen.
 */
export type TrayDock = "side" | "bottom";

interface ScrapTrayProps {
  items: readonly ScrapItem[];
  dock: TrayDock;
  width: number;
  collapsed: boolean;
  onWidth: (width: number) => void;
  onCollapsed: (collapsed: boolean) => void;
  onPlace: (item: ScrapItem) => void;
  onDragStart: (item: ScrapItem, event: React.DragEvent) => void;
}

export function ScrapTray({
  items,
  dock,
  width,
  collapsed,
  onWidth,
  onCollapsed,
  onPlace,
  onDragStart,
}: ScrapTrayProps) {
  const [kind, setKind] = useState<ScrapKindFilter>([]);
  const [shape, setShape] = useState<ScrapShapeFilter>([]);
  const [places, setPlaces] = useState<FilterChip[]>([]);
  const [search, setSearch] = useState("");
  const [when, setWhen] = useState<ScrapWhenFilter>(ANY_TIME);
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
      scrapPassesFilters(item, kind, shape, places, search, when),
    );
  }, [items, kind, shape, places, search, when]);
  const filtering =
    kind.length > 0 ||
    shape.length > 0 ||
    places.length > 0 ||
    search.trim() !== "" ||
    !isAnyTime(when);

  // Docked along the bottom, the drawer is as wide as the screen, so its
  // columns are laid out across the width it actually has.
  const [bottomWidth, setBottomWidth] = useState(0);
  const trayRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const tray = trayRef.current;
    if (dock !== "bottom" || !tray) return;
    const measure = () => setBottomWidth(tray.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tray);
    return () => observer.disconnect();
  }, [dock, collapsed]);
  const layoutWidth = dock === "bottom" ? bottomWidth : width;
  const columns = drawerColumns(layoutWidth);
  // Every thumbnail keeps its own proportions, so the placement is worked out
  // once and the visible range is then a lookup rather than a measurement.
  const layout = useMemo(
    () => layOutDrawer(filtered, layoutWidth, columns),
    [filtered, layoutWidth, columns],
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
        className={`collage-tray collage-tray--tucked collage-tray--${dock}`}
        style={dock === "side" ? { width: DRAWER_RAIL_WIDTH } : undefined}
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
    <aside
      ref={trayRef}
      className={`collage-tray collage-tray--${dock}`}
      style={dock === "side" ? { width } : undefined}
    >
      <ScrapFilters
        items={items}
        places={places}
        onPlaces={setPlaces}
        kind={kind}
        onKind={setKind}
        shape={shape}
        onShape={setShape}
        search={search}
        onSearch={setSearch}
        when={when}
        onWhen={setWhen}
        matchCount={filtered.length}
        layout="drawer"
        placement={dock === "bottom" ? "above" : "below"}
        searchAccessory={
          <button
            type="button"
            className="collage-tray__tuck"
            title="Tuck the scrap drawer away (\\)"
            aria-label="Tuck the scrap drawer away"
            aria-expanded={true}
            onClick={() => onCollapsed(true)}
          >
            {dock === "bottom" ? "\u2304" : "\u2039"}
          </button>
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
                setKind([]);
                setShape([]);
                setWhen(ANY_TIME);
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
                onPointerEnter={(event) => {
                  // A finger has no hover, and a label left behind by a tap
                  // would cover the drawer.
                  if (event.pointerType === "touch") return;
                  setPointed({
                    item,
                    box: event.currentTarget.getBoundingClientRect(),
                  });
                }}
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
                    tileWidth={layout.columnWidth}
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
      {dock === "side" && (
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
          onWidth(clampDrawerWidth(event.clientX, window.innerWidth));
        }}
        onPointerUp={() => {
          resizingRef.current = false;
        }}
        onPointerCancel={() => {
          resizingRef.current = false;
        }}
        onDoubleClick={() => onWidth(defaultDrawerWidth())}
      />
      )}
    </aside>
  );
}
