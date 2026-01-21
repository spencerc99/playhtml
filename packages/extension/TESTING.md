# Testing Guide for Extension Collectors

This guide covers both automated and manual testing for the extension collectors.

## Automated Tests

### Running Tests

```bash
cd packages/extension

# Run all tests
bun test

# Run specific test file
bun test CursorCollector

# Run with coverage
bun test --coverage

# Run in watch mode
bun test --watch
```

### Test Structure

- **Unit Tests**: Individual collector tests in `src/__tests__/`
  - `CursorCollector.test.ts` - Tests for cursor movement, clicks, holds, drags, cursor styles
  - `NavigationCollector.test.ts` - Tests for focus, blur, popstate, beforeunload
  - `ViewportCollector.test.ts` - Tests for scroll, resize, zoom
  - `collectors.integration.test.ts` - Integration tests for CollectorManager

- **Test Utilities**: Helper functions in `src/__tests__/test-utils.ts`
  - `simulateMouseMove()`, `simulateClick()`, `simulateDrag()`
  - `simulateScroll()`, `simulateResize()`
  - `advanceTime()`, `createTestElement()`

### Test Coverage

The tests verify:
- Event emission (correct data structure, timing)
- Throttling/debouncing (scroll 100ms, resize 200ms, movement 250ms)
- Click vs hold detection (250ms threshold)
- Position normalization (0-1 range)
- Element selector generation
- Enable/disable lifecycle
- Multiple collectors working simultaneously

## Manual Testing

### Setup

1. **Build the extension:**
   ```bash
   cd packages/extension
   bun run dev
   ```

2. **Load in Chrome:**
   - Open `chrome://extensions`
   - Enable "Developer mode" (top right)
   - Click "Load unpacked"
   - Navigate to `.output/chrome-mv3` folder
   - Extension should appear in your extensions list

3. **Open extension popup:**
   - Click the extension icon in the toolbar
   - Navigate to "Collections" tab

### Testing CursorCollector

1. **Enable cursor collector** via popup toggle
2. **Move mouse** around the page
   - Check browser console for movement events
   - Events should be throttled (~250ms intervals)
3. **Click elements** (quick clicks)
   - Should emit `click` events with button type
   - Check position normalization (0-1 range)
4. **Hold mouse down** for >250ms then release
   - Should emit `hold` event with duration
5. **Drag elements** (if page has draggable elements)
   - Should emit `drag_start` and `drag_end` events
6. **Hover over different elements** (links, buttons, inputs)
   - Should detect cursor style changes (`pointer`, `text`, etc.)
   - Should emit `cursor_change` events

**Verify in DevTools:**
- Console: Look for `[CursorCollector]` logs
- Application → IndexedDB → `collection_events_db` → `events` store
- Should see events with type `cursor` and data containing `x`, `y`, `event`, `cursor`, etc.

### Testing NavigationCollector

1. **Enable navigation collector** via popup toggle
2. **Switch tabs** (Alt+Tab or Cmd+Tab)
   - Should emit `blur` when leaving tab
   - Should emit `focus` when returning
3. **Use browser back/forward** buttons
   - Should emit `popstate` events with URL and state
4. **Navigate to a new page** (or close tab)
   - Should emit `beforeunload` event with `from_url`

**Verify in DevTools:**
- IndexedDB should contain events with type `navigation`
- Check `event` field: `focus`, `blur`, `popstate`, `beforeunload`

### Testing ViewportCollector

1. **Enable viewport collector** via popup toggle
2. **Scroll the page**
   - Should emit `scroll` events (throttled to ~100ms)
   - Check `scrollX` and `scrollY` are normalized (0-1)
3. **Resize browser window**
   - Should emit `resize` events (debounced to ~200ms)
   - Check `width` and `height` match new viewport size
4. **Zoom in/out** (Ctrl/Cmd + Plus/Minus)
   - Should emit `zoom` events when zoom level changes
   - Check `zoom` field (e.g., 1.0, 1.25, 1.5)

**Verify in DevTools:**
- IndexedDB should contain events with type `viewport`
- Check `event` field: `scroll`, `resize`, `zoom`

### Testing Multiple Collectors

1. **Enable all collectors** simultaneously
2. **Perform mixed actions:**
   - Move mouse while scrolling
   - Click while resizing window
   - Switch tabs while scrolling
3. **Verify:**
   - All collectors emit events independently
   - No interference between collectors
   - Events are properly typed and routed to buffer

### Verifying Data Collection

1. **Open DevTools** (F12)
2. **Go to Application tab** → **IndexedDB**
3. **Select `collection_events_db`** → **events** store
4. **View stored events:**
   - Each event should have: `id`, `type`, `ts`, `data`, `meta`
   - `meta` should contain: `pid`, `sid`, `url`, `vw`, `vh`, `tz`
   - `data` should match expected structure for each collector type

5. **Check event counts:**
   - Use extension popup to see pending event count
   - Events are batched and uploaded every 3 seconds or 100 events

### Debugging Tips

- **Enable verbose logging:**
  - Edit `src/config.ts` and set `VERBOSE = true`
  - Rebuild extension (`bun run dev`)
  - Check console for detailed logs

- **Check collector status:**
  - Extension popup → Collections tab
  - Shows enabled/disabled state for each collector

- **Monitor network:**
  - DevTools → Network tab
  - Filter for requests to your worker endpoint
  - Should see POST requests with batched events

- **Clear storage:**
  - DevTools → Application → Storage → Clear site data
  - Or manually delete IndexedDB database

## Common Issues

### Collectors not emitting events
- Check if collector is enabled in popup
- Verify you're on a regular webpage (not chrome:// pages)
- Check browser console for errors
- Ensure extension has proper permissions

### Events not appearing in IndexedDB
- Check if EventBuffer is initialized
- Verify upload callback is set
- Check for errors in console
- Ensure IndexedDB is accessible (not in incognito mode)

### Performance issues
- Check throttling/debouncing is working
- Monitor event frequency in console
- Verify batch size limits (100 events or 3 seconds)

## Test Data Examples

### Cursor Event
```json
{
  "id": "ulid-here",
  "type": "cursor",
  "ts": 1234567890,
  "data": {
    "x": 0.5,
    "y": 0.5,
    "t": "#button-id",
    "cursor": "pointer",
    "event": "click",
    "button": 0
  },
  "meta": {
    "pid": "participant-id",
    "sid": "session-id",
    "url": "https://example.com",
    "vw": 1024,
    "vh": 768,
    "tz": "America/New_York"
  }
}
```

### Navigation Event
```json
{
  "id": "ulid-here",
  "type": "navigation",
  "ts": 1234567890,
  "data": {
    "event": "focus"
  },
  "meta": { ... }
}
```

### Viewport Event
```json
{
  "id": "ulid-here",
  "type": "viewport",
  "ts": 1234567890,
  "data": {
    "event": "scroll",
    "scrollX": 0,
    "scrollY": 0.5
  },
  "meta": { ... }
}
```
