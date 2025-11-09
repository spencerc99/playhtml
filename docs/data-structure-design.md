# Data Structure Design

Guide for designing efficient, performant data structures in playhtml elements.

## Core Principles

### 1. Keep data shapes simple and flat

**Why:** Deeply nested data is harder to update, slower to sync, and more prone to conflicts.

**Good:**

```javascript
defaultData: {
  x: 0,
  y: 0,
  color: "#ff0000",
  size: 100
}
```

**Avoid:**

```javascript
defaultData: {
  position: {
    coords: {
      x: 0,
      y: 0
    }
  },
  style: {
    appearance: {
      color: "#ff0000",
      dimensions: { size: 100 }
    }
  }
}
```

**When nesting is needed:** One level of nesting is fine for related data:

```javascript
defaultData: {
  position: { x: 0, y: 0 },  // OK - clearly related
  color: "#ff0000"
}
```

---

### 2. Don't store computed or derived values

**Why:** Computed values can become stale, waste sync bandwidth, and create inconsistencies.

**Good:**

```javascript
// Store only source data
defaultData: {
  count: 5;
}

// Calculate in render
updateElement: ({ element, data }) => {
  const isEven = data.count % 2 === 0;
  element.textContent = `${data.count} (${isEven ? "even" : "odd"})`;
};
```

**Avoid:**

```javascript
// Don't store derived values
defaultData: {
  count: 5,
  isEven: false  // ❌ Computed from count
}
```

**Examples of derived values to avoid storing:**

- Formatted strings (dates, currencies)
- Boolean flags computed from other data
- Totals, averages, counts (calculate from array)
- Filtered/sorted arrays (derive from source array)

---

### 3. Choose the right data type

playhtml has three types of data. Use the right one for your use case:

#### Persistent Data (`defaultData`)

**Use for:** State that should sync and persist across sessions

**Examples:**

- Element positions, rotations, scales
- User-generated content (messages, todos)
- Settings, selections, toggles
- Counters, scores

```javascript
defaultData: {
  messages: [{ id: "1", text: "Hello", timestamp: 1234567890 }];
}
```

#### Awareness

**Use for:** Temporary presence data that disappears when users leave

**Examples:**

- Who's currently online
- User colors, names
- Typing indicators
- Cursor positions (though cursors have built-in support)

```javascript
// React
{
  myDefaultAwareness: "#3b82f6";
}

// Use setMyAwareness to update
```

#### Events

**Use for:** One-time triggers with no persistent state

**Examples:**

- Confetti animations
- Notification sounds
- Screen shake effects
- Celebration animations

```javascript
// Dispatch
playhtml.dispatchPlayEvent({ type: "confetti" });

// Listen
playhtml.registerPlayEventListener("confetti", {
  onEvent: () => {
    /* trigger animation */
  },
});
```

---

### 4. Don't update data on high-frequency events

**Why:** Syncing on every mousemove or scroll event will overwhelm the network and database.

**Avoid:**

```javascript
// ❌ Don't do this
element.addEventListener("mousemove", (e) => {
  setData({ x: e.clientX, y: e.clientY });
});
```

**Solutions:**

**Option A: Use built-in drag handlers** (automatically debounced)

```javascript
element.onDrag = (e, { data, setData }) => {
  setData({ x: e.clientX, y: e.clientY });
};
```

**Option B: Debounce updates**

```javascript
let debounceTimeout;
element.addEventListener("mousemove", (e) => {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(() => {
    setData({ x: e.clientX, y: e.clientY });
  }, 100); // Only update after 100ms of no movement
});
```

**Option C: Use local state for UI feedback, sync on end**

```javascript
let localX = data.x;

element.addEventListener("mousemove", (e) => {
  localX = e.clientX;
  element.style.left = `${localX}px`; // Local update
});

element.addEventListener("mouseup", () => {
  setData({ x: localX }); // Sync when done
});
```

---

### 5. Manage growing lists

**Why:** Unbounded arrays in persistent storage will grow forever and slow down sync/load times.

**Strategies:**

**Option A: Limit array size**

```javascript
setData((draft) => {
  draft.messages.push(newMessage);

  // Keep only last 100 messages
  if (draft.messages.length > 100) {
    draft.messages.splice(0, draft.messages.length - 100);
  }
});
```

**Option B: Use timestamps for cleanup**

```javascript
setData((draft) => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // 24 hours ago

  draft.messages = draft.messages.filter((m) => m.timestamp > cutoff);
  draft.messages.push(newMessage);
});
```

**Option C: Implement pagination** (for viewing old data)

```javascript
// Store only recent items in element data
// Fetch history from a separate data source (API, database) when needed
```

**Option D: Admin cleanup** (for moderators)
See [admin-cleanup-instructions.md](./admin-cleanup-instructions.md) for manual cleanup tools.

---

### 6. Store only what needs to sync

**Why:** Not all state needs to be shared. Component-local state is faster and doesn't use bandwidth.

**Examples of what NOT to sync:**

**UI-only state:**

```javascript
// ❌ Don't sync
defaultData: {
  isHovering: false;
}

// ✅ Use local state instead
let isHovering = false;
element.addEventListener("mouseenter", () => {
  isHovering = true;
  element.classList.add("hover");
});
```

**Loading/error states:**

```javascript
// ❌ Don't sync
defaultData: { isLoading: false, error: null }

// ✅ Use component state (React) or variables (vanilla)
const [isLoading, setIsLoading] = useState(false);
```

**Animation states:**

```javascript
// ❌ Don't sync
defaultData: {
  isAnimating: false;
}

// ✅ Use CSS classes or local variables
element.classList.add("animating");
setTimeout(() => element.classList.remove("animating"), 1000);
```

---

### 7. Use localStorage for per-user preferences

**Why:** Some data is personal and shouldn't sync across users.

**Examples:**

- "Has this user reacted?" (prevents double-voting)
- User's view preferences (collapsed sections, etc.)
- User's display name or avatar choice
- Notification settings

```javascript
// Check if current user has reacted
const hasReacted = Boolean(localStorage.getItem(`reacted-${elementId}`));

onClick: (e, { data, setData }) => {
  if (hasReacted) {
    setData({ count: data.count - 1 });
    localStorage.removeItem(`reacted-${elementId}`);
  } else {
    setData({ count: data.count + 1 });
    localStorage.setItem(`reacted-${elementId}`, "true");
  }
};
```

## Anti-Patterns

### ❌ Storing UI State

```javascript
// Don't sync hover states, focus states, loading states
defaultData: {
  isHovering: false,
  isFocused: false,
  isLoading: true
}
```

### ❌ Over-normalizing Data

```javascript
// Too normalized for playhtml's use case
defaultData: {
  users: { "user1": { name: "Alice" } },
  messages: { "msg1": { userId: "user1", text: "Hi" } }
}

// ✅ Simpler, flatter structure
defaultData: {
  messages: [
    { id: "msg1", author: "Alice", text: "Hi" }
  ]
}
```

### ❌ Unbounded Arrays Without Cleanup

```javascript
// Will grow forever
setData((draft) => {
  draft.history.push(action); // ❌ No limit
});

// ✅ Add cleanup
setData((draft) => {
  draft.history.push(action);
  if (draft.history.length > 50) {
    draft.history.splice(0, draft.history.length - 50);
  }
});
```

---

## Performance Checklist

When designing your data structure, ask:

- ✅ Is this data actually shared/synced? Or should it be local?
- ✅ Is this computed from other data? Calculate it instead of storing it
- ✅ Will this array grow unbounded? Implement limits/cleanup
- ✅ Am I updating too frequently? Debounce or use local state
- ✅ Is this data shape as simple as possible?
- ✅ Could I use a built-in capability instead?
- ✅ Should this be awareness or events instead of persistent data?
- ✅ Are there per-user preferences that should use localStorage?

---

## Related Documentation

- [Data Cleanup](./data-cleanup.md) - Programmatic cleanup tools
- [Shared Elements](./shared-elements.md) - Cross-page/cross-domain data sharing
- [Main README](https://github.com/spencerc99/playhtml#readme) - Getting started guide
