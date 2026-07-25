// ABOUTME: Arranges mixed internet scraps in a draggable warm-paper grid inventory.
// ABOUTME: Sizes each scrap by kind and image proportions, with rotation and overflow packing.

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { buildItems } from "../scraps-preview/demoScraps";

const GRID_COLUMNS = 16;
const GRID_ROWS = 9;
// Cells cap at 56px and shrink to keep the full board inside the viewport.
const CELL_SIZE = Math.max(
  36,
  Math.min(56, Math.floor((window.innerWidth - 150) / GRID_COLUMNS)),
);
const IMAGE_LARGE_TIER_DIVISOR = 3;

interface Footprint {
  cols: number;
  rows: number;
}

interface GridPosition {
  col: number;
  row: number;
}

interface InventoryPlacement {
  footprint: Footprint;
  position: GridPosition | null;
}

type PlacementMap = Record<string, InventoryPlacement>;

interface DragTarget extends GridPosition {
  valid: boolean;
}

interface DragState {
  itemId: string;
  origin: InventoryPlacement;
  footprint: Footprint;
  pointerX: number;
  pointerY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  target: DragTarget | null;
}

interface FittedButtonProps {
  item: Extract<ScrapItem, { kind: "button" }>;
}

interface ScrapContentProps {
  item: ScrapItem;
}

interface InventoryCardProps {
  item: ScrapItem;
  footprint: Footprint;
  className?: string;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
  style?: React.CSSProperties;
  showTooltip?: boolean;
}

const PAGE_STYLES = `
  * {
    box-sizing: border-box;
  }

  body {
    min-height: 100vh;
    background: #faf7f2;
    color: #3d3833;
  }

  .scrap-page {
    position: relative;
    display: flex;
    min-height: 100vh;
    flex-direction: column;
    align-items: center;
    padding: 78px 24px 28px;
    background:
      radial-gradient(circle at 18% 20%, rgba(196, 114, 78, 0.035), transparent 26%),
      radial-gradient(circle at 78% 68%, rgba(74, 154, 138, 0.035), transparent 28%),
      #faf7f2;
  }

  .wordmark {
    position: absolute;
    top: 14px;
    left: 20px;
    z-index: 20;
    font-family: "Source Serif 4", Georgia, serif;
    font-size: 20px;
    font-style: italic;
    font-weight: 200;
    pointer-events: none;
  }

  .page-header {
    position: absolute;
    top: 14px;
    left: 50%;
    z-index: 20;
    width: max-content;
    text-align: center;
    transform: translateX(-50%);
    pointer-events: none;
  }

  .page-header h1 {
    margin: 0;
    font-family: "Martian Mono", monospace;
    font-size: 15px;
    font-weight: 500;
    letter-spacing: 0.04em;
  }

  .page-header p {
    margin: 5px 0 0;
    color: #827a72;
    font-family: "Martian Mono", monospace;
    font-size: 9px;
  }

  .cabinet {
    display: flex;
    width: ${GRID_COLUMNS * CELL_SIZE + 16}px;
    flex-direction: column;
    align-items: stretch;
  }

  .inventory-frame {
    position: relative;
    padding: 8px;
    border: 1px solid #8d7054;
    background: #a88969;
    box-shadow:
      0 14px 32px rgba(74, 55, 38, 0.14),
      inset 0 0 0 2px rgba(255, 249, 238, 0.25),
      inset 0 0 0 5px rgba(102, 74, 50, 0.12);
  }

  .inventory-board {
    position: relative;
    width: ${GRID_COLUMNS * CELL_SIZE}px;
    height: ${GRID_ROWS * CELL_SIZE}px;
    background: #f5f0e8;
    touch-action: none;
  }

  .inventory-slots {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template-columns: repeat(${GRID_COLUMNS}, ${CELL_SIZE}px);
    grid-template-rows: repeat(${GRID_ROWS}, ${CELL_SIZE}px);
  }

  .inventory-slot {
    border-right: 1px solid #d8d0c0;
    border-bottom: 1px solid #d8d0c0;
    box-shadow:
      inset 1px 1px 3px rgba(99, 78, 56, 0.035),
      inset -1px -1px 2px rgba(255, 255, 255, 0.45);
  }

  .inventory-slot:nth-child(${GRID_COLUMNS}n) {
    border-right: 0;
  }

  .inventory-slot:nth-last-child(-n + ${GRID_COLUMNS}) {
    border-bottom: 0;
  }

  .inventory-card {
    position: absolute;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(128, 102, 73, 0.28);
    border-radius: 3px;
    background:
      linear-gradient(145deg, rgba(255, 253, 248, 0.7), rgba(225, 212, 192, 0.25)),
      #f2eadf;
    box-shadow:
      0 2px 5px rgba(79, 57, 38, 0.08),
      inset 0 0 0 1px rgba(255, 255, 255, 0.38);
    cursor: grab;
    touch-action: none;
    transition:
      filter 130ms ease,
      box-shadow 130ms ease,
      transform 130ms ease;
  }

  .inventory-card:hover {
    z-index: 7;
    filter: saturate(1.04);
    box-shadow:
      0 5px 12px rgba(79, 57, 38, 0.13),
      inset 0 0 0 1px rgba(255, 255, 255, 0.46);
  }

  .inventory-card--reserved {
    z-index: 2;
    border-style: dashed;
    background: rgba(224, 214, 198, 0.2);
    box-shadow: inset 0 0 9px rgba(112, 86, 61, 0.07);
    cursor: default;
  }

  .inventory-card--ghost {
    position: fixed;
    z-index: 100;
    cursor: grabbing;
    pointer-events: none;
    transform: scale(1.04);
    transform-origin: center;
    filter: drop-shadow(0 14px 10px rgba(61, 56, 51, 0.24));
  }

  .drop-target {
    position: absolute;
    z-index: 6;
    border: 2px solid;
    border-radius: 4px;
    pointer-events: none;
  }

  .drop-target--valid {
    border-color: rgba(74, 154, 138, 0.82);
    background: rgba(74, 154, 138, 0.2);
    box-shadow: inset 0 0 12px rgba(74, 154, 138, 0.18);
  }

  .drop-target--invalid {
    border-color: rgba(196, 114, 78, 0.88);
    background: rgba(196, 114, 78, 0.2);
    box-shadow: inset 0 0 12px rgba(196, 114, 78, 0.18);
  }

  .scrap-content {
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .scrap-content--image {
    display: block;
    padding: 7px;
    object-fit: contain;
  }

  .scrap-content--button {
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    padding: 6px;
  }

  .scrap-button {
    flex: 0 0 auto;
    transform-origin: center;
  }

  .scrap-button__icon {
    display: inline-flex;
    width: 1em;
    height: 1em;
    flex: 0 0 auto;
    margin-right: 0.45em;
  }

  .scrap-button__icon > svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  .scrap-content--svg {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 9px;
  }

  .scrap-content--svg > svg {
    display: block;
    max-width: 100%;
    max-height: 100%;
  }

  .scrap-content--cursor {
    display: block;
    width: 32px;
    height: 32px;
    object-fit: contain;
    image-rendering: pixelated;
  }

  .scrap-tooltip {
    position: absolute;
    left: 4px;
    bottom: calc(100% + 6px);
    z-index: 30;
    width: max-content;
    max-width: 280px;
    overflow: hidden;
    padding: 6px 8px;
    border: 1px solid rgba(61, 56, 51, 0.16);
    border-radius: 3px;
    background: rgba(250, 247, 242, 0.97);
    box-shadow: 0 5px 14px rgba(61, 56, 51, 0.12);
    color: #5c554e;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    line-height: 1.35;
    opacity: 0;
    pointer-events: none;
    text-overflow: ellipsis;
    white-space: nowrap;
    transform: translateY(3px);
    transition:
      opacity 100ms ease,
      transform 100ms ease;
  }

  .inventory-card:hover .scrap-tooltip,
  .overflow-item:hover .scrap-tooltip {
    opacity: 1;
    transform: translateY(0);
  }

  .overflow-section {
    margin-top: 12px;
  }

  .overflow-label {
    margin: 0 0 6px 2px;
    color: #8a8279;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .overflow-shelf {
    display: flex;
    min-height: 68px;
    align-items: center;
    gap: 8px;
    overflow-x: auto;
    padding: 6px 8px;
    border: 1px solid #c8b9a5;
    background:
      linear-gradient(to bottom, rgba(255, 255, 255, 0.34), transparent 42%),
      #e9dfd0;
    box-shadow:
      inset 0 4px 8px rgba(103, 77, 50, 0.06),
      inset 0 -2px 0 rgba(137, 104, 72, 0.16);
  }

  .overflow-item {
    position: relative;
    display: flex;
    height: 54px;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    border: 1px solid rgba(128, 102, 73, 0.28);
    border-radius: 3px;
    background: #f2eadf;
    box-shadow: 0 2px 5px rgba(79, 57, 38, 0.09);
    cursor: grab;
    touch-action: none;
  }

  .overflow-item .scrap-content--image {
    padding: 4px;
  }

  .footprint-size {
    position: absolute;
    right: 3px;
    bottom: 2px;
    color: #8a8279;
    font-family: "Martian Mono", monospace;
    font-size: 6px;
    pointer-events: none;
  }

  .overflow-empty {
    color: #958b80;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
  }

  .hud {
    display: flex;
    justify-content: center;
    gap: 7px;
    margin-top: 10px;
  }

  .hud-chip {
    padding: 6px 8px;
    border: 1px solid #d8d0c0;
    border-radius: 2px;
    background: rgba(245, 240, 232, 0.78);
    color: #756c63;
    font-family: "Martian Mono", monospace;
    font-size: 8px;
    line-height: 1;
  }
`;

function imageArea(item: Extract<ScrapItem, { kind: "image" }>): number {
  return item.naturalWidth * item.naturalHeight;
}

function getFootprints(items: ScrapItem[]): Record<string, Footprint> {
  const images = items.filter(
    (item): item is Extract<ScrapItem, { kind: "image" }> =>
      item.kind === "image",
  );
  const largeImageCount = Math.ceil(
    images.length / IMAGE_LARGE_TIER_DIVISOR,
  );
  const largeImageIds = new Set(
    images
      .slice()
      .sort((a, b) => imageArea(b) - imageArea(a))
      .slice(0, largeImageCount)
      .map((item) => item.id),
  );

  return Object.fromEntries(
    items.map((item): [string, Footprint] => {
      switch (item.kind) {
        case "image": {
          const aspectRatio = item.naturalWidth / item.naturalHeight;
          let footprint =
            aspectRatio > 1.4
              ? { cols: 3, rows: 2 }
              : aspectRatio < 0.7
                ? { cols: 2, rows: 3 }
                : { cols: 2, rows: 2 };

          if (largeImageIds.has(item.id)) {
            footprint = {
              cols: Math.min(4, footprint.cols + 1),
              rows: Math.min(3, footprint.rows + 1),
            };
          }
          return [item.id, footprint];
        }
        case "button":
          return [
            item.id,
            {
              cols: Math.max(
                2,
                Math.ceil((10 * item.text.length + 30) / CELL_SIZE),
              ),
              rows: 1,
            },
          ];
        case "svg-icon":
        case "cursor":
          return [item.id, { cols: 1, rows: 1 }];
      }
    }),
  );
}

function fitsInCells(
  occupied: boolean[][],
  position: GridPosition,
  footprint: Footprint,
): boolean {
  if (
    position.col < 0 ||
    position.row < 0 ||
    position.col + footprint.cols > GRID_COLUMNS ||
    position.row + footprint.rows > GRID_ROWS
  ) {
    return false;
  }

  for (let row = position.row; row < position.row + footprint.rows; row += 1) {
    for (
      let col = position.col;
      col < position.col + footprint.cols;
      col += 1
    ) {
      if (occupied[row][col]) return false;
    }
  }
  return true;
}

function markCells(
  occupied: boolean[][],
  position: GridPosition,
  footprint: Footprint,
): void {
  for (let row = position.row; row < position.row + footprint.rows; row += 1) {
    for (
      let col = position.col;
      col < position.col + footprint.cols;
      col += 1
    ) {
      occupied[row][col] = true;
    }
  }
}

function packItems(
  items: ScrapItem[],
  footprints: Record<string, Footprint>,
): PlacementMap {
  const occupied = Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLUMNS }, () => false),
  );
  const sortedItems = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const aFootprint = footprints[a.item.id];
      const bFootprint = footprints[b.item.id];
      const areaDifference =
        bFootprint.cols * bFootprint.rows -
        aFootprint.cols * aFootprint.rows;
      return areaDifference || a.index - b.index;
    });
  const placements: PlacementMap = {};

  for (const { item } of sortedItems) {
    const footprint = footprints[item.id];
    let position: GridPosition | null = null;

    search: for (
      let row = 0;
      row <= GRID_ROWS - footprint.rows;
      row += 1
    ) {
      for (
        let col = 0;
        col <= GRID_COLUMNS - footprint.cols;
        col += 1
      ) {
        const candidate = { col, row };
        if (!fitsInCells(occupied, candidate, footprint)) continue;
        position = candidate;
        break search;
      }
    }

    if (position) markCells(occupied, position, footprint);
    placements[item.id] = { footprint, position };
  }

  return placements;
}

function occupiedByOtherItems(
  placements: PlacementMap,
  draggedItemId: string,
): boolean[][] {
  const occupied = Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLUMNS }, () => false),
  );

  for (const [itemId, placement] of Object.entries(placements)) {
    if (itemId === draggedItemId || !placement.position) continue;
    markCells(occupied, placement.position, placement.footprint);
  }
  return occupied;
}

function calculateTarget(
  board: HTMLDivElement | null,
  placements: PlacementMap,
  drag: Pick<
    DragState,
    | "itemId"
    | "footprint"
    | "pointerX"
    | "pointerY"
    | "grabOffsetX"
    | "grabOffsetY"
  >,
): DragTarget | null {
  if (!board) return null;
  const boardBounds = board.getBoundingClientRect();
  const position = {
    col: Math.round(
      (drag.pointerX - drag.grabOffsetX - boardBounds.left) / CELL_SIZE,
    ),
    row: Math.round(
      (drag.pointerY - drag.grabOffsetY - boardBounds.top) / CELL_SIZE,
    ),
  };
  const occupied = occupiedByOtherItems(placements, drag.itemId);

  return {
    ...position,
    valid: fitsInCells(occupied, position, drag.footprint),
  };
}

function FittedButton({ item }: FittedButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLSpanElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const button = buttonRef.current;
    if (!container || !button) return;

    const fitButton = () => {
      const availableWidth = container.clientWidth;
      const buttonWidth = button.scrollWidth;
      setScale(
        buttonWidth > 0 ? Math.min(1, availableWidth / buttonWidth) : 1,
      );
    };

    fitButton();
    const observer = new ResizeObserver(fitButton);
    observer.observe(container);
    return () => observer.disconnect();
  }, [item]);

  return (
    <div ref={containerRef} className="scrap-content scrap-content--button">
      <span
        ref={buttonRef}
        className="scrap-button"
        style={{
          ...(item.styles as React.CSSProperties),
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          whiteSpace: "nowrap",
          transform: `scale(${scale})`,
        }}
      >
        {item.innerSvg && (
          <span
            className="scrap-button__icon"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: item.innerSvg }}
          />
        )}
        {item.text}
      </span>
    </div>
  );
}

function ScrapContent({ item }: ScrapContentProps) {
  switch (item.kind) {
    case "image":
      return (
        <img
          className="scrap-content scrap-content--image"
          src={item.src}
          alt={item.alt ?? ""}
          draggable={false}
        />
      );
    case "button":
      return <FittedButton item={item} />;
    case "svg-icon":
      return (
        <div
          className="scrap-content scrap-content--svg"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: item.markup }}
        />
      );
    case "cursor":
      return (
        <img
          className="scrap-content--cursor"
          src={item.url}
          alt=""
          draggable={false}
        />
      );
  }
}

function InventoryCard({
  item,
  footprint,
  className = "",
  onPointerDown,
  style,
  showTooltip = true,
}: InventoryCardProps) {
  return (
    <div
      className={`inventory-card ${className}`}
      onPointerDown={onPointerDown}
      style={style}
    >
      <ScrapContent item={item} />
      {showTooltip && (
        <span className="scrap-tooltip">
          {item.pageTitle} · {item.domain}
        </span>
      )}
      <span className="footprint-size">
        {footprint.cols}×{footprint.rows}
      </span>
    </div>
  );
}

function cardPositionStyle(
  position: GridPosition,
  footprint: Footprint,
): React.CSSProperties {
  return {
    left: position.col * CELL_SIZE + 2,
    top: position.row * CELL_SIZE + 2,
    width: footprint.cols * CELL_SIZE - 4,
    height: footprint.rows * CELL_SIZE - 4,
  };
}

function ScrapCabinet() {
  const items = useMemo(() => buildItems(), []);
  const itemsById = useMemo(
    () => new Map(items.map((item) => [item.id, item])),
    [items],
  );
  const footprints = useMemo(() => getFootprints(items), [items]);
  const [placements, setPlacements] = useState<PlacementMap>(() =>
    packItems(items, footprints),
  );
  const [drag, setDrag] = useState<DragState | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  const startDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    itemId: string,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const placement = placements[itemId];
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = placement.footprint.cols * CELL_SIZE;
    const height = placement.footprint.rows * CELL_SIZE;
    const horizontalRatio =
      bounds.width > 0 ? (event.clientX - bounds.left) / bounds.width : 0.5;
    const verticalRatio =
      bounds.height > 0 ? (event.clientY - bounds.top) / bounds.height : 0.5;
    const initialDrag = {
      itemId,
      origin: {
        footprint: { ...placement.footprint },
        position: placement.position ? { ...placement.position } : null,
      },
      footprint: { ...placement.footprint },
      pointerX: event.clientX,
      pointerY: event.clientY,
      grabOffsetX: horizontalRatio * width,
      grabOffsetY: verticalRatio * height,
      target: null,
    };

    setDrag({
      ...initialDrag,
      target: calculateTarget(boardRef.current, placements, initialDrag),
    });
  };

  useEffect(() => {
    if (!drag) return;

    const previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = "none";

    const moveDrag = (event: PointerEvent) => {
      setDrag((current) => {
        if (!current) return null;
        const moved = {
          ...current,
          pointerX: event.clientX,
          pointerY: event.clientY,
        };
        return {
          ...moved,
          target: calculateTarget(boardRef.current, placements, moved),
        };
      });
    };

    const finishDrag = () => {
      setDrag((current) => {
        if (current?.target?.valid) {
          setPlacements((existing) => ({
            ...existing,
            [current.itemId]: {
              footprint: current.footprint,
              position: {
                col: current.target?.col ?? 0,
                row: current.target?.row ?? 0,
              },
            },
          }));
        }
        return null;
      });
    };

    const cancelDrag = () => setDrag(null);

    const rotateDrag = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "r") return;
      event.preventDefault();
      setDrag((current) => {
        if (!current || current.footprint.rows === 1) return current;
        const footprint = {
          cols: current.footprint.rows,
          rows: current.footprint.cols,
        };
        const grabOffsetX =
          (current.grabOffsetX / (current.footprint.cols * CELL_SIZE)) *
          footprint.cols *
          CELL_SIZE;
        const grabOffsetY =
          (current.grabOffsetY / (current.footprint.rows * CELL_SIZE)) *
          footprint.rows *
          CELL_SIZE;
        const rotated = {
          ...current,
          footprint,
          grabOffsetX,
          grabOffsetY,
        };
        return {
          ...rotated,
          target: calculateTarget(boardRef.current, placements, rotated),
        };
      });
    };

    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", cancelDrag);
    window.addEventListener("keydown", rotateDrag);
    return () => {
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", moveDrag);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelDrag);
      window.removeEventListener("keydown", rotateDrag);
    };
  }, [drag?.itemId, placements]);

  const overflowItems = items.filter(
    (item) => placements[item.id].position === null,
  );
  const usedCells = Object.values(placements).reduce(
    (total, placement) =>
      total +
      (placement.position
        ? placement.footprint.cols * placement.footprint.rows
        : 0),
    0,
  );
  const kindCounts = items.reduce(
    (counts, item) => {
      counts[item.kind] += 1;
      return counts;
    },
    { image: 0, button: 0, "svg-icon": 0, cursor: 0 },
  );

  return (
    <main className="scrap-page">
      <style>{PAGE_STYLES}</style>
      <span className="wordmark">we were online</span>
      <header className="page-header">
        <h1>scrap cabinet</h1>
        <p>drag to rearrange · press r while dragging to rotate</p>
      </header>

      <section className="cabinet" aria-label="Scrap cabinet inventory">
        <div className="inventory-frame">
          <div ref={boardRef} className="inventory-board">
            <div className="inventory-slots" aria-hidden="true">
              {Array.from(
                { length: GRID_COLUMNS * GRID_ROWS },
                (_, index) => (
                  <span key={index} className="inventory-slot" />
                ),
              )}
            </div>

            {items.map((item) => {
              const placement = placements[item.id];
              if (!placement.position || drag?.itemId === item.id) return null;
              return (
                <InventoryCard
                  key={item.id}
                  item={item}
                  footprint={placement.footprint}
                  onPointerDown={(event) => startDrag(event, item.id)}
                  style={cardPositionStyle(
                    placement.position,
                    placement.footprint,
                  )}
                />
              );
            })}

            {drag?.origin.position && (
              <div
                className="inventory-card inventory-card--reserved"
                style={cardPositionStyle(
                  drag.origin.position,
                  drag.origin.footprint,
                )}
              />
            )}

            {drag?.target && (
              <div
                className={`drop-target ${
                  drag.target.valid
                    ? "drop-target--valid"
                    : "drop-target--invalid"
                }`}
                style={{
                  left: drag.target.col * CELL_SIZE,
                  top: drag.target.row * CELL_SIZE,
                  width: drag.footprint.cols * CELL_SIZE,
                  height: drag.footprint.rows * CELL_SIZE,
                }}
              />
            )}
          </div>
        </div>

        <div className="overflow-section">
          <p className="overflow-label">overflow shelf</p>
          <div className="overflow-shelf">
            {overflowItems.length === 0 && (
              <span className="overflow-empty">all scraps packed</span>
            )}
            {overflowItems.map((item) => {
              const placement = placements[item.id];
              if (drag?.itemId === item.id) {
                return (
                  <span
                    key={item.id}
                    className="overflow-empty"
                    style={{ width: 54, textAlign: "center" }}
                  >
                    reserved
                  </span>
                );
              }
              return (
                <InventoryCard
                  key={item.id}
                  item={item}
                  footprint={placement.footprint}
                  className="overflow-item"
                  onPointerDown={(event) => startDrag(event, item.id)}
                  style={{
                    position: "relative",
                    width: Math.min(
                      168,
                      Math.max(CELL_SIZE, placement.footprint.cols * CELL_SIZE),
                    ),
                    height: 54,
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="hud">
          <span className="hud-chip">
            images {kindCounts.image} · buttons {kindCounts.button} · icons{" "}
            {kindCounts["svg-icon"]} · cursors {kindCounts.cursor}
          </span>
          <span className="hud-chip">
            cells used {usedCells}/{GRID_COLUMNS * GRID_ROWS}
          </span>
        </div>
      </section>

      {drag &&
        (() => {
          const item = itemsById.get(drag.itemId);
          if (!item) return null;
          return (
            <InventoryCard
              item={item}
              footprint={drag.footprint}
              className="inventory-card--ghost"
              showTooltip={false}
              style={{
                left: drag.pointerX - drag.grabOffsetX + 2,
                top: drag.pointerY - drag.grabOffsetY + 2,
                width: drag.footprint.cols * CELL_SIZE - 4,
                height: drag.footprint.rows * CELL_SIZE - 4,
              }}
            />
          );
        })()}
    </main>
  );
}

const container = document.getElementById("reactContent");
if (container) {
  createRoot(container).render(<ScrapCabinet />);
}
