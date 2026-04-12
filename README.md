# <a href="https://playhtml.fun">playhtml</a> 🛝🌐 [![npm release](https://img.shields.io/npm/v/playhtml?color=%23ff980c)](https://www.npmjs.com/package/playhtml) [![Downloads](https://img.shields.io/npm/dm/playhtml)](https://www.npmjs.com/package/playhtml) [![Size](https://img.shields.io/bundlephobia/min/playhtml?color=%23c6e1ea)](https://www.npmjs.com/package/playhtml)

_interactive, collaborative html elements with a single data attribute_

playhtml is a fast, small (~300KB), library-agnostic, and expressive library for magically creating collaborative interactive HTML elements that persist their state across sessions.

The simplest example is creating a shared, movable piece of HTML "furniture":

```html
<div id="couch" can-move style="font-size: 80px">🛋</div>
```

At a glance, playhtml supports:

- reactive data scoped at a per-element level
- page-level shared data channels (not tied to elements)
- per-user presence with custom named channels
- sync and data persistence behavior customization (locally persisted, real-time synced, or globally persisted)
- custom events for imperative logic
- a range of magical plug-and-play and full customization
- sharing state across pages and domains
- _(coming soon)_ a web component library for "plug-and-play" collaborative elements
- _(coming soon)_ permissioning for behaviors
- _(coming soon)_ triggering behavior on a schedule (think cron)
- _(coming soon)_ custom data sources for long-term persistence

https://github.com/spencerc99/playhtml/assets/14796580/00e84e15-2c1c-4b4b-8e15-2af22f39db7a

playhtml is still in beta and active development. Join our [Discord community](https://discord.com/invite/SKbsSf4ptU) to get help and show off what you've built!

## Usage

Head to the proper section depending on your technology preference:

- [vanilla html / simple browser usage](#vanilla-html--simple-browser-usage)
- [react / next.js / other frameworks](#react--nextjs--other-frameworks)

### vanilla html / simple browser usage

To use this library, you can import the library from a CDN (in this case we will use [unpkg.com](https://unpkg.com)). Please make sure to do this after all the HTML elements on the page and ensure that the HTML elements you are "magic-ifying" have an `id` set.

```html
<body>
  <!-- ... html elements here -->
  <!-- valid example -->
  <img
    src="https://media2.giphy.com/media/lL7A3Li0YtFHq/giphy.gif?cid=ecf05e47ah89o71gzz7ke7inrgb1ai1xcbrjnqdf7o890118&ep=v1_stickers_search&rid=giphy.gif"
    can-move
    id="openSign"
  />
  <!-- INVALID EXAMPLE <img src="https://media2.giphy.com/media/lL7A3Li0YtFHq/giphy.gif?cid=ecf05e47ah89o71gzz7ke7inrgb1ai1xcbrjnqdf7o890118&ep=v1_stickers_search&rid=giphy.gif" can-move /> -->
  <!-- import the script -->

  <!-- Option 1 (simplest, no customization) -->
  <script
    type="module"
    src="https://unpkg.com/playhtml@latest/dist/init.es.js"
  ></script>

  <!-- Option 2 (customize options to specify the room everyone connects to (a unique ID) or use your own partykit provider) -->
  <script type="module">
    import { playhtml } from "https://unpkg.com/playhtml@latest";
    playhtml.init({
      // room: "my-room", // if you want to specify a custom room to connect to
      // host: `${myPartykitUser}.partykit.dev`, // if you want to specify a custom partykit host host to connect to
      // cursors: {
      //   enabled: true, // if you want to eanble cursors
      // },
    });
  </script>
</body>
```

If you have dynamic elements that are hydrated after the initial load, you can call `playhtml.setupPlayElement(element)` to imbue the element with playhtml properties.

```html
<script type="module">
  import { playhtml } from "https://unpkg.com/playhtml@latest";
  const newPlayElement = document.createElement("div");
  newPlayElement.id = "newPlayElement";
  playhtml.setupPlayElement(newPlayElement);
</script>
```

#### eventing

You can set up imperative logic that doesn't depend on a data value changing (like triggering confetti when someone clicks in an area) by listening for events. You can listen with `playhtml.onEvent` and dispatch with `playhtml.dispatchEvent`.

https://github.com/spencerc99/playhtml/assets/14796580/bd8ecfaf-73ab-4aa2-9312-8917809f52a2

```html
<div
  style="width: 400px; height: 400px; border: 1px red solid"
  id="confettiZone"
>
  <h1>CONFETTI ZONE</h1>
</div>
<!-- Import confetti library -->
<script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js"></script>
<script type="module">
  import "https://unpkg.com/playhtml@latest";
  playhtml.init({});

  // Listen for confetti events from any connected client
  playhtml.onEvent("confetti", () => {
    window.confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
    });
  });

  // Dispatch when someone clicks the zone
  confettiZone.addEventListener("click", () => {
    playhtml.dispatchEvent("confetti");
  });
</script>
```

### react-based frameworks

**react**
`@playhtml/react` provides components out of the box corresponding to each of the capabilities. It manages all the state syncing for you, so you can reactively render your component based on whatever data is coming in.

Refer to the [@playhtml/react README](https://github.com/spencerc99/playhtml/tree/main/packages/react) for the getting started guide.

---

To create your own custom element, refer to the [can-play](#can-play) section.

If you're trying this out and having trouble, please message me ([email](mailto:spencerc99@gmail.com), [twitter](https://twitter.com/spencerc99)) and I'm happy to help out!

## Examples

To get started, you can find examples inside `index.html`, the `website/experiments` folder (these all have corresponding live demos at playhtml.fun/experiments/one/), and React examples under `packages/react/examples`.

## Custom Capabilities

### `can-play`

`can-play` is the fully customizable experience of `playhtml`. You can create anything using simple HTML, CSS, and Javascript by simply adding on the functionality needed to the element itself. The library will handle magically syncing and persisting any data that you store.

Here's the simple example included on the playhtml website:

https://github.com/spencerc99/playhtml/assets/14796580/fae669b1-b3e2-404e-bd7a-3d36b81c572d

```html
<img can-play id="customCandle" src="/candle-gif.gif" />
<!-- IMPORTANT: this data must be set _before_ importing the playhtml library. -->
<script>
  let candle = document.getElementById("customCandle");
  candle.defaultData = { on: true };
  candle.onClick = (_e, { data, setData }) => {
    setData({ on: !data.on });
  };
  candle.updateElement = ({ element, data }) => {
    element.src = data.on ? "/candle-gif.gif" : "/candle-off.png";
  };
  candle.resetShortcut = "shiftKey";

  // If you wanted to trigger this on hover, you could use `onMount`
  // which can initialize several different event listeners and custom logic.
  // customCandle.onMount = ({ getData, setData }) => {
  //   customCandle.addEventListener("mouseover", (_e) => {
  //     const data = getData();
  //     setData({on: !data.on}});
  //   });
  // };
</script>

<!-- Import playhtml -->
<script type="module">
  import "https://unpkg.com/playhtml@latest";
  playhtml.init();
</script>
```

See all supported properties in the `ElementInitializer` [object in `common/src/index.ts`](https://github.com/spencerc99/playhtml/blob/main/packages/common/src/index.ts#L7).

The only required properties are `defaultData`, `updateElement` and some kind of setup to trigger those functions (in this case, `onClick`, but you can add custom event listeners and logic using the `onMount` property). See more examples based on the definitions for the included capabilities in [`elements.ts`](https://github.com/spencerc99/playhtml/blob/packages/playhtml/src/elements.ts).

If you make something fun, please show me! This is designed as an open library for anyone to add on new interactions and capabilities, so we [welcome contributions](https://github.com/spencerc99/playhtml/blob/main/CONTRIBUTING.md) for new built-in capabilities.

#### Data performance tips

- Keep data shapes simple and flat (avoid deep nesting)
- Don't store computed/derived values - calculate them in render/updateElement
- Use events for ephemeral actions (confetti, notifications), not persistent data
- Use awareness for temporary presence (who's online, typing indicators), not defaultData
- Don't update data on high-frequency events (mousemove, scroll) - debounce or use local state
- For growing lists (messages, history), consider limiting size or implementing cleanup
- Store only what needs to sync - use component state or variables for UI-only state
- Use localStorage for per-user preferences that shouldn't sync across users

See [data-structure-design.md](https://github.com/spencerc99/playhtml/blob/main/docs/data-structure-design.md) for detailed guidance on designing efficient data structures.

#### Data cleanup

When deleting elements at runtime, clean up their playhtml data to prevent accumulation:

```javascript
// When removing an element
playhtml.deleteElementData("can-move", elementId);
```

This removes all associated data (SyncedStore, observers, handlers). For bulk cleanup of orphaned data, use the admin cleanup endpoint. See [data-cleanup.md](https://github.com/spencerc99/playhtml/blob/main/docs/data-cleanup.md) for details.

#### Data updates: mutator vs replacement

playhtml supports two ways to update an element's `data` via `setData`, and they have different semantics:

- **Mutator form**: pass a function that receives a draft and mutate it in place. This is merge-friendly (supports adding to a list without conflicts) and is the recommended way to update nested arrays/objects.
- **Replacement form**: pass a full value. This replaces the entire snapshot and is useful for canonical state.

Examples

1. **Mutator (merge-friendly): append to a list**

```tsx
// data: { messages: string[] }
setData((draft) => {
  draft.messages.push("hello");
});
```

Note: when working with the mutator forms, there are some limitations on how you can mutate the array properly.
**✅ Supported Array Operations:**

```tsx
setData((draft) => {
  // ✅ Adding elements
  draft.items.push(newItem);

  // ✅ Removing/inserting at specific positions
  draft.items.splice(0, 1); // Remove first element
  draft.items.splice(2, 0, newItem); // replace element at index 2

  // ✅ Modifying existing objects in the array
  draft.items[0].name = "updated";
});
```

**❌ Unsupported Array Operations:**

```tsx
setData((draft) => {
  // ❌ These will throw "array assignment is not implemented / supported"
  draft.items.shift(); // Use splice(0, 1) instead
  draft.items.pop(); // Use splice(-1, 1) instead
  draft.items[index] = newItem; // Use splice(index, 1, newItem) instead
});
```

2. **Replacement (overwrite snapshot): toggle boolean**

```tsx
// data: { on: boolean; ... }
setData({ ...data, on: !data.on });
```

### Advanced

IDs are recommended on all elements to uniquely identify them. If you are applying the same capability to several elements, you can also use the `selector-id` attribute to specify a selector to the elements that distinguishes them. The ID will be the index of the element in that selector query.

## Plug-and-play Capabilities

These capabilities are common ones that have been designed and created by the community. You should expect that they are relatively well-tested, and they simply build on top of the same API and constructs that `can-play` uses.

### `can-mirror`

**EXPERIMENTAL: USE WITH CAUTION**

Automatically syncs attributes, children, form element state (checkboxes, radios, selects, text inputs), and contenteditable content of an element. This is a powerful way to code as you normally do but have it be automatically collaborative. Hover and focus states are synced ephemerally via awareness--style with `[data-playhtml-hover]` and `[data-playhtml-focus]` attribute selectors instead of `:hover`/`:focus`. Still in testing and may have some bugs. NOTE that anyone can change synced values using their dev console and have it sync across. Restricting values to certain ranges or values will soon be supported.

### `can-hover`

Syncs hover state across all connected clients via awareness. When any client hovers the element, all clients see the `data-playhtml-hover` attribute set on it. No persistent data is stored--hover state is purely ephemeral. Style with `[data-playhtml-hover]` instead of `:hover` to reflect collaborative hover state.

### `can-move`

https://github.com/spencerc99/playhtml/assets/14796580/215c7631-d71f-40e6-bdda-bd8146a88006

Creates a movable element using 2D `translate` on the element. Dragging the element around will move it

**troubleshooting**

- This currently doesn't work on `inline` display elements.

### `can-toggle`

https://github.com/spencerc99/playhtml/assets/14796580/7e667c06-c32e-4369-b250-c9ca321de163

_from https://twitter.com/spencerc99/status/1681048824884895744_

Creates an element that can be switched on and off. Clicking the element will toggle the `clicked` class on the element.

### `can-duplicate`

https://github.com/spencerc99/playhtml/assets/14796580/6d9f1228-08cf-45a7-987a-8bebfaaefd83

_used to programmatically and dynamically create new playhtml elements that aren't included in the initial HTML_

Creates an element that duplicates a target element (specified by the value of the `can-duplicate` attribute, which can be an element's ID or custom CSS selector) when clicked. Optionally can specify where the duplicate element is inserted in the DOM via the `can-duplicate-to` setting (default is as a sibling to the original element).

### `can-grow`

Creates an element that can be resized using a `scale` `transform`. Clicking the element will grow it, clicking with <kbd>ALT</kbd> will shrink it. Currently, the max size is 2x the original size and the min size is 1/2 the original size.

### `can-spin`

Creates a rotatable element using a `rotate` `transform` on the element. Dragging the element to the left or right will rotate it counter-clockwise and clockwise respectively.

## Shared Elements

Shared elements allow you to share an element's state across pages and domains. This means a lamp on one site can trigger different lights on other sites. This enables creating interconnected tiny internets that dynamically interact with and react to each other.

https://github.com/user-attachments/assets/5f20b7b4-0d53-43e6-add1-754afba52e12

See the guide on referencing shared elements for more details [shared-elements.md](https://github.com/spencerc99/playhtml/blob/main/docs/shared-elements.md).

## Page-Level Shared Data

`playhtml.createPageData()` creates named persistent data channels that are not tied to any DOM element. This is useful for page-level counters, shared voting systems, link tracking, or any collaborative state that belongs to the page rather than a specific element.

```javascript
// Create a named data channel with a default value
const counter = playhtml.createPageData("my-counter", { count: 0 });

// Read current data
counter.getData(); // { count: 0 }

// Update with mutator (merge-friendly, recommended for nested data)
counter.setData((draft) => {
  draft.count += 1;
});

// Update with replacement
counter.setData({ count: 0 });

// Subscribe to changes (fires on local and remote updates)
const unsub = counter.onUpdate((data) => {
  document.getElementById("count").textContent = data.count;
});

// Clean up when done
unsub(); // remove listener
counter.destroy(); // remove all listeners for this handle
```

Multiple calls to `createPageData` with the same name return independent handles that share the same underlying data. Each handle has its own listeners, and `destroy()` only affects that handle's listeners.

## Presence

`playhtml.presence` provides a unified view of all connected users with support for custom named channels. Each user has system fields (identity, cursor position) plus any custom channels you define.

```javascript
// Set custom presence channels (replace semantics per channel)
playhtml.presence.setMyPresence("status", { text: "online", emoji: "o]" });
playhtml.presence.setMyPresence("focus", { elementId: "section-3" });

// Clear a channel
playhtml.presence.setMyPresence("status", null);

// Read all users' presence (includes self)
const presences = playhtml.presence.getPresences();
for (const [id, p] of presences) {
  p.isMe; // boolean — true for the local user
  p.playerIdentity; // PlayerIdentity — name, colors, publicKey
  p.cursor; // Cursor | null — position (null if cursors disabled)
  p.status; // your custom channel data (if set)
  p.focus; // your custom channel data (if set)
}

// Subscribe to changes on a specific channel
const unsub = playhtml.presence.onPresenceChange("status", (presences) => {
  // Only fires when any user's "status" channel changes
  renderUserStatuses(presences);
});

// Subscribe to cursor position updates (~60fps)
const unsubCursors = playhtml.presence.onPresenceChange(
  "cursor",
  (presences) => {
    renderCursorPositions(presences);
  },
);

// Get own identity
const me = playhtml.presence.getMyIdentity();
```

Custom channels are flattened into the top level of `PresenceView`. Channel names that collide with system fields (`playerIdentity`, `cursor`, `isMe`) are silently dropped.

> **Note:** Cursor position data in `getPresences()` uses raw storage coordinates. For pixel-accurate cursor rendering with coordinate conversion, use the cursor system directly.

## Cursors

Playhtml includes built-in cursor tracking and presence awareness. When enabled, users can see each other's cursors in real-time, with customizable scoping, filtering, and styling.

```javascript
playhtml.init({
  cursors: {
    enabled: true,
    room: "domain", // Show cursors across entire site
    shouldRenderCursor: (presence) => {
      // Only render cursors from same page
      return presence.page === window.location.pathname;
    },
  },
});

// Access global presence data
const userCount = window.cursors.allColors.length;
```

Cursors can be scoped to a page, domain, section, or custom room. You can filter which cursors render and style them dynamically (e.g., fade cross-page cursors). Perfect for showing domain-wide user counts while keeping cursor movements page-specific.

See the full cursor documentation for configuration options and patterns [cursors.md](https://github.com/spencerc99/playhtml/blob/main/docs/cursors.md).

## Building with AI / LLMs

playhtml works well with AI coding assistants. We provide two resources:

### Claude Code Plugin (recommended for Claude Code users)

If you use [Claude Code](https://docs.anthropic.com/en/docs/claude-code), install the playhtml plugin to get a skill that automatically activates when you ask Claude to build playhtml elements. It covers the APIs, data types, and common mistakes.

```bash
# Add the playhtml marketplace
claude plugin marketplace add spencerc99/playhtml

# Install the plugin
claude plugin install playhtml@playhtml
```

### Prompting Guide (for any LLM)

For other AI tools (ChatGPT, Copilot, Cursor, etc.), copy the prompt template from [`docs/llm-prompting-guide.md`](https://github.com/spencerc99/playhtml/blob/main/docs/llm-prompting-guide.md) into your conversation. It gives the LLM the context it needs to generate working playhtml code.

## Help & Community

Join our [Discord community](https://discord.gg/SKbsSf4ptU) to get help and show off what you've built!

## Data Policy

Currently all data is stored by a [Partykit](https://partykit.dev) instance under my account and is not encrypted. This means that anyone with the room name can access the data. In the future, I'd like to enable providing your own custom persistence options via object storage providers (or any generic service that can accept a POST endpoint with a dump of the data).

## Contributing

See [CONTRIBUTING.md](https://github.com/spencerc99/playhtml/blob/main/CONTRIBUTING.md).

## Support & Maintenance

Thank you for considering reading this little README and browing this project! I'd love to see you share the library and what you've made with it to me and with your friends. And if you enjoy using this, please consider [sponsoring the project or sending a small donation](https://github.com/sponsors/spencerc99). This helps ensure that the library is maintained and improved over time and funds the hosting costs for the syncing and persistence services.

```

```
