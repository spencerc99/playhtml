# Extension Future Improvements

This document tracks future enhancements and optimizations for the PlayHTML extension.

## Historical Overlay System

### Server-Side URL Filtering
**Status:** Not implemented (using client-side filtering)
**Priority:** Medium (optimization)

**Current behavior:**
- When filtering by URL mode, we fetch all events for the domain from the server
- Then filter to specific normalized URL client-side
- This over-fetches data when a domain has many pages

**Proposed solution:**
1. Add `normalized_url` column to `collection_events` table:
   ```sql
   ALTER TABLE collection_events
   ADD COLUMN normalized_url TEXT
   GENERATED ALWAYS AS (
     regexp_replace(
       regexp_replace(url, '\?.*$', ''),  -- Remove query params
       '#.*$', ''                          -- Remove hash
     )
   ) STORED;

   CREATE INDEX idx_events_normalized_url
   ON collection_events(normalized_url, type, ts DESC);
   ```

2. Update worker API `/events/recent` to support `url` parameter:
   ```typescript
   // In worker/src/routes/recent.ts
   const urlFilter = url.searchParams.get('url') || null;

   if (urlFilter) {
     const normalizedUrl = normalizeUrl(urlFilter);
     query = query.eq('normalized_url', normalizedUrl);
   }
   ```

3. Update client to use server-side filtering when available:
   ```typescript
   // In historyLoader.ts
   const params = new URLSearchParams({
     type,
     limit: limit.toString(),
     url: mode === 'url' ? normalizedUrl : undefined,
     domain: mode === 'domain' ? domain : undefined,
   });
   ```

4. Keep client-side fallback for backwards compatibility

**Benefits:**
- Reduced bandwidth (fetch only relevant events)
- Faster queries (indexed database lookup)
- Better scalability for sites with many pages

**Implementation notes:**
- Must use identical normalization logic on client and server
- Consider migrating existing URLs (backfill normalized_url column)
- Test with various URL formats (internationalized domains, encoded characters, etc.)

---

### Local Storage: Store Normalized URLs
**Status:** Not implemented (normalizing at query time)
**Priority:** Low (optimization)

**Current behavior:**
- Raw URLs stored in IndexedDB: `https://example.com/page?q=1#hash`
- Normalized at query time in `LocalEventStore.queryByUrl()`
- Full table scan required to find matching URLs

**Proposed solution:**
1. Add `normalizedUrl` field to events at collection time:
   ```typescript
   // In EventBuffer.createEvent()
   import { normalizeUrl } from '../utils/urlNormalization';

   return {
     meta: {
       url: window.location.href,           // Keep original
       normalizedUrl: normalizeUrl(window.location.href), // Add normalized
       // ... other fields
     }
   };
   ```

2. Create index on normalized URL:
   ```typescript
   // In EventBuffer onupgradeneeded
   store.createIndex('normalizedUrl', 'meta.normalizedUrl', { unique: false });
   ```

3. Update LocalEventStore to use index:
   ```typescript
   // Direct index lookup instead of full scan
   const request = normalizedUrlIndex.openCursor(IDBKeyRange.only(normalizedUrl));
   ```

**Benefits:**
- Much faster URL queries (indexed lookup vs full scan)
- Important for users with large local datasets (10k+ events)

**Tradeoffs:**
- Slightly larger storage footprint (~50 bytes per event)
- Migration needed for existing stored events

---

### Data Source Toggle Design
**Status:** Not designed
**Priority:** Medium (UX improvement)

**Context:**
Currently the system:
- Always checks local storage first
- Backfills from server if < 50 local events
- No user control over data source

**Open design questions:**

1. **Toggle visibility:**
   - Should it be always visible, or hidden in settings?
   - Should it show data source indicator (e.g., "847 local, 153 server")?

2. **Toggle options:**
   ```
   Option A: Binary toggle
   [ Auto (prefer local) ] ←→ [ Local Only ]

   Option B: Three-way toggle
   [ Auto ] ←→ [ Local Only ] ←→ [ Server Only ]

   Option C: Preference with override
   Preference: [Auto ▼] (dropdown: Auto / Local / Server)
   Current: "Using 847 local events" (informational)
   ```

3. **Bandwidth considerations:**
   - Should we warn before large server fetches?
   - Add limit controls (e.g., "Fetch up to 1000 events")?
   - Progressive loading UI for large datasets?

4. **Offline behavior:**
   - How should "Server Only" mode behave when offline?
   - Should we cache server responses locally for future use?

5. **Settings persistence:**
   - Per-domain settings vs. global preference?
   - Remember last used mode?

**Proposed approach (to validate):**
```
Bottom bar additions:

[Domain] | 📄↔🌐 | [Events: 847 local, 153 server ▼]
                      └─ Dropdown shows:
                         ☑ Auto (prefer local)
                         ☐ Local only
                         ☐ Server only
                         ────────────────
                         ⚙ Max events: [1000]
```

**Next steps:**
1. Gather user feedback on preferred design
2. Create mockups for different approaches
3. Consider A/B testing if multiple viable options
4. Implementation after design consensus

---

## Performance Optimizations

### Progressive Event Loading
**Priority:** Low (only needed for power users)

For users with 5000+ events on a single domain/page:
- Load and render in chunks (first 500, then more as needed)
- Virtual scrolling for navigation timeline
- Lazy-load animation components

### Memory Management
**Priority:** Low

- Clear overlays when navigating away from page
- Implement event garbage collection for very old data (> 1 year)
- Monitor memory usage in long-running sessions

---

## Future Features

### Collaborative View
**Priority:** Low

Show other users' historical data on the same domain (opt-in):
- Privacy controls (anonymous vs. identified)
- Aggregate visualizations
- Temporal heatmaps

### Export & Sharing
**Priority:** Low

- Export overlay as video/GIF
- Share visualization configurations
- Embeddable widgets for websites

### Advanced Filtering
**Priority:** Low

- Time range picker (last hour, day, week, custom)
- Session-based filtering (show specific browsing session)
- Event type combinations (e.g., "clicks near typing events")

---

## Related Documents

- [data-visualization-architecture.md](../../internal-docs/data-visualization-architecture.md) - System architecture
- [extension-overlay-architecture.md](../../internal-docs/extension-overlay-architecture.md) - Implementation plan
- [collection-system.md](../../internal-docs/collection-system.md) - Data collection details
