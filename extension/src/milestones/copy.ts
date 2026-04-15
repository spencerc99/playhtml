// ABOUTME: Copy pools for milestone toast notifications.
// ABOUTME: Edit the arrays here to change what text appears in each milestone type.

export const MILESTONE_COPY = {
  cursorDistance: [
    "your hand has been busy",
    "your cursor's running around",
    "good pixel coverage today!",
    "lots of browsing today",
  ],
  screenTime: [
    "you've been present",
    "this page held your attention",
    "time passes differently online",
    "hours spent, somewhere",
  ],
  sitesExplored: [
    "your curiosity runs wide",
    "many links clicked",
    "a well-traveled browser",
    "you're a world (wide web) traveler",
  ],
  domainVisits: [
    "a place you keep returning to",
    "familiar territory",
    "a habit, maybe",
    "this place knows you",
  ],
} as const;

export type MilestoneCopyKey = keyof typeof MILESTONE_COPY;
