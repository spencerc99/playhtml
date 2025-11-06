# Admin Console Cleanup Instructions

This guide explains how to use the admin console to clean up orphaned data in production.

## Prerequisites

1. **Access to Admin Console**: Navigate to the admin console test page (typically at `website/test/admin.html` or similar)
2. **Admin Token**: You need the `ADMIN_TOKEN` environment variable value set on your PartyKit server
3. **Room ID**: Know the room ID you want to clean up (e.g., `playhtml.fun-fridge`)

## Step-by-Step Instructions for Cleaning Up Production

### 1. Open Admin Console

Open the admin console page in your browser.

### 2. Select Production Environment

- Look for the environment selector at the top (should show "ENV: PRODUCTION", "ENV: STAGING", or "ENV: DEVELOPMENT")
- Click it and select **PRODUCTION** if not already selected

### 3. Authenticate

- Click the **"🔐 Authenticate"** button
- Enter your admin token (the value of `ADMIN_TOKEN` from your PartyKit environment)
- Click OK
- You should see "Authenticated" status

### 4. Load the Room

- In the **Room Inspector** section, enter the room ID in the input field
  - For fridge: `playhtml.fun-fridge`
  - Or with wall parameter: `playhtml.fun-fridge?wall=custom-wall`
- Click **"Load Room"**
- Wait for the room data to load (you'll see "✅ Successfully loaded room..." message)

### 5. Enable Debug Tools

- Scroll down to the **Debug Tools** section
- Check the checkbox or toggle to enable debug tools
- This enables all the cleanup functionality

### 6. Open Cleanup Tools

- In the **Debug Tools** section, click **"Show Cleanup Tools"** button
- A new **"🧹 Cleanup Orphaned Data"** section will appear

### 7. Configure Cleanup Settings

In the cleanup section:

1. **Tag to Clean Up**: Select the tag you want to clean (e.g., `can-move` for fridge magnets)
2. **Source Element ID**: Enter the element ID that contains your active IDs
   - For fridge: `newWords` (this is the can-play element that stores the list of words)
   - This should be an element in the `can-play` tag that contains an array of objects with `id` fields

### 8. Run Dry Run

- Click **"🔍 Dry Run"** button
- Wait for the dry run to complete
- Review the results:
  - **Total Entries**: Total entries in the tag
  - **Active Entries**: Entries that match your source IDs
  - **Orphaned Entries**: Entries that will be removed
- Expand "View Orphaned IDs" to see which specific IDs will be removed

### 9. Review Dry Run Results

Before proceeding, verify:

- The number of orphaned entries makes sense
- The orphaned IDs shown are indeed ones you want to remove
- No active entries are incorrectly identified as orphaned

### 10. Execute Cleanup

- If the dry run results look correct, click **"🗑️ Remove X Orphaned"** button
- Confirm the dialog that shows:
  - Number of entries to be removed
  - The tag being cleaned
  - Sample IDs that will be removed
- Wait for the cleanup to complete
- You'll see a success message: "✅ Cleanup completed! Removed X orphaned entries."

### 11. Verify Results

- The room data will automatically reload after cleanup
- Check the room data again to confirm orphaned entries are gone
- The total entry count should have decreased

## Example: Cleaning Up Fridge Room

Here's a specific example for cleaning up the fridge room:

1. **Environment**: Select PRODUCTION
2. **Authenticate**: Enter admin token
3. **Room ID**: `playhtml.fun-fridge` (or `playhtml.fun-fridge?wall=your-wall`)
4. **Load Room**: Click "Load Room"
5. **Enable Debug Tools**: Check the enable toggle
6. **Open Cleanup**: Click "Show Cleanup Tools"
7. **Tag**: Select `can-move`
8. **Source Element**: Enter `newWords`
9. **Dry Run**: Click "🔍 Dry Run"
10. **Review**: Check the orphaned count (should match expected number of deleted magnets)
11. **Execute**: Click "🗑️ Remove X Orphaned" and confirm

## Troubleshooting

### "No active IDs found"

- Verify the **Source Element ID** is correct
- Check that the room has loaded successfully
- Ensure the source element exists in `can-play` tag and contains an array with `id` fields
- Look at the Y.Doc Data section to see the actual structure

### "Dry run failed"

- Check that you're authenticated
- Verify the room ID is correct
- Check the browser console for error messages
- Ensure the admin token is valid for production

### "Cleanup didn't remove all entries"

- Run another dry run after cleanup to verify
- Some entries might be legitimate (created but not yet deleted)
- Check the debug logs for any errors during cleanup

## Safety Features

- **Dry Run First**: Always run a dry run before executing cleanup
- **Confirmation Dialog**: You must confirm before any actual deletion
- **Auto-Reload**: Room data reloads after cleanup to show updated state
- **Logs**: All actions are logged in the Debug Logs section at the bottom

## Multiple Rooms/Walls

If you have multiple walls (like different fridge rooms), you'll need to:

1. Load each room separately
2. Run cleanup for each room
3. Use the appropriate source element ID for each wall's data structure

Example:

- Main fridge: `playhtml.fun-fridge` → source: `newWords`
- Custom wall: `playhtml.fun-fridge?wall=custom` → source: `newWords` (same element)
