# Prompting LLMs to make playhtml elements

To describe your element, include

- What users see & how they interact
- What changes when they interact
- What data is synced and whether it is real-time, persistent (saves after refresh) or live (real-time but disappears after refresh)

**Examples:**

- "A draggable sticky note. Users can drag it anywhere on screen. Position syncs across all users. Yellow 200x200px square with drop shadow."
- "A shared chat. Users type in an input box and click Send to add messages. Shows all messages with timestamps. Messages sync in real-time."

## Copy-Paste Prompt Template

Copy this entire block, fill in the two `[BLANKS]`, and send to your LLM:

Build a playhtml element [in React / in vanilla HTML].

WHAT IT DOES:
[Describe the behavior - what users can do with it, what it shows, how it changes]

---

CONTEXT FOR LLM:

playhtml makes HTML elements collaborative and real-time. Here's what you need to know:

CRITICAL REQUIREMENTS:

- All elements MUST have a unique `id` attribute
- Vanilla HTML: Configure element BEFORE importing playhtml
- React: Must be wrapped in <PlayProvider>

DATA TYPES (choose the right one):

1. **Persistent data** (defaultData): State that syncs and persists (position, count, messages, etc.)
2. **Awareness**: Temporary presence data (which users are online, their colors, cursor positions)
3. **Events**: One-time triggers (confetti, notifications, animations) - use dispatchPlayEvent/registerPlayEventListener

KEY APIs:

Vanilla HTML (can-play):

- element.defaultData = { ... } // Initial state (REQUIRED)
- element.onClick = (e, { data, setData }) => { ... } // Handle clicks
- element.onDrag = (e, { data, setData }) => { ... } // Handle drag
- element.onMount = ({ getData, setData, element }) => { ... } // Setup logic
- element.updateElement = ({ element, data }) => { ... } // Update DOM when data changes (REQUIRED)
- element.resetShortcut = "shiftKey" // Keyboard reset

React (withSharedState):

- withSharedState({ defaultData: {...} }, ({ data, setData, ref }) => JSX)
- For awareness: { myDefaultAwareness: value } in config, use setMyAwareness
- For events: useContext(PlayContext) → { registerPlayEventListener, dispatchPlayEvent }

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
- can-hover: Shows who's hovering
- Use these instead of can-play when possible

CURSOR CONFIGURATION (optional):

Enable collaborative cursors to show where other users are:

- Vanilla HTML: playhtml.init({ cursors: { enabled: true, room: "page" } })
- React: <PlayProvider initOptions={{ cursors: { enabled: true, room: "page" } }}>
- room options: "page" (same URL only), "domain" (entire site), "section" (same path prefix)
- Access cursor data: window.cursors.allColors, window.cursors.count
- See docs/cursors.md for proximity detection, filtering, styling

DATA PERFORMANCE TIPS:

- Keep data shapes simple and flat (avoid deep nesting)
- Don't store computed/derived values - calculate them in render/updateElement
- Use events for ephemeral actions (confetti, notifications), not persistent data
- Use awareness for temporary presence (who's online, typing indicators), not defaultData
- Don't update data on high-frequency events (mousemove, scroll) - debounce or use local state
- For growing lists (messages, history), consider limiting size or implementing cleanup
- Store only what needs to sync - use component state or variables for UI-only state
- Use localStorage for per-user preferences that shouldn't sync across users

INSTRUCTIONS:

- If the behavior description is unclear, ASK clarifying questions before implementing
- Choose the right data type (persistent vs awareness vs events)
- Provide complete, working code
- Include all necessary imports and setup

DOCUMENTATION:

- Main README: https://github.com/spencerc99/playhtml#readme
- React: https://github.com/spencerc99/playhtml/tree/main/packages/react
- Examples: https://github.com/spencerc99/playhtml/tree/main/packages/react/examples

### Vanilla HTML Configuration Order

```javascript
// 1. Get element
const element = document.getElementById("myElement");

// 2. Configure (BEFORE import)
element.defaultData = { ... };
element.onClick = ...;
element.updateElement = ...;

// 3. THEN import playhtml
import { playhtml } from "https://unpkg.com/playhtml@latest";
playhtml.init();
```

### React Setup

```tsx
// App.tsx
import { PlayProvider } from "@playhtml/react";

function App() {
  return (
    <PlayProvider>
      <MyPlayhtmlComponent />
    </PlayProvider>
  );
}
```

### When to Ask for Clarification

Ask the user to clarify if:

- Unclear whether state should persist or be temporary
- Ambiguous whether it's per-user or shared data
- Missing key details (what triggers changes, what gets stored)
- Conflicting requirements

Don't guess - playhtml has specific patterns for different use cases, so using the right one matters.
