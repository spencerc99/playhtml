// ABOUTME: Shared catalog and access contract for WWO extension experiments.
// ABOUTME: Keeps the extension, Worker, and admin dashboard aligned on known feature identifiers.

export const FEATURE_STAGES = ["internal", "beta", "lab", "released"] as const;

export type FeatureStage = (typeof FEATURE_STAGES)[number];

export const FEATURE_CATALOG = {
  COPRESENCE: {
    name: "People here",
    description: "Show shared cursors and the number of people on a page.",
    defaultStage: "released",
    requiresReload: true,
  },
  BOTTLES: {
    name: "Message bottles",
    description: "Find and leave messages with other people across the web.",
    defaultStage: "internal",
    requiresReload: true,
  },
  INVENTORY: {
    name: "Satchel",
    description: "Collect and carry objects found on PlayHTML pages.",
    defaultStage: "released",
    requiresReload: true,
  },
  SCRAPS: {
    name: "Internet scraps",
    description: "Collect a local collage of distinctive things you encounter.",
    defaultStage: "beta",
    requiresReload: true,
  },
  BAG_SETTINGS: {
    name: "Bag settings",
    description: "Show controls for unfinished PlayHTML Bag features.",
    defaultStage: "internal",
    requiresReload: false,
  },
  COMMUTE: {
    name: "Internet Commute",
    description: "Ride a slow train through pages people found recently.",
    defaultStage: "beta",
    requiresReload: false,
  },
  PAGE_COLLECTION: {
    name: "Page collection",
    description: "Discover sites and collect elements marked with can-collect.",
    defaultStage: "internal",
    requiresReload: true,
  },
  EMOTES: {
    name: "Emotes",
    description: "Use experimental on-page social reactions.",
    defaultStage: "internal",
    requiresReload: true,
  },
} as const satisfies Record<
  string,
  {
    name: string;
    description: string;
    defaultStage: FeatureStage;
    requiresReload: boolean;
  }
>;

export type FeatureId = keyof typeof FEATURE_CATALOG;

export const FEATURE_IDS = Object.keys(FEATURE_CATALOG) as FeatureId[];

export type FeaturePolicy = {
  stage: FeatureStage;
  available: boolean;
};

export type FeatureAccessSnapshot = {
  features: Record<FeatureId, FeaturePolicy>;
  checkedAt: number;
};

export function isFeatureId(value: string): value is FeatureId {
  return Object.prototype.hasOwnProperty.call(FEATURE_CATALOG, value);
}

export function isFeatureStage(value: string): value is FeatureStage {
  return FEATURE_STAGES.includes(value as FeatureStage);
}
