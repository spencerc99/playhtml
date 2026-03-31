// ABOUTME: Copy pools for milestone toast notifications.
// ABOUTME: Edit the arrays here to change what text appears in each milestone type.

export const MILESTONE_COPY = {
  cursorDistance: [
    "your hand has been busy",
    "fingers don't lie",
    "a lot of ground covered",
    "restless today",
    "the hand remembers",
    "you were searching for something",
  ],
  screenTime: [
    "you've been present",
    "a long time to be somewhere",
    "the screen held your attention",
    "time passes differently online",
    "you showed up today",
    "hours spent, somewhere",
    "the day in light",
  ],
  sitesExplored: [
    "your curiosity runs wide",
    "many doors opened",
    "a well-traveled mind",
    "you don't stay in one place",
    "the internet is large, and you've seen some of it",
    "breadth over depth, today",
  ],
  domainVisits: [
    "a place you keep returning to",
    "you come back here",
    "something draws you back",
    "familiar territory",
    "a habit, maybe",
    "this place knows you",
    "you've been here before",
  ],
} as const;

export type MilestoneCopyKey = keyof typeof MILESTONE_COPY;
