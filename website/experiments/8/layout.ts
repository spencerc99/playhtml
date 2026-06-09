// ABOUTME: Calculates grid cell positions for experiment 8 typing.
// ABOUTME: Keeps render math shared by the React view and tests.
export const GRID_CELL_SIZE_PX = 32;
export const BOTTOM_BAR_HEIGHT_PX = 64;
export const SCROLL_END_TOLERANCE_PX = 1;

export interface TypingCursorAwareness {
  color: string;
  cursorPos: number;
}

export function getTypingCursorPosition(letterCount: number): number {
  assertNonNegativeInteger(letterCount, "letterCount");
  return letterCount;
}

export function getGridCellCount({
  letterCount,
  minimumCellCount,
  columnCount,
}: {
  letterCount: number;
  minimumCellCount: number;
  columnCount?: number;
}): number {
  assertNonNegativeInteger(letterCount, "letterCount");
  assertNonNegativeInteger(minimumCellCount, "minimumCellCount");

  if (columnCount !== undefined) {
    return getTrailingCellCount({
      cursorPosition: getTypingCursorPosition(letterCount),
      columnCount,
    });
  }

  return Math.max(minimumCellCount, letterCount + 1);
}

export function getTrailingCellCount({
  cursorPosition,
  columnCount,
}: {
  cursorPosition: number;
  columnCount: number;
}): number {
  assertNonNegativeInteger(cursorPosition, "cursorPosition");
  assertPositiveInteger(columnCount, "columnCount");

  const cursorRow = Math.floor(cursorPosition / columnCount);
  return (cursorRow + 2) * columnCount;
}

export function getBottomScrollClearancePx({
  bottomBarHeightPx,
}: {
  bottomBarHeightPx: number;
}): number {
  assertNonNegativeInteger(bottomBarHeightPx, "bottomBarHeightPx");

  return bottomBarHeightPx;
}

export function getGridWidthPx({
  columnCount,
  cellSizePx,
}: {
  columnCount: number;
  cellSizePx: number;
}): number {
  assertPositiveInteger(columnCount, "columnCount");
  assertPositiveInteger(cellSizePx, "cellSizePx");

  return columnCount * cellSizePx;
}

export function getGridRowHeightPx({
  cellSizePx,
}: {
  cellSizePx: number;
}): number {
  assertPositiveInteger(cellSizePx, "cellSizePx");

  return cellSizePx;
}

export function getScrollEndY({
  scrollHeight,
  viewportHeight,
}: {
  scrollHeight: number;
  viewportHeight: number;
}): number {
  assertNonNegativeInteger(scrollHeight, "scrollHeight");
  assertNonNegativeInteger(viewportHeight, "viewportHeight");

  return Math.max(0, scrollHeight - viewportHeight);
}

export function isScrollAtEnd({
  scrollY,
  scrollHeight,
  viewportHeight,
  tolerancePx = SCROLL_END_TOLERANCE_PX,
}: {
  scrollY: number;
  scrollHeight: number;
  viewportHeight: number;
  tolerancePx?: number;
}): boolean {
  assertNonNegativeInteger(scrollHeight, "scrollHeight");
  assertNonNegativeInteger(viewportHeight, "viewportHeight");
  assertNonNegativeInteger(tolerancePx, "tolerancePx");

  return getScrollEndY({ scrollHeight, viewportHeight }) - scrollY <= tolerancePx;
}

export function getRemoteTypingCursors({
  awareness,
  myAwareness,
}: {
  awareness: unknown[];
  myAwareness?: TypingCursorAwareness;
}): TypingCursorAwareness[] {
  return awareness.filter(
    (cursor): cursor is TypingCursorAwareness =>
      cursor !== myAwareness && isTypingCursorAwareness(cursor),
  );
}

export function shouldPublishTypingAwareness({
  current,
  next,
}: {
  current?: TypingCursorAwareness;
  next: TypingCursorAwareness;
}): boolean {
  return current?.color !== next.color || current.cursorPos !== next.cursorPos;
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}

function isTypingCursorAwareness(value: unknown): value is TypingCursorAwareness {
  if (!value || typeof value !== "object") return false;

  const cursor = value as TypingCursorAwareness;
  return typeof cursor.color === "string" && Number.isInteger(cursor.cursorPos);
}
