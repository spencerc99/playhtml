// ABOUTME: Typed catalogue for the docs examples index.
// ABOUTME: Keeps example metadata, links, snippets, and preview kinds in one place.

export type ExampleType =
  | "capability"
  | "data"
  | "presence"
  | "event"
  | "react";

export type ExampleStatus = "stable" | "experimental" | "reference";

export type ExampleSource = "docs" | "react" | "docs-and-react";

export type ExamplePreviewKind =
  | "docs-toggle"
  | "docs-lamp"
  | "docs-move"
  | "docs-grow"
  | "docs-spin"
  | "docs-hover"
  | "docs-duplicate"
  | "docs-guestbook"
  | "docs-spinner"
  | "docs-smiley"
  | "docs-presence"
  | "docs-rain"
  | "docs-reactions"
  | "static";

export type ExampleLink = {
  label: string;
  href: string;
  kind: "read" | "source";
};

export type ExampleEntry = {
  slug: string;
  name: string;
  type: ExampleType;
  description: string;
  capabilities: string[];
  tags: string[];
  framework: "HTML" | "React" | "shared";
  status: ExampleStatus;
  source: ExampleSource;
  preview: ExamplePreviewKind;
  html?: string;
  react?: string;
  playRecipeId?: string;
  links: ExampleLink[];
};

const docsCapabilityHref = "/docs/capabilities/";
const reactExamplesHref =
  "https://github.com/spencerc99/playhtml/tree/main/packages/react/examples";

function reactSource(path: string): ExampleLink {
  return {
    label: "source",
    href: `https://github.com/spencerc99/playhtml/blob/main/packages/react/examples/${path}`,
    kind: "source",
  };
}

function docsSource(path: string): ExampleLink {
  return {
    label: "source",
    href: `https://github.com/spencerc99/playhtml/blob/main/apps/docs/src/components/react/${path}`,
    kind: "source",
  };
}

export const exampleEntries: ExampleEntry[] = [
  {
    slug: "lamp-toggle",
    name: "Lamp toggle",
    type: "capability",
    description: "A shared paper lamp that flips on and off for everyone.",
    capabilities: ["can-toggle"],
    tags: ["toggle", "shared state", "lamp"],
    framework: "shared",
    status: "stable",
    source: "docs-and-react",
    preview: "docs-lamp",
    html: `<img can-toggle id="lamp" src="/docs/noguchi-hanging-lamp.png" alt="Paper lamp" />`,
    react: `<SharedLamp id="lamp" standalone src="/docs/noguchi-hanging-lamp.png" />`,
    playRecipeId: "lamp-toggle",
    links: [
      { label: "read can-toggle", href: `${docsCapabilityHref}#can-toggle`, kind: "read" },
      reactSource("SharedLamp.tsx"),
    ],
  },
  {
    slug: "interactive-toggle",
    name: "Interactive toggle",
    type: "capability",
    description: "The smallest can-toggle demo used on the getting started page.",
    capabilities: ["can-toggle"],
    tags: ["toggle", "getting started"],
    framework: "React",
    status: "stable",
    source: "docs",
    preview: "docs-toggle",
    links: [
      { label: "read can-toggle", href: `${docsCapabilityHref}#can-toggle`, kind: "read" },
      docsSource("InteractiveToggleDemo.tsx"),
    ],
  },
  {
    slug: "move-hat-cat",
    name: "Move hat cat",
    type: "capability",
    description: "A bounded can-move demo with draggable image elements.",
    capabilities: ["can-move"],
    tags: ["drag", "bounds"],
    framework: "React",
    status: "stable",
    source: "docs",
    preview: "docs-move",
    links: [
      { label: "read can-move", href: `${docsCapabilityHref}#can-move`, kind: "read" },
      docsSource("capability-demos/MoveHatCatDemo.tsx"),
    ],
  },
  {
    slug: "grow-balloon",
    name: "Grow balloon",
    type: "capability",
    description: "Click to grow, modifier-click to shrink.",
    capabilities: ["can-grow"],
    tags: ["scale", "image"],
    framework: "React",
    status: "stable",
    source: "docs",
    preview: "docs-grow",
    links: [
      { label: "read can-grow", href: `${docsCapabilityHref}#can-grow`, kind: "read" },
      docsSource("capability-demos/GrowBalloonDemo.tsx"),
    ],
  },
  {
    slug: "spin-wheel",
    name: "Spin wheel",
    type: "capability",
    description: "A can-spin wheel that persists rotation.",
    capabilities: ["can-spin"],
    tags: ["rotation", "image"],
    framework: "React",
    status: "stable",
    source: "docs",
    preview: "docs-spin",
    links: [
      { label: "read can-spin", href: `${docsCapabilityHref}#can-spin`, kind: "read" },
      docsSource("capability-demos/SpinWheelDemo.tsx"),
    ],
  },
  {
    slug: "hover-cursor-colors",
    name: "Hover cursor colors",
    type: "presence",
    description: "A can-hover demo that shows transient awareness state.",
    capabilities: ["can-hover", "awareness"],
    tags: ["hover", "presence"],
    framework: "React",
    status: "stable",
    source: "docs",
    preview: "docs-hover",
    links: [
      { label: "read can-hover", href: `${docsCapabilityHref}#can-hover`, kind: "read" },
      docsSource("capability-demos/HoverCursorColorsDemo.tsx"),
    ],
  },
  {
    slug: "duplicate-rabbit",
    name: "Duplicate rabbit",
    type: "capability",
    description: "A can-duplicate demo that adds synced copies.",
    capabilities: ["can-duplicate"],
    tags: ["clone", "spawn"],
    framework: "React",
    status: "stable",
    source: "docs",
    preview: "docs-duplicate",
    links: [
      { label: "read can-duplicate", href: `${docsCapabilityHref}#can-duplicate`, kind: "read" },
      docsSource("capability-demos/DuplicateRabbitDemo.tsx"),
    ],
  },
  {
    slug: "docs-guestbook",
    name: "Docs guestbook",
    type: "data",
    description: "A capped shared list powered by a custom can-play element.",
    capabilities: ["can-play", "element data"],
    tags: ["guestbook", "form", "shared list"],
    framework: "React",
    status: "stable",
    source: "docs",
    preview: "docs-guestbook",
    links: [
      { label: "read can-play", href: `${docsCapabilityHref}#can-play`, kind: "read" },
      docsSource("capability-demos/DocsGuestbook.tsx"),
    ],
  },
  {
    slug: "docs-spinner",
    name: "Docs spinner",
    type: "data",
    description: "A can-play prize wheel with shared spin state.",
    capabilities: ["can-play"],
    tags: ["spinner", "random", "wheel"],
    framework: "React",
    status: "stable",
    source: "docs",
    preview: "docs-spinner",
    links: [
      { label: "read can-play", href: `${docsCapabilityHref}#can-play`, kind: "read" },
      docsSource("capability-demos/DocsSpinner.tsx"),
    ],
  },
  {
    slug: "smiley-row",
    name: "Smiley row",
    type: "data",
    description: "A tiny collaborative drawing strip capped to recent submissions.",
    capabilities: ["can-play"],
    tags: ["drawing", "shared list"],
    framework: "React",
    status: "stable",
    source: "docs",
    preview: "docs-smiley",
    links: [
      { label: "read can-play", href: `${docsCapabilityHref}#can-play`, kind: "read" },
      docsSource("capability-demos/SmileyRow.tsx"),
    ],
  },
  {
    slug: "online-indicator",
    name: "Online indicator",
    type: "presence",
    description: "Colored dots for readers currently connected to the page.",
    capabilities: ["presence", "awareness"],
    tags: ["presence", "online"],
    framework: "React",
    status: "stable",
    source: "docs-and-react",
    preview: "docs-presence",
    links: [
      { label: "read presence", href: "/docs/data/presence/", kind: "read" },
      reactSource("OnlineIndicator.tsx"),
    ],
  },
  {
    slug: "rain-sprinkler",
    name: "Rain sprinkler",
    type: "event",
    description: "A shared rain event dispatched from a fire hydrant.",
    capabilities: ["events"],
    tags: ["event", "broadcast", "rain"],
    framework: "React",
    status: "stable",
    source: "docs-and-react",
    preview: "docs-rain",
    links: [
      { label: "read events", href: "/docs/data/events/", kind: "read" },
      reactSource("RainSprinkler.tsx"),
    ],
  },
  {
    slug: "live-reactions",
    name: "Live reactions",
    type: "event",
    description: "Short-lived emoji bursts sent to everyone on the page.",
    capabilities: ["events"],
    tags: ["emoji", "broadcast", "reaction"],
    framework: "React",
    status: "stable",
    source: "docs-and-react",
    preview: "docs-reactions",
    links: [
      { label: "read events", href: "/docs/data/events/", kind: "read" },
      reactSource("LiveReactions.tsx"),
    ],
  },
  {
    slug: "reaction-view",
    name: "Reaction button",
    type: "data",
    description: "A shared count with local reacted state.",
    capabilities: ["can-play", "local state"],
    tags: ["reaction", "counter"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<ReactionView reaction={{ emoji: "🧡", count: 1 }} />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("Reaction.tsx")],
  },
  {
    slug: "reactive-orb",
    name: "Reactive orb",
    type: "data",
    description: "A synchronized click count rendered as color and scale.",
    capabilities: ["can-play", "element data"],
    tags: ["counter", "visual"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<ReactiveOrb id="orb-1" className="orb-1" colorOffset={0} />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("ReactiveOrb.tsx")],
  },
  {
    slug: "poll",
    name: "Poll",
    type: "data",
    description: "A collaborative single-select poll with optional user-added choices.",
    capabilities: ["can-play", "element data"],
    tags: ["poll", "votes", "form"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<Poll question="Where next?" options={["docs", "playground"]} />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("Poll.tsx")],
  },
  {
    slug: "random-spinner",
    name: "Random spinner",
    type: "data",
    description: "A shared picker that animates toward the same selected option.",
    capabilities: ["can-play", "element data"],
    tags: ["spinner", "random", "animation"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<RandomSpinner options={["red", "green", "blue"]} />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("RandomSpinner.tsx")],
  },
  {
    slug: "shared-slider",
    name: "Shared slider",
    type: "data",
    description: "A range input backed by synchronized element data.",
    capabilities: ["can-play", "element data"],
    tags: ["range", "input"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<SharedSlider label="volume" min={0} max={100} />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("SharedSlider.tsx")],
  },
  {
    slug: "shared-timer",
    name: "Shared timer",
    type: "data",
    description: "A synchronized timer with start, pause, and reset controls.",
    capabilities: ["can-play", "element data"],
    tags: ["timer", "controls"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<SharedTimer durationMs={60_000} />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("SharedTimer.tsx")],
  },
  {
    slug: "toggle-square",
    name: "Toggle square",
    type: "data",
    description: "A minimal shared boolean rendered as a red or green square.",
    capabilities: ["can-play", "element data"],
    tags: ["toggle", "boolean"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<ToggleSquare />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("ToggleSquare.tsx")],
  },
  {
    slug: "view-count",
    name: "View count",
    type: "data",
    description: "A shared counter that increments when the room syncs.",
    capabilities: ["can-play", "element data"],
    tags: ["counter", "views"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<ViewCount />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("ViewCount.tsx")],
  },
  {
    slug: "visitor-count",
    name: "Visitor count",
    type: "presence",
    description: "A presence-backed count of connected visitors.",
    capabilities: ["presence", "awareness"],
    tags: ["presence", "count"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<LiveVisitorCount />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("VisitorCount.tsx")],
  },
  {
    slug: "cursor-online-indicator",
    name: "Cursor online indicator",
    type: "presence",
    description: "A cursor-room indicator built with usePlayContext.",
    capabilities: ["cursors", "presence"],
    tags: ["cursor", "presence"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<CursorOnlineIndicator />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("CursorOnlineIndicator.tsx")],
  },
  {
    slug: "unique-people-pill",
    name: "Unique people pill",
    type: "presence",
    description: "A non-cursor presence room deduped by player identity.",
    capabilities: ["presence", "playerIdentity"],
    tags: ["presence", "dedupe"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<UniquePeoplePill roomName="unique-people-demo" />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("UniquePeoplePill.tsx")],
  },
  {
    slug: "fridge-word",
    name: "Fridge word",
    type: "capability",
    description: "A draggable word tile built on can-move.",
    capabilities: ["can-move"],
    tags: ["drag", "word", "magnet"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<FridgeWord id="hello-word" word="hello" color="#f7dc9c" />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("FridgeWord.tsx")],
  },
  {
    slug: "live-chat",
    name: "Live chat",
    type: "data",
    description: "A shared message list with a minimized chat window.",
    capabilities: ["can-play", "element data"],
    tags: ["chat", "messages"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<LiveChat name="room chat" />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("LiveChat.tsx")],
  },
  {
    slug: "live-chat-controller",
    name: "Live chat controller",
    type: "data",
    description: "A shared controller that creates named chat rooms.",
    capabilities: ["can-play", "element data"],
    tags: ["chat", "controller"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<LiveChatController />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("LiveChat.tsx")],
  },
  {
    slug: "shared-sound",
    name: "Shared sound",
    type: "data",
    description: "A shared play/pause state for an audio element.",
    capabilities: ["can-play", "element data"],
    tags: ["audio", "media"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<SharedSound soundUrl="/lamp-on.m4a" />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("SharedSound.tsx")],
  },
  {
    slug: "confetti-zone",
    name: "Confetti zone",
    type: "event",
    description: "A click target that dispatches a confetti event.",
    capabilities: ["events"],
    tags: ["confetti", "broadcast"],
    framework: "React",
    status: "reference",
    source: "react",
    preview: "static",
    react: `<ConfettiZone />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("Confetti.tsx")],
  },
  {
    slug: "shared-color",
    name: "Shared color",
    type: "data",
    description: "A skeletal shared color example kept as a React reference.",
    capabilities: ["can-play", "element data"],
    tags: ["color", "reference"],
    framework: "React",
    status: "experimental",
    source: "react",
    preview: "static",
    react: `<Color name="background" />`,
    links: [{ label: "react examples", href: reactExamplesHref, kind: "read" }, reactSource("SharedColor.tsx")],
  },
];
