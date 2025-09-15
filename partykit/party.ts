/**
 * SHARED ELEMENTS LIFECYCLE - Source/Consumer Flow:
 *
 * 1. SOURCE PAGE (localhost:5173/shared-test-source.html):
 *    - Client discovers shared elements via findSharedElementsOnPage()
 *    - YPartyKitProvider connects with sharedElements in params
 *    - Main party calls registerWithSharedParty() via HTTP
 *    - Shared party stores element registry and responds
 *    - Source room Y.Doc is available for data requests
 *
 * 2. CONSUMER PAGE (localhost:5177/shared-test-consumer.html):
 *    - Client discovers references via findSharedReferencesOnPage()
 *    - YPartyKitProvider connects with sharedReferences in params
 *    - Main party calls requestSharedAccess() via HTTP
 *    - Shared party checks registry, gets data from source, sends via WebSocket
 *    - Consumer receives shared-element-data messages and injects into local store
 *
 * 3. REAL-TIME UPDATES:
 *    - Source changes trigger broadcastSharedUpdates()
 *    - Shared party broadcasts to all subscribed consumer rooms
 *    - Consumers receive shared-element-update messages
 */

import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";
import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import * as Y from "yjs";

interface SharedElement {
  elementId: string;
  permissions: string;
  scope: "domain" | "global";
  path?: string;
}

interface SharedReference {
  domain: string;
  path: string;
  elementId: string;
}

// Helper functions for shared element coordination
async function registerWithSharedParty(
  elements: SharedElement[],
  room: Party.Room
) {
  try {
    const sharedParty = room.context.parties.shared.get("registry");
    const domain = extractDomain(room.id);

    console.log(
      `[MAIN-PARTY] Registering ${elements.length} shared elements for domain: ${domain}`
    );

    await sharedParty.fetch({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "register-shared-elements",
        domain,
        roomId: room.id,
        elements,
      }),
    });
  } catch (error) {
    console.error("[MAIN-PARTY] Failed to register with shared party:", error);
  }
}

async function requestSharedAccess(
  references: SharedReference[],
  room: Party.Room,
  mainPartyInstance: any
) {
  try {
    const sharedParty = room.context.parties.shared.get("registry");
    const domain = extractDomain(room.id);

    console.log(
      `[MAIN-PARTY] Requesting access to ${references.length} shared elements`
    );

    const response = await sharedParty.fetch({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "request-shared-access",
        requestingDomain: domain,
        requestingRoomId: room.id,
        references,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success && data.sharedElements) {
        console.log(`[MAIN-PARTY] Received ${data.sharedElements.length} shared elements via HTTP`);
        
        // Process each shared element directly
        for (const elementData of data.sharedElements) {
          await mainPartyInstance.injectSharedElementData(elementData);
          room.broadcast(JSON.stringify(elementData));
        }
      }
    }
  } catch (error) {
    console.error("[MAIN-PARTY] Failed to request shared access:", error);
  }
}

function extractDomain(roomId: string): string {
  // Extract domain from room ID format: "domain-path"
  // roomId looks like: "localhost%3A5173-/shared-test-source" (URL-encoded)
  const parts = roomId.split("-");
  const domainPart = parts[0] || "unknown";

  // Decode the URL-encoded domain to match data-source references
  const decodedDomain = decodeURIComponent(domainPart);

  console.log(
    `[MAIN-PARTY] Extracted domain: "${decodedDomain}" from roomId: "${roomId}"`
  );
  return decodedDomain;
}

// Create a single supabase client for interacting with your database
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_KEY as string,
  { auth: { persistSession: false } }
);

export default class implements Party.Server {
  private currentDoc: Y.Doc | null = null;

  constructor(public room: Party.Room) {}

  /**
   * Handles incoming WebSocket messages from clients
   * - Processes shared-element-data messages from shared party
   * - Injects shared data into room's Y.Doc
   * - Broadcasts messages to all room connections
   */
  async onMessage(
    message: string | ArrayBuffer | ArrayBufferView,
    sender: Party.Connection<unknown>
  ): Promise<void> {
    if (typeof message === "string") {
      try {
        const data = JSON.parse(message);

        // Handle element updates for shared elements
        if (data.type === "element-update") {
          // TODO: Broadcast to shared party for cross-domain updates
          this.room.broadcast(message);
        } else {
          // Regular message broadcasting
          this.room.broadcast(message);
        }
      } catch {
        // Not JSON, broadcast as-is
        this.room.broadcast(message);
      }
    }
  }

  /**
   * Handles new client connections to this room
   * - Extracts shared elements/references from connection params
   * - Registers shared elements with shared party (if any)
   * - Requests access to shared references (if any)
   * - Sets up Y.js document and persistence
   */
  async onConnect(connection: Party.Connection) {
    const room = this.room;
    const url = new URL(connection.uri);
    const sharedElements = JSON.parse(
      url.searchParams.get("sharedElements") || "[]"
    );
    const sharedReferences = JSON.parse(
      url.searchParams.get("sharedReferences") || "[]"
    );

    const self = this;
    await onConnect(connection, this.room, {
      async load() {
        // This is called once per "room" when the first user connects

        // Let's make a Yjs document
        const doc = new Y.Doc();
        self.currentDoc = doc;

        // Load the document from the database
        const { data, error } = await supabase
          .from("documents")
          .select("document")
          .eq("name", room.id)
          .maybeSingle();

        if (error) {
          throw new Error(error.message);
        }

        if (data) {
          // If the document exists on the database,
          // apply it to the Yjs document
          Y.applyUpdate(
            doc,
            new Uint8Array(Buffer.from(data.document, "base64"))
          );
        }

        // Register shared elements if any
        if (sharedElements.length > 0) {
          await registerWithSharedParty(sharedElements, room);
        }

        // Request shared element access if any
        if (sharedReferences.length > 0) {
          await requestSharedAccess(sharedReferences, room, self);
        }

        // Return the Yjs document
        return doc;
      },
      callback: {
        handler: async (doc) => {
          // This is called every few seconds if the document has changed

          // convert the Yjs document to a Uint8Array
          const content = Y.encodeStateAsUpdate(doc);

          // Save the document to the database
          const { data: _data, error } = await supabase
            .from("documents")
            .upsert(
              {
                name: room.id,
                document: Buffer.from(content).toString("base64"),
              },
              { onConflict: "name" }
            );

          if (error) {
            console.error("failed to save:", error);
          }

          // TODO: Implement broadcasting of shared element updates
          // await self.broadcastSharedUpdates.call(self, doc);
        },
      },
    });
  }

  /**
   * Injects shared element data received from shared party into this room's Y.Doc
   * - Stores data in a special "shared-elements" map within Y.Doc
   * - Includes metadata like source domain and permissions
   */
  async injectSharedElementData(data: any) {
    if (!this.currentDoc) {
      console.error("[MAIN-PARTY] No Y.Doc available for injection");
      return;
    }

    try {
      const { elementId, data: elementData, sourceDomain, permissions } = data;

      // Inject into the SyncedStore structure
      console.log(
        `[MAIN-PARTY] Injecting shared element data for ${elementId}:`,
        elementData
      );

      // Get or create the SyncedStore shared elements map
      const syncedStoreMap = this.currentDoc.getMap("syncedstore");
      let sharedElementsMap = syncedStoreMap.get("shared-elements");
      if (!sharedElementsMap) {
        sharedElementsMap = new Y.Map();
        syncedStoreMap.set("shared-elements", sharedElementsMap);
      }

      // Store the shared element data with metadata
      sharedElementsMap.set(elementId, {
        data: elementData,
        sourceDomain,
        permissions,
        lastUpdated: Date.now(),
      });

      console.log(
        `[MAIN-PARTY] Successfully injected shared element ${elementId} from ${sourceDomain}`
      );
    } catch (error) {
      console.error(
        "[MAIN-PARTY] Failed to inject shared element data:",
        error
      );
    }
  }

  /**
   * Detects changes to shared elements and notifies shared party for broadcasting
   * - Scans Y.Doc for changes to elements that are marked as shared
   * - Sends updates to shared party for propagation to other rooms
   */
  private async broadcastSharedUpdates(doc: Y.Doc) {
    // Check if we have any shared elements registered and broadcast updates
    try {
      const domain = this.extractDomain(this.room.id);

      // Check the SyncedStore play map for changes to shared elements
      const directPlayMap = doc.getMap("play");
      if (directPlayMap) {
        directPlayMap.forEach((capabilityMap, capabilityType) => {
          if (capabilityMap instanceof Y.Map) {
            capabilityMap.forEach((elementData, elementId) => {
              // TODO: Check if this element is registered as shared and broadcast to subscribers
              console.log(
                `[MAIN-PARTY] Detected change in ${capabilityType}:${elementId}`
              );
            });
          }
        });
      }
    } catch (error) {
      console.error("[MAIN-PARTY] Error broadcasting shared updates:", error);
    }
  }

  /**
   * Handles HTTP requests for element data from shared party
   * - GET requests return current element data from this room's Y.Doc
   * - Used by shared party to fetch data for cross-domain sharing
   */
  async onRequest(request: Request): Promise<Response> {
    // Handle GET requests for element data (used by shared party)
    if (request.method === "GET") {
      try {
        console.log(
          `[MAIN-PARTY] Received element data request for room: ${this.room.id}`
        );

        if (!this.currentDoc) {
          console.log("[MAIN-PARTY] No Y.Doc available yet");
          return new Response(
            JSON.stringify({
              elements: {},
              status: "no-doc",
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        }

        // Extract element data from Y.Doc
        const elements: Record<string, any> = {};

        console.log(
          `[MAIN-PARTY] Available Y.Doc share keys:`,
          Array.from(this.currentDoc.share.keys())
        );

        // Check the SyncedStore structure (new approach)
        const syncedStoreMap = this.currentDoc.getMap("syncedstore");
        if (syncedStoreMap) {
          const playMap = syncedStoreMap.get("play");
          if (playMap instanceof Y.Map) {
            console.log(
              `[MAIN-PARTY] Found SyncedStore play map with ${playMap.size} capabilities`
            );
            playMap.forEach((capabilityMap, capability) => {
              if (capabilityMap instanceof Y.Map) {
                console.log(
                  `[MAIN-PARTY] Checking synced capability map: ${capability} (${capabilityMap.size} elements)`
                );
                capabilityMap.forEach((elementData, elementId) => {
                  // Convert Y.Map to plain object for transmission
                  const plainData =
                    elementData instanceof Y.Map
                      ? elementData.toJSON()
                      : elementData;
                  elements[elementId] = plainData;
                  console.log(
                    `[MAIN-PARTY] Found element ${elementId} in synced:${capability}:`,
                    plainData
                  );
                });
              }
            });
          }
        }

        // Also check the direct "play" map (alternative SyncedStore structure)
        const directPlayMap = this.currentDoc.getMap("play");
        if (directPlayMap) {
          console.log(
            `[MAIN-PARTY] Found direct play map with ${directPlayMap.size} capabilities`
          );
          directPlayMap.forEach((capabilityMap, capability) => {
            if (capabilityMap instanceof Y.Map) {
              console.log(
                `[MAIN-PARTY] Checking direct capability map: ${capability} (${capabilityMap.size} elements)`
              );
              capabilityMap.forEach((elementData, elementId) => {
                // Convert Y.Map to plain object for transmission
                const plainData =
                  elementData instanceof Y.Map
                    ? elementData.toJSON()
                    : elementData;
                elements[elementId] = plainData;
                console.log(
                  `[MAIN-PARTY] Found element ${elementId} in direct:${capability}:`,
                  plainData
                );
              });
            }
          });
        }

        // Legacy playhtml-global map removed - we've migrated to SyncedStore only

        console.log(
          `[MAIN-PARTY] Returning ${Object.keys(elements).length} elements`
        );

        return new Response(
          JSON.stringify({
            elements,
            status: "ok",
            roomId: this.room.id,
          }),
          {
            headers: { "Content-Type": "application/json" },
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            error: "Failed to get room data",
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    return new Response("Method not allowed", { status: 405 });
  }
}
