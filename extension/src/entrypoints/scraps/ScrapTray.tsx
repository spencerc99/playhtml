// ABOUTME: Resizable drawer of collected scraps to pick material from, newest first.
// ABOUTME: Renders only the rows in view so thousands of scraps stay responsive.

import React, { useMemo, useRef, useState } from "react";
import {
  ScrapContent,
  type ScrapItem,
} from "@movement/components/ScrapCollage";
import {
  DRAWER_COLUMN_WIDTH,
  DRAWER_RAIL_WIDTH,
  clampDrawerWidth,
  drawerColumns,
} from "./drawerPreference";

export type ScrapKindFilter = "all" | ScrapItem["kind"];

const KIND_FILTERS: ScrapKindFilter[] = [
  "all",
  "image",
  "button",
  "svg-icon",
  "cursor",
];

/** Short enough that every filter fits one line at the default width. */
const FILTER_LABELS: Record<ScrapKindFilter, string> = {
  all: "all",
  image: "pics",
  button: "btns",
  "svg-icon": "icons",
  cursor: "curs",
};

const OVERSCAN_ROWS = 3;

interface ScrapTrayProps {
  items: readonly ScrapItem[];
  width: number;
  collapsed: boolean;
  onWidth: (width: number) => void;
  onCollapsed: (collapsed: boolean) => void;
  onPlace: (item: ScrapItem) => void;
  onDragStart: (item: ScrapItem, event: React.DragEvent) => void;
}

export function ScrapTray({
  items,
  width,
  collapsed,
  onWidth,
  onCollapsed,
  onPlace,
  onDragStart,
}: ScrapTrayProps) {
  const [kind, setKind] = useState<ScrapKindFilter>("all");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const resizingRef = useRef(false);

  const filtered = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.ts - a.ts);
    return kind === "all" ? sorted : sorted.filter((item) => item.kind === kind);
  }, [items, kind]);

  const columns = drawerColumns(width);
  // A cell is square, so the row height follows from how many fit across.
  const cellHeight = Math.round(width / columns);
  const rowCount = Math.ceil(filtered.length / columns);
  const firstRow = Math.max(
    0,
    Math.floor(scrollTop / cellHeight) - OVERSCAN_ROWS,
  );
  const lastRow = Math.min(
    rowCount,
    Math.ceil((scrollTop + viewportHeight) / cellHeight) + OVERSCAN_ROWS,
  );
  const visible = filtered.slice(firstRow * columns, lastRow * columns);

  const measure = (node: HTMLDivElement | null) => {
    if (node) setViewportHeight(node.clientHeight);
  };

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
      <div className="collage-tray__head">
        <div className="collage-tray__filters">
          {KIND_FILTERS.map((option) => (
            <button
              key={option}
              type="button"
              className={`collage-chip${kind === option ? " collage-chip--active" : ""}`}
              title={option === "all" ? "every kind" : option}
              onClick={() => setKind(option)}
            >
              {FILTER_LABELS[option]}
            </button>
          ))}
        </div>
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
      </div>
      <p className="collage-studio__label collage-tray__count">
        {filtered.length} to draw from
      </p>
      <div
        className="collage-tray__scroll"
        ref={measure}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div
          className="collage-tray__runway"
          style={{ height: rowCount * cellHeight }}
        >
          {visible.map((item, offset) => {
            const index = firstRow * columns + offset;
            return (
              <button
                key={item.id}
                type="button"
                className="collage-tray__slot"
                draggable
                title={`${item.domain} — ${item.pageTitle}`}
                style={{
                  top: Math.floor(index / columns) * cellHeight,
                  left: `${(index % columns) * (100 / columns)}%`,
                  width: `${100 / columns}%`,
                  height: cellHeight,
                }}
                onDragStart={(event) => onDragStart(item, event)}
                onClick={() => onPlace(item)}
              >
                <span className="collage-tray__thumb">
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
        onDoubleClick={() => onWidth(3 * DRAWER_COLUMN_WIDTH)}
      />
    </aside>
  );
}
