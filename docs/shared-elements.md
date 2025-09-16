# Shared Element Design Specification

## Core Design

### HTML Syntax

```html
<!-- Default: shared across domains -->
<div id="counter" shared can-toggle>Public read-write</div>
<div id="status" shared="read-only" can-toggle>Public read-only</div>

<!-- Domain-only sharing -->
<div id="team-counter" shared-domain can-toggle>
  Shared across pages on this domain
</div>
<div
  id="admin-status"
  shared-domain="read-only,write:@admin.example.com"
  can-toggle
>
  Domain sharing with permissions
</div>

<!-- Explicit global sharing -->
<div id="partner-data" shared-global="write:@partner.com" can-toggle>
  Global with specific permissions
</div>

<!-- Referencing shared elements using data-source -->
<div id="counter" data-source="jzhao.xyz/blog#counter" can-toggle>
  References jzhao.xyz's counter
</div>
<div id="status" data-source="example.com#status" can-toggle>
  References example.com's status (domain-scoped)
</div>

<!-- More explicit cross-domain references -->
<div
  id="partner-metrics"
  data-source="partner.com/dashboard#metrics"
  can-toggle
>
  References partner site's dashboard metrics
</div>
<div
  id="global-announcement"
  data-source="announcements.example.com#latest"
  can-toggle
>
  References global announcement system
</div>
```

### Referencing Shared Elements

**Format:** `data-source="domain/<optional pathname>#elementId"`

- `data-source="jzhao.xyz/blog/post#counter"` → References counter from jzhao.xyz/blog/post
- `data-source="jzhao.xyz#global-counter"` → References domain-scoped shared element
- Regular IDs (without `data-source` attribute) remain local to the page

## Implementation Strategy

### Sync Strategy

This is the core challenge of this feature as it requires breaking the fundamental assumption of Y.js where data is scoped to specific rooms. This feature encompasses sharing data for a specific element contained in a single source room to multiple consumer rooms. The data should only be persisted in the source room's database row and not duplicated in the consumer rooms. On request from clients for the consumer, the server should handle automatically populating the data for the shared elements and set up the appropriate handlers to automatically sync bi-directional changes for those shared elements like we do for all the other data in a given room.

Here are several issues to account for:

1. Right now we map data via tag type -> elementId rather than elementId -> data, so for a given elementId, we may have to insert the data piecemeal across the different tag types. The simplest way is that we can use the existing structure and for remote sourced elements and enforce that the ID has to be the same as the ID from the source.
2. It's unclear how we can "observe" changes to the data from a different room and how to coordinate and broadcast those changes to the consumer rooms that are active. Ideally, the server can act as an "always-on" client for the source room and proxy the changes back and forth. The changes should be handled in the conflict resolution logic of Y.js and SyncedStore. When we prototyped adding Y.js observes to the doc in the server, we never received any changes, but maybe we weren't properly applying the changes to the doc.
3. We need some persisted registry of shared elements that can be used to lookup registered shared elements by their rooms. Option 1: We can use a separate "party" to store this registry under a hardcoded room name ('registry') and use the PartyKit storage API to persist the registry. This shared registry will be used to lookup the shared elements by their rooms and to broadcast changes to the consumer rooms. Option 2: We can use the existing "main" party to store the registry on a per-room basis, storing the consumer and source elements for that room, and use the PartyKit storage API to persist the registry. This can then be used to lookup the the source elements for the consumers and provide the data for the source elements to other room consumers.

#### ID Generation / Mapping of shared elements

- For local elements and shared element origins, we use the element's id
- For shared elements that have a source, we use the data-source attribute to derive the elementId from the part after the #. This should override the local elementId.

### Discovery

```typescript
// Client scans DOM and sends shared info during initial connection
const sharedElements = findSharedElementsOnPage();
const sharedReferences = findSharedReferencesOnPage();

const yprovider = new YPartyKitProvider(host, room, doc, {
  params: {
    sharedElements: JSON.stringify(sharedElements),
    sharedReferences: JSON.stringify(sharedReferences),
  },
});

function findSharedReferencesOnPage(): SharedReference[] {
  const elements = document.querySelectorAll("[data-source]");
  return Array.from(elements).map((el) => {
    const dataSource = el.getAttribute("data-source");
    const [domainAndPath, elementId] = dataSource.split("#");
    const pathIndex = domainAndPath.indexOf("/");
    const domain =
      pathIndex === -1 ? domainAndPath : domainAndPath.substring(0, pathIndex);
    const path = pathIndex === -1 ? "/" : domainAndPath.substring(pathIndex);
    return { domain, path, elementId };
  });
}
```

### 4. Key Architectural Benefits

**Y.js Native**: Uses Y.js observers for automatic change detection and conflict resolution  
**Direct Communication**: Consumer rooms connect directly to source rooms, no coordination party needed
**Real-time CRDT**: Built-in conflict resolution through Y.js collaborative data types
**Single Source of Truth**: Source room owns the canonical data, consumers get real-time copies

## Scope and Limitations

### Supported Features

- ✅ Basic cross-domain sharing with `shared` attribute
- ✅ Domain-scoped sharing with `shared-domain`
- ✅ Simple permissions: public read-write, read-only
- ✅ Element references using `data-source="domain/path#elementId"` syntax
- ✅ Real-time bidirectional updates with Y.js CRDT conflict resolution
- ✅ Unified Supabase persistence (no data splitting)
- ✅ Y.js native observers for automatic change detection
- ✅ Direct room-to-room communication (simplified architecture)

## Security Considerations

### Security Model

- **Trust-based**: Relies on client-side registration of shared elements
- **Domain verification**: Server validates requesting domain via connection metadata
- **Permission enforcement**: Basic read-only vs read-write permissions
- **No sensitive data**: Clear documentation that shared elements are public by default

### Future Security Enhancements

- HTML validation for element verification
- Cryptographic signatures for element authenticity
- Rate limiting and abuse prevention
- Advanced permission models

## Future Work

### Phase 1: Basic Sharing

- Basic cross-domain sharing with `shared` attribute
- Element references using `data-source="domain/path#elementId"` syntax
- Shared elements are all read-write.
- Real-time bidirectional updates with Y.js CRDT conflict resolution

### Phase 2:

- simple permissions (read-only, read-write)

### Phase 3: Enhanced Permissions & Validation

- Domain allowlists: `shared-global="write:@team.com,@partner.com"`
- Advanced permission inheritance and delegation

### Phase 4: Performance Optimization

- Sub-document architecture for efficient cross-room sync
- Incremental Y.js updates instead of full document loading
- Smart caching strategies and CDN integration
- Connection pooling and batching for cross-party communication

## Migration Path

V1.0 is designed to be forward-compatible. Future enhancements will be additive:

- New permission syntax will extend existing patterns
- Performance optimizations will be transparent to developers
- Advanced features will be opt-in to maintain simplicity
- Breaking changes will include automated migration tools

This design prioritizes simplicity and developer experience while building a solid foundation for future enhancements.
