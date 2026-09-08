// ABOUTME: Defines the named screen profiles used by the live WWO installation.
// ABOUTME: Keeps stable machine URLs separate from centrally deployed visual settings.

import type { LiveInstallationScreenConfig } from "./liveInstallation";
import type { MovementSettings } from "../components/settingsDefaults";
import {
  DEFAULT_CINEMATIC_CONFIG,
  type CinematicConfig,
} from "./cinematicCamera";

export const LIVE_INSTALLATION_PROFILE_NAMES = [
  "scrolling",
  "typing",
  "touches",
  "clicks",
  "cursors",
  "follower-a",
  "follower-b",
  "follower-c",
  "follower-d",
] as const;

export type LiveInstallationProfileName =
  (typeof LIVE_INSTALLATION_PROFILE_NAMES)[number];

interface TouchesProfileSettings {
  scale: number;
  touchRadius: number;
  speed: number;
  showCursors: boolean;
  samePersonOk: boolean;
  night: boolean;
  renderer: "glsl" | "nebula" | "pinwheel";
  markStyle: "hands" | "fingerprint" | "blot" | "wear" | "stitch" | "nebula";
}

export interface LiveInstallationProfile {
  label: string;
  pathname: "/installation/live/" | "/touches/";
  role: "master" | "follower";
  defaultSoundEnabled?: boolean;
  followerId?: string;
  cinematic: CinematicConfig | null;
  visualizations: string[];
  screen?: LiveInstallationScreenConfig;
  settings: Partial<MovementSettings>;
  touchesSettings?: TouchesProfileSettings;
  continuousLiveTrails?: boolean;
}

const CURSOR_SETTINGS = {
  trailAnimationMode: "natural",
  strokeWidth: 6,
  trailOpacity: 0.9,
  maxConcurrentTrails: 24,
  clickOpacity: 0.3,
  textboxOpacity: 0.2,
} satisfies Partial<MovementSettings>;

const SCROLLING_SETTINGS = {
  trailOpacity: 0.9,
  strokeWidth: 6.5,
  animationSpeed: 3,
  maxConcurrentTrails: 16,
  clickMaxGapMs: 850,
  scrollSpeed: 1,
  backgroundOpacity: 0.9,
  maxConcurrentScrolls: 42,
  allowOverlap: true,
  windowBleed: 0.25,
  windowScale: 0.7,
  textboxOpacity: 0.2,
  keyboardRandomizeOrder: true,
} satisfies Partial<MovementSettings>;

const TYPING_SETTINGS = {
  trailOpacity: 0.9,
  strokeWidth: 6.5,
  animationSpeed: 3,
  maxConcurrentTrails: 16,
  clickMaxGapMs: 850,
  scrollSpeed: 0.2,
  backgroundOpacity: 1,
  maxConcurrentScrolls: 42,
  allowOverlap: true,
  windowBleed: 0.25,
  windowScale: 0.7,
  textboxOpacity: 0.85,
  keyboardMinFontSize: 8,
  keyboardMaxFontSize: 16,
  keyboardAnimationSpeed: 0.4,
  keyboardPositionRandomness: 0.8,
  keyboardRandomizeOrder: true,
  maxConcurrentTyping: 50,
  keyboardSizeCap: 0.3,
  keyboardMaxAspect: 2.5,
} satisfies Partial<MovementSettings>;

const CLICK_SETTINGS = {
  trailOpacity: 0.9,
  strokeWidth: 6.5,
  animationSpeed: 3,
  maxConcurrentTrails: 16,
  clickMaxRadius: 55,
  clickNumRings: 6,
  clickMaxGapMs: 850,
  scrollSpeed: 0.2,
  backgroundOpacity: 0.9,
  maxConcurrentScrolls: 42,
  allowOverlap: true,
  windowBleed: 0.25,
  windowScale: 0.7,
  textboxOpacity: 0.2,
  keyboardRandomizeOrder: true,
} satisfies Partial<MovementSettings>;

const TOUCHES_SETTINGS: TouchesProfileSettings = {
  scale: 2,
  touchRadius: 20,
  speed: 1,
  showCursors: true,
  samePersonOk: false,
  night: false,
  renderer: "nebula",
  markStyle: "hands",
};

const field = (): LiveInstallationScreenConfig => ({
  view: "field",
  slot: 0,
  slots: 4,
});

const follower = (slot: number): LiveInstallationScreenConfig => ({
  view: "follow",
  slot,
  slots: 4,
});

export const LIVE_INSTALLATION_PROFILES: Record<
  LiveInstallationProfileName,
  LiveInstallationProfile
> = {
  scrolling: {
    label: "scrolling",
    pathname: "/installation/live/",
    role: "master",
    cinematic: null,
    visualizations: ["scrolling"],
    screen: field(),
    settings: SCROLLING_SETTINGS,
  },
  typing: {
    label: "keypresses",
    pathname: "/installation/live/",
    role: "master",
    cinematic: null,
    visualizations: ["typing"],
    screen: field(),
    settings: TYPING_SETTINGS,
  },
  touches: {
    label: "touches",
    pathname: "/touches/",
    role: "master",
    cinematic: null,
    visualizations: [],
    settings: {},
    touchesSettings: TOUCHES_SETTINGS,
  },
  clicks: {
    label: "clicks",
    pathname: "/installation/live/",
    role: "master",
    cinematic: null,
    visualizations: ["clicks"],
    screen: field(),
    settings: CLICK_SETTINGS,
  },
  cursors: {
    label: "cursor field",
    pathname: "/installation/live/",
    role: "master",
    defaultSoundEnabled: true,
    cinematic: null,
    visualizations: ["trails"],
    screen: field(),
    settings: CURSOR_SETTINGS,
    continuousLiveTrails: true,
  },
  "follower-a": {
    label: "cursor follower 1",
    pathname: "/installation/live/",
    role: "follower",
    followerId: "a",
    cinematic: { ...DEFAULT_CINEMATIC_CONFIG, zoom: 0.1 },
    visualizations: ["trails"],
    screen: follower(0),
    settings: CURSOR_SETTINGS,
  },
  "follower-b": {
    label: "cursor follower 2",
    pathname: "/installation/live/",
    role: "follower",
    followerId: "b",
    cinematic: { ...DEFAULT_CINEMATIC_CONFIG, zoom: 0.125 },
    visualizations: ["trails"],
    screen: follower(1),
    settings: CURSOR_SETTINGS,
  },
  "follower-c": {
    label: "cursor follower 3",
    pathname: "/installation/live/",
    role: "follower",
    followerId: "c",
    cinematic: { ...DEFAULT_CINEMATIC_CONFIG, zoom: 0.125 },
    visualizations: ["trails"],
    screen: follower(2),
    settings: CURSOR_SETTINGS,
  },
  "follower-d": {
    label: "cursor follower 4",
    pathname: "/installation/live/",
    role: "follower",
    followerId: "d",
    cinematic: { ...DEFAULT_CINEMATIC_CONFIG, zoom: 0.1 },
    visualizations: ["trails"],
    screen: follower(3),
    settings: CURSOR_SETTINGS,
  },
};

export function resolveLiveInstallationProfile(
  search: string = window.location.search,
): LiveInstallationProfile | null {
  const name = new URLSearchParams(search).get("screen");
  if (
    !name ||
    !LIVE_INSTALLATION_PROFILE_NAMES.includes(
      name as LiveInstallationProfileName,
    )
  ) {
    return null;
  }
  return LIVE_INSTALLATION_PROFILES[name as LiveInstallationProfileName];
}
