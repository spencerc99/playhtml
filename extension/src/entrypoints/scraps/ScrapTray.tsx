// ABOUTME: Windowed tray of collected scraps to pick material from, newest first.
// ABOUTME: Renders only the rows in view so thousands of scraps stay responsive.

import React, { useMemo, useRef, useState } from "react";
import {
  ScrapContent,
  type ScrapItem,
} from "@movement/components/ScrapCollage";

export type ScrapKindFilter = "all" | ScrapItem["kind"];

const KIND_FILTERS: ScrapKindFilter[] = [
  "all",
  "image",
  "button",
  "svg-icon",
  "cursor",
];

const FILTER_LABELS: Record<ScrapKindFilter, string> = {
  all: "all",
  image: "images",
  button: "buttons",
  "svg-icon": "icons",
  cursor: "cursors",
};

const COLUMNS = 2;
const CELL_HEIGHT = 84;
const OVERSCAN_ROWS = 3;

interface ScrapTrayProps {
  items: readonly ScrapItem[];
  onPlace: (item: ScrapItem) => void;
  onDragStart: (item: ScrapItem, event: React.DragEvent) => void;
}

export function ScrapTray({ items, onPlace, onDragStart }: ScrapTrayProps) {
  const [kind, setKind] = useState<ScrapKindFilter>("all");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.ts - a.ts);
    return kind === "all" ? sorted : sorted.filter((item) => item.kind === kind);
  }, [items, kind]);

  const rowCount = Math.ceil(filtered.length / COLUMNS);
  const firstRow = Math.max(
    0,
    Math.floor(scrollTop / CELL_HEIGHT) - OVERSCAN_ROWS,
  );
  const lastRow = Math.min(
    rowCount,
    Math.ceil((scrollTop + viewportHeight) / CELL_HEIGHT) + OVERSCAN_ROWS,
  );
  const visible = filtered.slice(firstRow * COLUMNS, lastRow * COLUMNS);

  const measure = (node: HTMLDivElement | null) => {
    scrollRef.current = node;
    if (node) setViewportHeight(node.clientHeight);
  };

  return (
    <aside className="collage-tray">
      <div className="collage-tray__filters">
        {KIND_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            className={`collage-chip${kind === option ? " collage-chip--active" : ""}`}
            onClick={() => setKind(option)}
          >
            {FILTER_LABELS[option]}
          </button>
        ))}
      </div>
      <p className="collage-studio__label" style={{ margin: 0 }}>
        {filtered.length} to draw from
      </p>
      <div
        className="collage-tray__scroll"
        ref={measure}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        <div
          className="collage-tray__runway"
          style={{ height: rowCount * CELL_HEIGHT }}
        >
          {visible.map((item, offset) => {
            const index = firstRow * COLUMNS + offset;
            return (
              <button
                key={item.id}
                type="button"
                className="collage-tray__slot"
                draggable
                title={`${item.domain} — ${item.pageTitle}`}
                style={{
                  top: Math.floor(index / COLUMNS) * CELL_HEIGHT,
                  left: `${(index % COLUMNS) * (100 / COLUMNS)}%`,
                  width: `${100 / COLUMNS}%`,
                  height: CELL_HEIGHT,
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
    </aside>
  );
}
