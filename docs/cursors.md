# Cursors

Playhtml includes built-in cursor tracking and presence awareness. When enabled, users can see each other's cursors in real-time, along with their colors and names.

## Basic Setup

### JavaScript

```javascript
import { playhtml } from "playhtml";

playhtml.init({
  cursors: {
    enabled: true,
  }
});
```

### React

```tsx
import { PlayProvider } from "@playhtml/react";

<PlayProvider
  initOptions={{
    cursors: {
      enabled: true,
    }
  }}
>
  {/* your app */}
</PlayProvider>
```

## Configuration Options

### `room`

Controls which users see each other's cursors. By default, cursors are scoped to the current page.

**Type:** `"page" | "domain" | "section" | (context) => string`

```javascript
// Page-specific (default)
cursors: {
  enabled: true,
  room: "page"  // Only users on /blog/post see each other
}

// Domain-wide
cursors: {
  enabled: true,
  room: "domain"  // All users across yoursite.com see each other
}

// Section-wide
cursors: {
  enabled: true,
  room: "section"  // All users in /blog/* see each other
}

// Custom function
cursors: {
  enabled: true,
  room: ({ domain, pathname, search }) => {
    // Custom logic
    if (pathname.startsWith('/workspace/')) {
      return `${domain}-workspace`;
    }
    return `${domain}${pathname}`;
  }
}
```

### `shouldRenderCursor`

Filter which cursors are visible. Useful for showing domain-wide presence while only rendering same-page cursors.

**Type:** `(presence: CursorPresence) => boolean`

```javascript
cursors: {
  enabled: true,
  room: "domain",  // Connect everyone
  shouldRenderCursor: (presence) => {
    // Only render cursors from the same page
    return presence.page === window.location.pathname;
  }
}
```

**Presence data includes:**
- `presence.page` - The page path the cursor is on
- `presence.cursor` - Current cursor position `{ x, y, pointer }`
- `presence.playerIdentity` - User info `{ name, playerStyle: { colorPalette } }`
- `presence.message` - Chat message (if chat enabled)
- `presence.lastSeen` - Timestamp

### `getCursorStyle`

Customize cursor appearance based on presence data.

**Type:** `(presence: CursorPresence) => Partial<CSSStyleDeclaration> | Record<string, string>`

```javascript
cursors: {
  enabled: true,
  room: "domain",
  getCursorStyle: (presence) => {
    // Fade cursors from other pages
    if (presence.page !== window.location.pathname) {
      return {
        opacity: '0.4',
        filter: 'blur(3px)'
      };
    }
    return {};
  }
}
```

**Example: Distance-based styling**

```javascript
getCursorStyle: (presence) => {
  const distance = Math.sqrt(
    Math.pow(presence.cursor.x - myX, 2) +
    Math.pow(presence.cursor.y - myY, 2)
  );

  if (distance > 500) {
    return { opacity: '0.3' };
  }
  return {};
}
```

### Other Options

```javascript
cursors: {
  enabled: true,

  // Custom player identity
  playerIdentity: {
    name: "Alice",
    playerStyle: {
      colorPalette: ["#3b82f6", "#8b5cf6", "#ec4899"]
    }
  },

  // Proximity detection
  proximityThreshold: 150,  // pixels
  onProximityEntered: (playerIdentity, positions, angle) => {
    console.log("User nearby!", playerIdentity.name);
  },
  onProximityLeft: (connectionId) => {
    console.log("User left proximity");
  },

  // Visibility threshold (hide distant cursors)
  visibilityThreshold: 1000,  // pixels

  // Enable chat
  enableChat: true,

  // Custom cursor rendering
  onCustomCursorRender: (connectionId, element) => {
    // Return custom element or null for default
    return null;
  }
}
```

## Global Cursor API

Cursors expose a global `window.cursors` object for accessing user presence data.

### Properties

```javascript
// Get all user colors (across the room)
const colors = window.cursors.allColors;  // ["#3b82f6", "#8b5cf6", ...]

// Get/set your cursor color
window.cursors.color;  // "#3b82f6"
window.cursors.color = "#ff0000";

// Get/set your name
window.cursors.name;  // "Alice"
window.cursors.name = "Bob";
```

### Events

Listen for changes to cursor state:

```javascript
// Listen for color changes
window.cursors.on('allColors', (colors) => {
  console.log(`${colors.length} users online`);
});

window.cursors.on('color', (myColor) => {
  console.log(`My color changed to ${myColor}`);
});

window.cursors.on('name', (myName) => {
  console.log(`My name changed to ${myName}`);
});

// Stop listening
window.cursors.off('allColors', callback);
```

### Example: User Count Display

```html
<div id="user-count">👥 <span>0</span> online</div>

<script>
  const updateCount = () => {
    const count = window.cursors?.allColors?.length || 0;
    document.querySelector('#user-count span').textContent = count;
  };

  window.cursors?.on('allColors', updateCount);
  updateCount();
</script>
```

## React Integration

### Using in Components

```tsx
import { usePlayContext } from "@playhtml/react";

function UserCount() {
  const { cursors } = usePlayContext();

  return (
    <div>👥 {cursors.allColors.length} users online</div>
  );
}
```

The `cursors` object from `usePlayContext()` provides:
- `cursors.allColors` - Array of all user colors
- `cursors.color` - Your current color
- `cursors.name` - Your current name

These values automatically update when users join/leave or change their settings.

### Configuring Cursors Dynamically

```tsx
import { usePlayContext } from "@playhtml/react";

function CursorSettings() {
  const { configureCursors, getMyPlayerIdentity } = usePlayContext();

  const changeColor = (color: string) => {
    // This updates window.cursors.color
    window.cursors.color = color;
  };

  const changeName = (name: string) => {
    // This updates window.cursors.name
    window.cursors.name = name;
  };

  return (
    <div>
      <input
        type="color"
        value={getMyPlayerIdentity().color}
        onChange={(e) => changeColor(e.target.value)}
      />
      <input
        type="text"
        value={getMyPlayerIdentity().name || ""}
        onChange={(e) => changeName(e.target.value)}
        placeholder="Your name"
      />
    </div>
  );
}
```

## Common Patterns

### Domain-Wide Count, Page-Specific Cursors

Show total users across your entire site while only displaying cursors from the current page:

```javascript
playhtml.init({
  cursors: {
    enabled: true,
    room: "domain",  // All pages share presence
    shouldRenderCursor: (presence) => {
      // Only render same-page cursors
      return presence.page === window.location.pathname;
    }
  }
});

// Access global count
const totalUsers = window.cursors.allColors.length;
```

**React:**

```tsx
<PlayProvider
  initOptions={{
    cursors: {
      enabled: true,
      room: "domain",
      shouldRenderCursor: (presence) =>
        presence.page === window.location.pathname
    }
  }}
>
  <UserCount />  {/* Shows domain-wide count */}
  {/* Cursors only appear from same page */}
</PlayProvider>

function UserCount() {
  const { cursors } = usePlayContext();
  return <div>👥 {cursors.allColors.length} online</div>;
}
```

### Ghost Cursors from Other Pages

Show cursors from all pages but make cross-page cursors appear as "ghosts":

```javascript
playhtml.init({
  cursors: {
    enabled: true,
    room: "domain",
    getCursorStyle: (presence) => {
      if (presence.page !== window.location.pathname) {
        return {
          opacity: '0.4',
          filter: 'blur(3px)'
        };
      }
      return {};
    }
  }
});
```

**React:**

```tsx
<PlayProvider
  initOptions={{
    cursors: {
      enabled: true,
      room: "domain",
      getCursorStyle: (presence) =>
        presence.page !== window.location.pathname
          ? { opacity: '0.4', filter: 'blur(3px)' }
          : {}
    }
  }}
/>
```

### Section-Specific Awareness

Show cursors only to users in the same section of your site (e.g., all `/blog/*` pages):

```javascript
playhtml.init({
  cursors: {
    enabled: true,
    room: "section"  // Groups by first path segment
  }
});
```

### Workspace Rooms

Create custom groupings based on your app's logic:

```javascript
playhtml.init({
  cursors: {
    enabled: true,
    room: ({ domain, pathname }) => {
      // Extract workspace ID from URL
      const match = pathname.match(/\/workspace\/(\w+)/);
      if (match) {
        return `${domain}-workspace-${match[1]}`;
      }
      return `${domain}${pathname}`;
    }
  }
});
```

## Troubleshooting

### Cursors not appearing
- Check that `enabled: true` is set
- Verify the room configuration - users must be in the same room to see each other
- Check browser console for connection errors

### User count is wrong
- Make sure you're reading `window.cursors.allColors.length` after initialization
- Listen for the `allColors` event to get updates
- Check that the `room` setting matches your intent (page vs domain)

### Cursors from wrong pages appearing
- Use `shouldRenderCursor` to filter by `presence.page`
- Verify that `presence.page` matches your expectations

### Styling not applying
- `getCursorStyle` returns must be valid CSS property values
- Styles are applied via `Object.assign(element.style, ...)`
- Check browser console for CSS errors

### React hooks not updating
- Ensure `PlayProvider` is rendered before components using `usePlayContext()`
- The `cursors` object updates automatically - no manual subscription needed
- Use `getMyPlayerIdentity()` for immediate reads, not reactive values
