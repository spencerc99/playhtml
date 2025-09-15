# Shared Element Design Specification v2.0 - Y.js Observer Architecture

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

### 1. Client-side changes

#### ID Generation / Mapping of shared elements

- For local elements and shared element origins, we use the element's id
- For shared elements that have a source, we use the data-source attribute

YJS Structure

```typescript
const store = syncedStore<StoreShape>({ play: {} });
const sharedElementsMap = syncedStore.get("shared-elements");
```

problem is right now we map data via tag type -> elementId rather than elementId -> data, so how involved is this change to account for shared elements?

Option 1: work with existing structure

// in server
map the shared element data directly to the tag type -> elementId

```typescript
const store = syncedStore<StoreShape>({ play: {} });
for (const elementId in sharedElementsMap) {
  // derive what tag types this elementId is associated with
  const tagTypes = getTagTypesForElement(elementId);
  for (const tagType of tagTypes) {
    store.play[tagType][elementId] = sharedElementsMap.get(elementId);
    // attach observer for this tagType -> elementId
    attachSyncedStoreObserver(tagType, elementId);
  }
}
// in client
const sharedElementsMap = syncedStore.get("shared-elements");
for (const elementId in sharedElementsMap) {
  const tagTypes = getTagTypesForElement(elementId);
  for (const tagType of tagTypes) {
    store.play[tagType][elementId] = sharedElementsMap.get(elementId);
  }
}
```

#### Discovery

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

### 3. Y.js Observer Architecture

**Main Party** (`party="main"`): Handles regular page rooms + shared element coordination
**Shared Party** (`party="shared"`): Lightweight registry for subscriber tracking (optional)

```typescript
// partykit/party.ts - Enhanced Main Party with Y.js Observers
export default class MainParty implements Party.Server {
  private currentDoc: Y.Doc | null = null;
  private observersSetup = false;
  private sharedElementIds = new Set<string>();

  async onConnect(connection: Party.Connection) {
    const sharedElements = getSharedElementsFromParams(connection);
    const sharedReferences = getSharedReferencesFromParams(connection);

    await onConnect(connection, this.room, {
      async load() {
        const doc = new Y.Doc();
        this.currentDoc = doc;

        // Load from Supabase (unified persistence)
        const { data } = await supabase
          .from("documents")
          .select("document")
          .eq("name", this.room.id)
          .maybeSingle();

        if (data) {
          Y.applyUpdate(
            doc,
            new Uint8Array(Buffer.from(data.document, "base64"))
          );
        }

        // Set up shared elements structure if this room has them
        if (sharedElements.length > 0) {
          this.setupSharedElementsStructure(doc, sharedElements);
          this.registerSharedElements(sharedElements);
        }

        // Request access to shared elements from other rooms
        if (sharedReferences.length > 0) {
          await this.requestSharedElementAccess(sharedReferences, doc);
        }

        return doc;
      },

      callback: {
        handler: async (doc) => {
          // Set up observers after first save
          if (!this.observersSetup && this.sharedElementIds.size > 0) {
            this.setupSharedElementObservers(doc);
          }

          // Unified Supabase persistence
          const content = Y.encodeStateAsUpdate(doc);
          await supabase.from("documents").upsert({
            name: this.room.id,
            document: Buffer.from(content).toString("base64"),
          });
        },
      },
    });
  }

  private setupSharedElementObservers(doc: Y.Doc) {
    if (this.observersSetup) return;

    const syncedStore = doc.getMap("syncedstore");
    const sharedElementsMap = syncedStore.get("shared-elements");

    if (sharedElementsMap instanceof Y.Map) {
      console.log("[MAIN-PARTY] Setting up Y.js observers for shared elements");

      // Observer for shared element map changes
      sharedElementsMap.observe((event) => {
        event.keysChanged.forEach((elementId) => {
          const elementData = sharedElementsMap.get(elementId);
          this.broadcastSharedElementChange(elementId, elementData);
        });
      });

      // Observer for individual element changes
      sharedElementsMap.forEach((elementData, elementId) => {
        if (elementData instanceof Y.Map) {
          elementData.observe(() => {
            this.broadcastSharedElementChange(elementId, elementData);
          });
        }
      });

      this.observersSetup = true;
    }
  }

  private async broadcastSharedElementChange(
    elementId: string,
    elementData: any
  ) {
    console.log(
      `[MAIN-PARTY] Broadcasting Y.js change for shared element ${elementId}`
    );

    // Get list of consumer rooms from shared party registry
    const subscribers = await this.getSubscribersForElement(elementId);

    // Broadcast to each consumer room via direct WebSocket
    for (const subscriberRoomId of subscribers) {
      try {
        const consumerRoom =
          this.room.context.parties.main.get(subscriberRoomId);
        const socket = await consumerRoom.socket();

        socket.send(
          JSON.stringify({
            type: "shared-element-update",
            elementId,
            data:
              elementData instanceof Y.Map ? elementData.toJSON() : elementData,
            sourceRoom: this.room.id,
          })
        );
      } catch (error) {
        console.error(
          `[MAIN-PARTY] Failed to broadcast to ${subscriberRoomId}:`,
          error
        );
      }
    }
  }

  private async requestSharedElementAccess(
    references: SharedReference[],
    doc: Y.Doc
  ) {
    for (const ref of references) {
      const sourceRoomId = `${ref.domain}-${ref.path}`;
      const sourceRoom = this.room.context.parties.main.get(sourceRoomId);

      try {
        // Get initial data via HTTP
        const response = await sourceRoom.fetch({
          method: "GET",
          headers: { "X-Shared-Element": ref.elementId },
        });

        if (response.ok) {
          const { elementData } = await response.json();
          this.injectSharedElementData(doc, ref.elementId, elementData);

          // Subscribe for real-time updates via WebSocket
          await this.subscribeToSharedElement(ref, sourceRoom);
        }
      } catch (error) {
        console.error(
          `[MAIN-PARTY] Failed to access shared element ${ref.elementId}:`,
          error
        );
      }
    }
  }
}
```

### 4. Key Architectural Benefits

**Unified Persistence**: All data (local + shared elements) stored together in Supabase
**Y.js Native**: Uses Y.js observers for automatic change detection and conflict resolution  
**Direct Communication**: Consumer rooms connect directly to source rooms, no coordination party needed
**Real-time CRDT**: Built-in conflict resolution through Y.js collaborative data types
**Single Source of Truth**: Source room owns the canonical data, consumers get real-time copies

## V2.0 Scope and Limitations

### Supported Features

- ✅ Basic cross-domain sharing with `shared` attribute
- ✅ Domain-scoped sharing with `shared-domain`
- ✅ Simple permissions: public read-write, read-only
- ✅ Element references using `data-source="domain/path#elementId"` syntax
- ✅ Real-time bidirectional updates with Y.js CRDT conflict resolution
- ✅ Unified Supabase persistence (no data splitting)
- ✅ Y.js native observers for automatic change detection
- ✅ Direct room-to-room communication (simplified architecture)

### V2.0 Limitations

- ❌ Complex permission models (domain allowlists)
- ❌ HTML validation (relies on client-side registration)
- ❌ Lightweight shared party registry (for subscriber tracking)
- ❌ Advanced error handling and retry logic
- ❌ Performance monitoring and analytics

### Key Design Decisions for V2.0

1. **Y.js observers** for reliable change detection without binary parsing
2. **Unified Supabase persistence** to avoid data source fragmentation
3. **Direct room communication** eliminating complex multi-party coordination
4. **CRDT conflict resolution** through Y.js built-in collaborative features
5. **Client-side discovery** for simplicity (no HTML parsing)
6. **Source room ownership** for clear data authority and consistency

## Security Considerations

### V1.0 Security Model

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

### Phase 2: Enhanced Permissions & Validation

- Domain allowlists: `shared-global="write:@team.com,@partner.com"`
- HTML validation for server-side verification
- Well-known endpoints for shared element discovery
- Advanced permission inheritance and delegation

### Phase 3: Performance Optimization

- Sub-document architecture for efficient cross-room sync
- Incremental Y.js updates instead of full document loading
- Smart caching strategies and CDN integration
- Connection pooling and batching for cross-party communication

### Phase 4: Developer Experience

- Shared element marketplace and discovery
- Visual debugging tools for shared element relationships
- Component-level sharing (styles + behavior)
- Advanced error handling and diagnostics

### Phase 5: Advanced Features

- Offline-first shared elements with conflict resolution
- Real-time collaboration awareness across domains
- Shared element versioning and migration tools
- Integration with external authentication providers

## Migration Path

V1.0 is designed to be forward-compatible. Future enhancements will be additive:

- New permission syntax will extend existing patterns
- Performance optimizations will be transparent to developers
- Advanced features will be opt-in to maintain simplicity
- Breaking changes will include automated migration tools

This design prioritizes simplicity and developer experience while building a solid foundation for future enhancements.
