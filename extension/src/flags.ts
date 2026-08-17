// ABOUTME: Catalog of user-facing and experimental browser extension features.
// ABOUTME: Defines release state and labels used by runtime gates and internal settings.

export const FEATURE_CATALOG = {
  COPRESENCE: {
    name: "People here",
    description: "Show shared cursors and the number of people on a page.",
    released: true,
    requiresReload: true,
  },
  BOTTLES: {
    name: "Message bottles",
    description: "Find and leave messages with other people across the web.",
    released: false,
    requiresReload: true,
  },
  QUARANTINE_TAPE: {
    name: "Quarantine tape",
    description: "Try the page-level quarantine tape social experiment.",
    released: false,
    requiresReload: true,
  },
  INVENTORY: {
    name: "Satchel",
    description: "Collect and carry objects found on PlayHTML pages.",
    released: true,
    requiresReload: true,
  },
  SCRAPS: {
    name: "Internet scraps",
    description: "Collect a local collage of distinctive things you encounter.",
    released: false,
    requiresReload: true,
  },
  BAG_SETTINGS: {
    name: "Bag settings",
    description: "Show controls for unfinished PlayHTML Bag features.",
    released: false,
    requiresReload: false,
  },
  COMMUTE: {
    name: "Internet Commute",
    description: "Ride a slow train through pages people found recently.",
    released: false,
    requiresReload: false,
  },
  PAGE_COLLECTION: {
    name: "Page collection",
    description: "Discover sites and collect elements marked with can-collect.",
    released: false,
    requiresReload: true,
  },
  EMOTES: {
    name: "Emotes",
    description: "Use experimental on-page social reactions.",
    released: false,
    requiresReload: true,
  },
} as const;

export type FeatureId = keyof typeof FEATURE_CATALOG;
export type FeatureOverrides = Partial<Record<FeatureId, boolean>>;

export const FEATURE_IDS = Object.keys(FEATURE_CATALOG) as FeatureId[];

export const FLAGS = Object.fromEntries(
  FEATURE_IDS.map((feature) => [feature, FEATURE_CATALOG[feature].released]),
) as { [Feature in FeatureId]: (typeof FEATURE_CATALOG)[Feature]["released"] };

export function isFeatureId(value: string): value is FeatureId {
  return Object.prototype.hasOwnProperty.call(FEATURE_CATALOG, value);
}

export type FeatureState = {
  enabled: boolean;
  source: "released" | "internal-access" | "override" | "unavailable";
};

export function resolveFeatureState(
  feature: FeatureId,
  options: {
    internalAccess: boolean;
    overrides?: FeatureOverrides;
  },
): FeatureState {
  const override = options.overrides?.[feature];
  if (options.internalAccess && override !== undefined) {
    return { enabled: override, source: "override" };
  }

  if (FEATURE_CATALOG[feature].released) {
    return { enabled: true, source: "released" };
  }

  if (options.internalAccess) {
    return { enabled: true, source: "internal-access" };
  }

  return { enabled: false, source: "unavailable" };
}
