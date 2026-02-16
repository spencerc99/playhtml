# Data Cleanup

When elements are deleted from your application, their playhtml data can accumulate in the database, especially for tags like `can-move` that store per-element state. PlayHTML provides tools to clean up this orphaned data.

## Runtime Cleanup API

For elements deleted at runtime, use `playhtml.deleteElementData()` to clean up all associated data:

```javascript
// Remove all data for a specific element ID and tag
playhtml.deleteElementData("can-move", elementId);
```

This removes:

- SyncedStore data
- Observer subscriptions
- Element handlers
- Legacy globalData entries (if applicable)

### Example: Cleaning up deleted fridge magnets

```tsx
function handleDeleteWord(id: string) {
  // Remove from your data store
  setData((d) => d.filter((w) => w.id !== id));

  // Clean up playhtml data
  if (window.playhtml) {
    window.playhtml.deleteElementData("can-move", id);
  }
}
```

## Admin Cleanup Endpoint

For bulk cleanup of orphaned data, use the admin cleanup endpoint. This is useful when you have many orphaned entries or need to clean up data that wasn't properly removed at runtime.

**Endpoint:** `POST /parties/main/{roomId}/admin/cleanup-orphans`

**Request body:**

```json
{
  "tag": "can-move",
  "activeIds": ["id1", "id2", "id3"],
  "dryRun": false
}
```

**Response:**

```json
{
  "ok": true,
  "tag": "can-move",
  "total": 5000,
  "active": 100,
  "removed": 4900,
  "orphanedIds": ["orphan1", "orphan2", ...],
  "message": "Removed 4900 orphaned entries"
}
```

## Using the Cleanup Script

```bash
# Set your admin token
export ADMIN_TOKEN=your_token_here

# Dry run to see what would be removed
DRY_RUN=true bun scripts/cleanup-orphans.ts "playhtml.fun-fridge" "can-move" "id1" "id2" "id3"

# Actually perform cleanup
bun scripts/cleanup-orphans.ts "playhtml.fun-fridge" "can-move" "id1" "id2" "id3"
```

## Best Practices

1. **Always use runtime cleanup** when deleting elements programmatically to prevent accumulation
2. **Run periodic cleanup** for sites with high deletion rates or long-running sessions
3. **Use dry runs first** when using the admin endpoint to verify what will be removed
4. **Derive active IDs** from your application's data store (e.g., from your `can-play` elements' data)

## Example: Cleaning up fridge room

```bash
# First, get active IDs from your application data
# (In this case, from the "newWords" can-play element)
# Then run cleanup:

bun scripts/cleanup-orphans.ts \
  "playhtml.fun-fridge" \
  "can-move" \
  $(curl -s "https://playhtml.spencerc99.partykit.dev/parties/main/playhtml.fun-fridge/admin/inspect?token=$ADMIN_TOKEN" | jq -r '.ydoc.play["can-play"]["newWords"][].id')
```
