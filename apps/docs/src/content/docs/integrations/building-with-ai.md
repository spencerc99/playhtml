---
title: "Building with AI"
description: "Use the Claude Code plugin or the copy-paste prompt template to get working playhtml code from any LLM."
sidebar:
  order: 1
---

playhtml plays well with AI coding assistants. There are two supported paths, depending on which assistant you use.

## Claude Code plugin (recommended)

If you use [Claude Code](https://docs.anthropic.com/en/docs/claude-code), install the `playhtml` plugin. It ships a skill that activates automatically when you ask Claude to build playhtml elements — no manual context required. The plugin covers the APIs, data types, and the most common mistakes (mutator vs replacement, stable ids, presence vs data, and so on).

```bash
claude plugin marketplace add spencerc99/playhtml
claude plugin install playhtml@playhtml
```

After install, start a new conversation and describe the element you want. The plugin handles the rest.

## Prompt template (any LLM)

For ChatGPT, Copilot, Cursor, or any other assistant, copy the block below into your conversation. Fill in the two `[BLANKS]`, then add your own request at the bottom. It gives the LLM the playhtml context it needs in one shot.

### Describing your element

Before you send the prompt, it helps to nail down three things so the generated code matches what you actually want:

- What users see and how they interact with it.
- What changes when they interact.
- Whether the data should **persist** across reloads, sync **in real-time** only, or just **live** broadcast (like a confetti burst).

Good example descriptions:

- _"A draggable sticky note. Users can drag it anywhere on screen. Position syncs across all users. Yellow 200x200px square with drop shadow."_
- _"A shared chat. Users type in an input box and click Send to add messages. Shows all messages with timestamps. Messages sync in real-time."_

### Copy-paste prompt

````text
Build a playhtml element [in React / in vanilla HTML].

WHAT IT DOES:
[Describe the behavior — what users can do with it, what it shows, how it changes]

---

CONTEXT FOR LLM:

playhtml makes HTML elements collaborative and real-time. Here's what you need to know:

CRITICAL REQUIREMENTS:
- All elements MUST have a unique `id` attribute
- Vanilla HTML: Configure element BEFORE importing playhtml
- React: Must be wrapped in <PlayProvider>

DATA TYPES (choose the right one):
1. Persistent data (defaultData): State that syncs and persists (position, count, messages, etc.)
2. Awareness: Temporary presence data (which users are online, their colors, cursor positions)
3. Events: One-time triggers (confetti, notifications, animations) — use dispatchPlayEvent/registerPlayEventListener

KEY APIs:

Vanilla HTML (can-play):
- element.defaultData = { ... }                                 // Initial state (REQUIRED)
- element.onClick = (e, { data, setData }) => { ... }           // Handle clicks
- element.onDrag = (e, { data, setData }) => { ... }            // Handle drag
- element.onMount = ({ getData, setData, element }) => { ... }  // Setup logic
- element.updateElement = ({ element, data }) => { ... }        // Update DOM when data changes (REQUIRED)
- element.resetShortcut = "shiftKey"                            // Keyboard reset

React (withSharedState):
- withSharedState({ defaultData: {...} }, ({ data, setData, ref }) => JSX)
- For awareness: { myDefaultAwareness: value } in config, use setMyAwareness
- For events: usePlayContext() → { registerPlayEventListener, dispatchPlayEvent }
- For cursors in React: usePlayContext() → { cursors, configureCursors, getMyPlayerIdentity }

DATA UPDATES:
- Simple: setData({ count: data.count + 1 })
- Arrays: setData((draft) => { draft.items.push(item) })
- LIMITATIONS: In mutator form, use splice() not shift()/pop()/[i]=value

PER-USER DATA:
- Use localStorage for data that should NOT sync (like "has this user reacted?")

BUILT-IN CAPABILITIES (if they fit the use case):
- can-move: Draggable with x,y position
- can-toggle: Click to toggle on/off state
- can-spin: Rotatable element
- can-grow: Click to scale up/down
- can-duplicate: Click to clone element
- can-hover: Hover to toggle on/off state
- can-mirror: Syncs all element changes automatically
- Use these instead of can-play when possible

CURSOR CONFIGURATION (optional):
- Vanilla HTML: playhtml.init({ cursors: { enabled: true, room: "page" } })
- React: <PlayProvider initOptions={{ cursors: { enabled: true, room: "page" } }}>
- room options: "page" (same URL only), "domain" (entire site), "section" (same path prefix)
- Access cursor data: window.cursors.allColors, window.cursors.color, window.cursors.name
- Get user count: window.cursors.allColors.length
- Listen for changes: window.cursors.on('allColors', callback)

DATA PERFORMANCE TIPS:
- Keep data shapes simple and flat (avoid deep nesting)
- Don't store computed/derived values — calculate them in render/updateElement
- Use events for ephemeral actions (confetti, notifications), not persistent data
- Use awareness for temporary presence, not defaultData
- Don't update data on high-frequency events (mousemove, scroll) — debounce
- For growing lists (messages, history), consider limiting size or implementing cleanup
- Store only what needs to sync — use component state for UI-only state
- Use localStorage for per-user preferences that shouldn't sync

INSTRUCTIONS:
- If the behavior description is unclear, ASK clarifying questions before implementing
- Choose the right data type (persistent vs awareness vs events)
- Provide complete, working code
- Include all necessary imports and setup

DOCUMENTATION:
- Main README: https://github.com/spencerc99/playhtml#readme
- React: https://github.com/spencerc99/playhtml/tree/main/packages/react
- Examples: https://github.com/spencerc99/playhtml/tree/main/packages/react/examples
````

## When to ask for clarification

The LLM should push back before writing code if:

- It's unclear whether state should persist or be temporary.
- Whether it's per-user data or shared across everyone is ambiguous.
- Key details are missing (what triggers the change, what gets stored).
- The requirements contradict each other.

Don't let the assistant guess. playhtml has different patterns for different use cases, and using the right one matters.

## Setup reference

### Vanilla HTML configuration order

The ordering rule is strict: assign all the custom properties **before** you import playhtml.

```javascript
const element = document.getElementById("myElement");

element.defaultData = { /* ... */ };
element.onClick = (e, { data, setData }) => { /* ... */ };
element.updateElement = ({ data }) => { /* ... */ };

import { playhtml } from "https://unpkg.com/playhtml@latest";
playhtml.init();
```

### React setup

```tsx
import { PlayProvider } from "@playhtml/react";

function App() {
  return (
    <PlayProvider>
      <MyPlayhtmlComponent />
    </PlayProvider>
  );
}
```
