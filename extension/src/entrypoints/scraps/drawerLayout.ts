// ABOUTME: Lays the scrap drawer out as columns of natural-aspect thumbnails.
// ABOUTME: Offsets are precomputed so the visible range stays a lookup at any size.

import {
  headingDisplayFontSize,
  type ScrapItem,
} from "@movement/components/ScrapCollage";

/** A placed thumbnail: which column it went in and where it sits. */
export interface DrawerCell {
  item: ScrapItem;
  column: number;
  top: number;
  height: number;
}

export interface DrawerLayout {
  cells: DrawerCell[];
  /** How tall the whole runway is, so the scrollbar is honest. */
  height: number;
  columnWidth: number;
  /** Each column's total height, for placing the next item. */
  columnHeights: number[];
}

/** The gap between thumbnails, and the padding inside a slot. */
const CELL_GAP = 6;

/**
 * A small thing is shown in a plain box at a legible size rather than blown up
 * to a column's width, which would make a 16px icon absurd.
 */
const SMALL_BOX = 72;

/**
 * How a run of words turns into a box. The advance is an average character
 * width as a fraction of the font size, matching the estimate the browse view
 * lays headings out with, so a heading occupies comparable room in both.
 */
const HEADING_CHARACTER_ADVANCE = 0.68;
const HEADING_LINE_HEIGHT = 1.15;
const HEADING_PADDING = 16;
const HEADING_MIN_BOX = 44;

/**
 * How tall a scrap wants to be in a column of this width. Images and icons
 * keep their own proportions; the shapes without an intrinsic size get a box
 * that suits what they are.
 */
export function thumbnailHeight(item: ScrapItem, columnWidth: number): number {
  switch (item.kind) {
    case "image": {
      const { naturalWidth, naturalHeight } = item;
      if (
        !Number.isFinite(naturalWidth) ||
        !Number.isFinite(naturalHeight) ||
        naturalWidth <= 0 ||
        naturalHeight <= 0
      ) {
        // A picture whose size was never recorded gets a square, rather than
        // a division by zero or a collapsed sliver.
        return columnWidth;
      }
      return (columnWidth * naturalHeight) / naturalWidth;
    }
    case "svg-icon": {
      const { width, height } = item;
      if (width <= 0 || height <= 0) return Math.min(SMALL_BOX, columnWidth);
      // An icon is usually tiny, so it sits in a small box at its own aspect
      // rather than being stretched across the column.
      const box = Math.min(SMALL_BOX, columnWidth);
      return (box * height) / width;
    }
    case "button":
      // A button is a wide, short thing; its reconstruction is measured on
      // screen but this is the room it is given.
      return Math.min(columnWidth * 0.42, 64);
    case "heading": {
      // A heading is words, so its room is however many lines those words take
      // at the size the shared renderer will actually draw them in this column.
      const fontSize = headingDisplayFontSize(item.styles, item.text, columnWidth);
      const lines = Math.max(
        1,
        Math.ceil(
          (item.text.trim().length * fontSize * HEADING_CHARACTER_ADVANCE) /
            Math.max(1, columnWidth - HEADING_PADDING),
        ),
      );
      return Math.max(
        HEADING_MIN_BOX,
        lines * fontSize * HEADING_LINE_HEIGHT + HEADING_PADDING,
      );
    }
    case "cursor":
      return Math.min(SMALL_BOX, columnWidth);
  }
}

/**
 * Places every scrap into the shortest column, top to bottom. One pass over
 * the filtered list, so the visible range is found by reading offsets rather
 * than by measuring anything.
 */
export function layOutDrawer(
  items: readonly ScrapItem[],
  drawerWidth: number,
  columns: number,
): DrawerLayout {
  const safeColumns = Math.max(1, Math.floor(columns));
  const columnWidth =
    (drawerWidth - CELL_GAP * (safeColumns + 1)) / safeColumns;
  const columnHeights = new Array<number>(safeColumns).fill(CELL_GAP);
  const cells: DrawerCell[] = [];

  for (const item of items) {
    // The shortest column takes the next scrap, which keeps the columns level
    // without any backtracking.
    let column = 0;
    for (let index = 1; index < safeColumns; index += 1) {
      if (columnHeights[index] < columnHeights[column]) column = index;
    }
    const height = Math.max(1, Math.round(thumbnailHeight(item, columnWidth)));
    cells.push({ item, column, top: columnHeights[column], height });
    columnHeights[column] += height + CELL_GAP;
  }

  return {
    cells,
    height: Math.max(...columnHeights, CELL_GAP),
    columnWidth,
    columnHeights,
  };
}

/**
 * The cells that fall inside the scrolled view, plus a margin above and below
 * so scrolling does not reveal gaps. Cells are in placement order, not top
 * order, so this is a filter rather than a slice.
 */
export function visibleCells(
  layout: DrawerLayout,
  scrollTop: number,
  viewportHeight: number,
  overscan: number,
): DrawerCell[] {
  const from = scrollTop - overscan;
  const to = scrollTop + viewportHeight + overscan;
  return layout.cells.filter(
    (cell) => cell.top + cell.height >= from && cell.top <= to,
  );
}

/** Where a cell sits across the drawer, as a left offset in pixels. */
export function cellLeft(cell: DrawerCell, columnWidth: number): number {
  return CELL_GAP + cell.column * (columnWidth + CELL_GAP);
}

export { CELL_GAP, SMALL_BOX };
