// ABOUTME: Remembers how wide the scrap drawer is and whether it is tucked away.
// ABOUTME: Browser storage can be unavailable, so every read and write is guarded.

const STORAGE_KEY = "wwoScrapDrawer";

/** How big a scrap is shown in the drawer. */
export type DrawerSlotSize = "small" | "medium" | "large";

export const SLOT_SIZES: Record<DrawerSlotSize, number> = {
  small: 84,
  medium: 128,
  large: 176,
};

export const DEFAULT_SLOT_SIZE: DrawerSlotSize = "medium";
export const SLOT_SIZE_NAMES = Object.keys(SLOT_SIZES) as DrawerSlotSize[];

export function isSlotSize(value: unknown): value is DrawerSlotSize {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SLOT_SIZES, value)
  );
}

export const DRAWER_DEFAULT_COLUMNS = 3;
export const DRAWER_MIN_COLUMNS = 1;
/** Width of the rail the drawer tucks into when collapsed. */
export const DRAWER_RAIL_WIDTH = 26;

export interface DrawerPreference {
  width: number;
  collapsed: boolean;
  slotSize: DrawerSlotSize;
}

/** The default width follows from showing three slots at the default size. */
export function defaultDrawerWidth(
  slotSize: DrawerSlotSize = DEFAULT_SLOT_SIZE,
): number {
  return DRAWER_DEFAULT_COLUMNS * SLOT_SIZES[slotSize];
}

export function minDrawerWidth(slotSize: DrawerSlotSize = DEFAULT_SLOT_SIZE): number {
  return DRAWER_MIN_COLUMNS * SLOT_SIZES[slotSize];
}

/** The drawer may take at most about half the window. */
export function maxDrawerWidth(windowWidth: number): number {
  return Math.max(minDrawerWidth(), Math.round(windowWidth / 2));
}

export function clampDrawerWidth(
  width: number,
  windowWidth: number,
  slotSize: DrawerSlotSize = DEFAULT_SLOT_SIZE,
): number {
  return Math.min(
    maxDrawerWidth(windowWidth),
    Math.max(minDrawerWidth(slotSize), Math.round(width)),
  );
}

/** How many whole columns of this slot size fit in a drawer of this width. */
export function drawerColumns(
  width: number,
  slotSize: DrawerSlotSize = DEFAULT_SLOT_SIZE,
): number {
  return Math.max(
    DRAWER_MIN_COLUMNS,
    Math.floor(width / SLOT_SIZES[slotSize]),
  );
}

export function readDrawerPreference(): DrawerPreference {
  const fallback: DrawerPreference = {
    width: defaultDrawerWidth(),
    collapsed: false,
    slotSize: DEFAULT_SLOT_SIZE,
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const stored = JSON.parse(raw) as Record<string, unknown>;
    return {
      width:
        typeof stored.width === "number" && Number.isFinite(stored.width)
          ? stored.width
          : fallback.width,
      collapsed: stored.collapsed === true,
      slotSize: isSlotSize(stored.slotSize) ? stored.slotSize : DEFAULT_SLOT_SIZE,
    };
  } catch {
    return fallback;
  }
}

export function writeDrawerPreference(preference: DrawerPreference): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // A drawer that cannot remember its width is still a usable drawer.
  }
}
