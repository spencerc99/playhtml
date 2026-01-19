# Admin Console Preview Feature

## Overview

The preview feature allows administrators to preview how data changes will appear on any playhtml page before saving them to the database. This provides a safe way to validate changes and catch potential issues before they affect live users.

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Admin Console                             │
│                                                                   │
│  1. Load room data (from DB or live)                            │
│  2. Edit JSON in textarea                                       │
│  3. Click "Preview in New Window"                               │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Preview URL: [auto-derived or custom]                   │  │
│  │  ┌────────────────────┐  ┌──────────────────────────┐   │  │
│  │  │ 👁️ Preview         │  │ 💾 Save to Database      │   │  │
│  │  └────────────────────┘  └──────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Stores in localStorage:
                              │ {
                              │   roomId: string,
                              │   data: {...},
                              │   timestamp: number
                              │ }
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Popup Window (Preview)                        │
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 👁️ PREVIEW MODE - Read-only, not connected to server      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  1. Detects ?__playhtml_preview__=true                          │
│  2. Reads preview data from localStorage                        │
│  3. Calls playhtml.initPreviewMode(data)                        │
│  4. Renders page with preview data (no server connection)       │
│                                                                   │
│  [Page content renders with preview data...]                    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Usage

### Step 1: Access Admin Console

Navigate to `/admin.html` and authenticate with your admin token.

### Step 2: Load a Room

Enter a room ID and click "Load Room". The room ID format is:
- `host-/path` (URL encoded)
- Example: `localhost%3A5173-/fridge`

### Step 3: Load Data

In the "Backup Comparison" section, load data using one of these buttons:
- **Load Backup Data** - Load from a backup file
- **Load Current DB Data** - Load from the database
- **Load Live Data** - Load from the live Y.Doc

### Step 4: Edit (Optional)

Edit the JSON in the textarea to test different data states.

### Step 5: Preview

1. (Optional) Enter a custom preview URL, or leave blank to auto-derive from room ID
2. Click "👁️ Preview in New Window"
3. A popup opens showing the page with your preview data

### Step 6: Verify

Check that:
- The orange banner appears at the top
- The page renders with your preview data
- Changes don't sync to other clients
- The console shows the preview mode message

### Step 7: Save (If Satisfied)

If the preview looks good, return to the admin console and click "💾 Save Edited Data to Database".

## Technical Details

### Preview Mode Initialization

When `playhtml.initPreviewMode(data)` is called:

1. **No Server Connection**: Unlike normal `init()`, preview mode doesn't connect to PartyKit
2. **Direct Data Population**: Data is directly populated into the SyncedStore
3. **Element Setup**: Elements are set up normally but with static data
4. **Read-Only**: No changes sync anywhere (local or remote)

### URL Derivation

The preview URL is automatically derived from the room ID:

```typescript
// Room ID format: "host-/path"
// Example: "localhost:5173-/fridge"

derivePageUrlFromRoomId("localhost%3A5173-/fridge")
// Returns: "http://localhost:5173/fridge"

derivePageUrlFromRoomId("playhtml.fun-/experiments/5")
// Returns: "https://playhtml.fun/experiments/5"
```

### LocalStorage Schema

Preview data is stored in localStorage with the key `playhtml-preview-data`:

```json
{
  "roomId": "localhost%3A5173-/fridge",
  "data": {
    "can-toggle": {
      "element-id-1": { "toggled": true },
      "element-id-2": { "toggled": false }
    },
    "can-move": {
      "element-id-3": { "x": 100, "y": 200 }
    }
  },
  "timestamp": 1704758400000
}
```

## Visual Indicators

### Console Message

When preview mode initializes, you'll see:

```
࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂
࿂࿂࿂࿂  ࿂    ࿂    ࿂    ࿂    ࿂  ࿂࿂࿂࿂
࿂࿂࿂࿂ PLAYHTML PREVIEW MODE    ࿂࿂࿂࿂
࿂࿂࿂࿂  Read-only, no server    ࿂࿂࿂࿂
࿂࿂࿂࿂   ࿂     ࿂     ࿂     ࿂   ࿂࿂࿂࿂
࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂࿂
[PLAYHTML PREVIEW MODE] - Data is read-only
```

### Banner

A fixed orange banner appears at the top of the page:

```
┌────────────────────────────────────────────────────────────┐
│ 👁️ PREVIEW MODE - Read-only, not connected to server      │
└────────────────────────────────────────────────────────────┘
```

## Limitations

1. **Read-Only**: Preview mode is completely read-only. No changes sync to the server or other clients.
2. **No Cursors**: Cursor tracking and awareness features are disabled in preview mode.
3. **No Collaboration**: Since there's no server connection, collaborative features don't work.
4. **LocalStorage Dependency**: Preview data is stored in localStorage, so it's browser-specific.

## Use Cases

### 1. Data Migration Testing

Test data migrations before applying them:

```json
// Before: Old data structure
{
  "can-toggle": {
    "lamp-1": { "on": true }
  }
}

// After: New data structure
{
  "can-toggle": {
    "lamp-1": { "toggled": true, "brightness": 100 }
  }
}
```

### 2. Bulk Data Changes

Preview bulk changes before applying:

```json
// Reset all toggles to false
{
  "can-toggle": {
    "element-1": { "toggled": false },
    "element-2": { "toggled": false },
    "element-3": { "toggled": false }
  }
}
```

### 3. Data Cleanup

Preview data cleanup operations:

```json
// Remove corrupted or invalid data
{
  "can-move": {
    // Only keep valid elements
    "valid-element-1": { "x": 100, "y": 200 }
    // Removed: corrupted elements
  }
}
```

### 4. Feature Testing

Test new features with specific data states:

```json
// Test edge cases
{
  "can-grow": {
    "test-element": { "scale": 10 }  // Very large scale
  }
}
```

## Troubleshooting

### Preview Window Shows Normal Mode

**Problem**: The preview window doesn't show the banner and connects to the server.

**Solutions**:
1. Check that the URL has `?__playhtml_preview__=true`
2. Check browser console for errors
3. Verify localStorage has `playhtml-preview-data`
4. Try refreshing the preview window

### Preview Data Not Loading

**Problem**: Preview window shows empty or default data.

**Solutions**:
1. Check that JSON is valid (use "Validate & Format JSON" button)
2. Check browser console for parsing errors
3. Verify the data structure matches expected format
4. Try loading data again from admin console

### Wrong Page Opens

**Problem**: Preview opens the wrong page.

**Solutions**:
1. Check that room ID is correct
2. Enter a custom preview URL if auto-derivation is incorrect
3. Verify URL encoding is correct

## Security Considerations

1. **Admin Token Required**: Preview feature is only accessible through the admin console
2. **Client-Side Only**: Preview data is stored in localStorage (client-side)
3. **No Server Impact**: Preview mode never connects to the server
4. **Isolated**: Each preview window is isolated from live data

## Future Enhancements

- [ ] Preview history (recent previews)
- [ ] Side-by-side comparison (current vs. preview)
- [ ] Shareable preview URLs (requires server-side storage)
- [ ] Preview specific elements/tags only
- [ ] Diff view showing changes
- [ ] Preview with mock cursors/awareness

