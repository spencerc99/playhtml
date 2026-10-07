// ABOUTME: Remembers how wide the scrap drawer is and whether it is tucked away.
// ABOUTME: Browser storage can be unavailable, so every read and write is guarded.

const STORAGE_KEY = "wwoScrapDrawer";

/**
 * The column width the drawer aims for. Its own width sets how many columns
 * there are, rounded to the nearest whole count, so the columns always fill
 * the drawer and stay near this size as it is dragged wider or narrower.
 */
export const DRAWER_COLUMN_TARGET = 128;

export const DRAWER_DEFAULT_COLUMNS = 3;
export const DRAWER_MIN_COLUMNS = 1;
/** Width of the rail the drawer tucks into when collapsed. */
export const DRAWER_RAIL_WIDTH = 26;

export interface DrawerPreference {
  width: number;
  collapsed: boolean;
}

/** The default width shows three columns at the target size. */
export function defaultDrawerWidth(): number {
  return DRAWER_DEFAULT_COLUMNS * DRAWER_COLUMN_TARGET;
}

export function minDrawerWidth(): number {
  return DRAWER_MIN_COLUMNS * DRAWER_COLUMN_TARGET;
}

/** The drawer may take at most about half the window. */
export function maxDrawerWidth(windowWidth: number): number {
  return Math.max(minDrawerWidth(), Math.round(windowWidth / 2));
}

export function clampDrawerWidth(
  width: number,
  windowWidth: number,
): number {
  return Math.min(
    maxDrawerWidth(windowWidth),
    Math.max(minDrawerWidth(), Math.round(width)),
  );
}

/** How many columns a drawer of this width shows, each near the target width. */
export function drawerColumns(width: number): number {
  return Math.max(
    DRAWER_MIN_COLUMNS,
    Math.round(width / DRAWER_COLUMN_TARGET),
  );
}

export function readDrawerPreference(): DrawerPreference {
  const fallback: DrawerPreference = {
    width: defaultDrawerWidth(),
    collapsed: false,
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
