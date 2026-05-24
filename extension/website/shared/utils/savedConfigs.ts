// ABOUTME: localStorage-backed list of saved viz configurations + auto-naming
// ABOUTME: Each saved entry stores the share URL so restoring is just navigation

const STORAGE_KEY = "internet-movement-saved-configs";
const MAX_ENTRIES = 50;

/** A saved configuration. `name` is what the user (or auto-namer) chose;
 * `url` is the minimal share URL — restoring is just a navigation. */
export interface SavedConfig {
  id: string;
  name: string;
  url: string;
  createdAt: number;
}

/** Map from viz id to a short label for filenames + auto-names. Keep in
 * sync with `VIZ_FILE_LABELS` in MovementCanvas — these need to match so
 * a saved-config name aligns with the screenshot filename. */
const VIZ_LABELS: Record<string, string> = {
  trails: "moving",
  navigation: "browsing",
  clicks: "clicking",
  typing: "typing",
  scrolling: "scrolling",
  favicons: "sites",
};

function formatVizLabel(activeVizIds: string[]): string {
  if (activeVizIds.length === 0) return "movement";
  return activeVizIds.map((id) => VIZ_LABELS[id] ?? id).join("+");
}

function formatTimeRange(range: { startMs: number; endMs: number }): string {
  const start = new Date(range.startMs);
  const end = new Date(range.endMs);
  const sameDay = start.toDateString() === end.toDateString();
  const dateFmt: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const timeFmt: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  if (sameDay) {
    return `${start.toLocaleDateString(undefined, dateFmt)} ${start.toLocaleTimeString(undefined, timeFmt)}–${end.toLocaleTimeString(undefined, timeFmt)}`;
  }
  return `${start.toLocaleDateString(undefined, dateFmt)} → ${end.toLocaleDateString(undefined, dateFmt)}`;
}

export interface AutoNameInput {
  activeVisualizations: string[];
  /** URL-scope chip list — each chip is `{domain, path}` and they OR
   * together. The auto-name shows up to two; "+N more" for the rest. */
  filters: { domain: string; path: string }[];
  /** Persistent player ID — shortened to `pk_abcd…wxyz` in the name. */
  pidFilter: string;
  trailStyle?: string;
  trailStyleIsDefault: boolean;
  selectedTimeRange: { startMs: number; endMs: number } | null;
}

function shortenPid(pid: string): string {
  if (!pid) return "";
  if (pid.length <= 12) return pid;
  return `${pid.slice(0, 7)}…${pid.slice(-4)}`;
}

/** Build a recognizable auto-name from the bits of config most likely to
 * matter at a glance. Format:
 *
 *   `<viz>[ @ <domain>[/path]][ • <trailStyle>][ • <timeRange>]`
 *
 * Examples:
 *   "moving"
 *   "clicking @ google.com/maps"
 *   "browsing+moving @ wikipedia.org"
 *   "moving • organic"
 *   "moving @ google.com • May 9 2:00 PM–3:00 PM"
 *
 * Only includes parts that diverge from defaults, so a default config
 * collapses to just "moving" — easy to spot when you've saved something
 * that's basically untouched. */
export function buildAutoName(input: AutoNameInput): string {
  const parts: string[] = [formatVizLabel(input.activeVisualizations)];

  const chipLabel = (c: { domain: string; path: string }): string => {
    if (!c.domain && !c.path) return "";
    if (!c.domain) {
      return c.path.startsWith("/") ? `*${c.path}` : `*/${c.path}`;
    }
    if (!c.path) return c.domain;
    const path = c.path.startsWith("/") ? c.path : `/${c.path}`;
    return `${c.domain}${path}`;
  };

  // Location segment: chip list (capped) + user-id postfix.
  const chipLabels = (input.filters ?? []).map(chipLabel).filter(Boolean);
  if (chipLabels.length > 0 || input.pidFilter) {
    let loc = "";
    if (chipLabels.length > 0) {
      const shown = chipLabels.slice(0, 2).join(",");
      const extra = chipLabels.length - 2;
      loc = extra > 0 ? `${shown}+${extra}` : shown;
    }
    if (input.pidFilter) {
      const short = shortenPid(input.pidFilter);
      loc = loc ? `${loc} ~ ${short}` : `~${short}`;
    }
    parts[0] = `${parts[0]} @ ${loc}`;
  }

  const tail: string[] = [];
  if (input.trailStyle && !input.trailStyleIsDefault) {
    tail.push(input.trailStyle);
  }
  if (input.selectedTimeRange) {
    tail.push(formatTimeRange(input.selectedTimeRange));
  }
  if (tail.length > 0) {
    return `${parts[0]} • ${tail.join(" • ")}`;
  }
  return parts[0];
}

/** Load saved configs from localStorage. Tolerates corrupt/missing data
 * by returning `[]` — never throws. */
export function loadSavedConfigs(): SavedConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive shape check — drop entries missing required fields.
    return parsed.filter(
      (e): e is SavedConfig =>
        typeof e?.id === "string" &&
        typeof e?.name === "string" &&
        typeof e?.url === "string" &&
        typeof e?.createdAt === "number",
    );
  } catch {
    return [];
  }
}

function persist(list: SavedConfig[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (err) {
    // Quota / serialization errors — log but don't crash the panel.
    console.error("Failed to save configs:", err);
  }
}

/** Append a new config and return the updated list. Newest entries first.
 * Capped at MAX_ENTRIES — oldest entries fall off the end. */
export function addSavedConfig(
  current: SavedConfig[],
  entry: { name: string; url: string },
): SavedConfig[] {
  const next: SavedConfig = {
    id: `cfg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: entry.name,
    url: entry.url,
    createdAt: Date.now(),
  };
  const merged = [next, ...current].slice(0, MAX_ENTRIES);
  persist(merged);
  return merged;
}

export function deleteSavedConfig(
  current: SavedConfig[],
  id: string,
): SavedConfig[] {
  const next = current.filter((c) => c.id !== id);
  persist(next);
  return next;
}

export function renameSavedConfig(
  current: SavedConfig[],
  id: string,
  name: string,
): SavedConfig[] {
  const next = current.map((c) => (c.id === id ? { ...c, name } : c));
  persist(next);
  return next;
}

/** Subscribe to cross-tab saved-config changes. Browsers fire `storage`
 * events on *other* tabs when one tab calls `setItem`/`removeItem`, so
 * the management page and the dev panel stay in sync without polling.
 *
 * Returns an unsubscribe function for cleanup in `useEffect`. */
export function subscribeSavedConfigs(
  callback: (configs: SavedConfig[]) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY && e.key !== null) return;
    callback(loadSavedConfigs());
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
