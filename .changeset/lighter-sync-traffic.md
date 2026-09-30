---
"playhtml": patch
"@playhtml/common": patch
---

Less network traffic and a smaller download. `setData` on a list now sends only the items that changed, so editing one entry in a long list no longer resends the whole list or grows the room's saved history by a full copy each time. Rapid `setData` calls, such as updates on every pointer move, are batched into at most 20 messages a second; the first change still goes out right away. The build is minified with source maps, and the cursor code only downloads on pages that enable cursors, which cuts the default download from 110 KB to 65 KB gzipped.
