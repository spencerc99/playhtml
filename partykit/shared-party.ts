import type * as Party from "partykit/server";
import * as Y from "yjs";

interface SharedElementConfig {
  domain: string;
  elementId: string;
  roomId: string;
  permissions: string;
  scope: "domain" | "global";
  path?: string;
}

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

export default class SharedParty implements Party.Server {
  private subscriptions: Map<string, Set<string>> = new Map(); // elementKey -> Set<roomId>

  constructor(public room: Party.Room) {}

  // Persistent registry using PartyKit storage
  private async getSharedRegistry(): Promise<Map<string, SharedElementConfig>> {
    const registry =
      (await this.room.storage.get<Record<string, SharedElementConfig>>(
        "shared-registry"
      )) || {};
    return new Map(Object.entries(registry));
  }

  private async updateSharedRegistry(
    registry: Map<string, SharedElementConfig>
  ) {
    const registryObj = Object.fromEntries(registry);
    await this.room.storage.put("shared-registry", registryObj);
  }

  async onRequest(request: Request): Promise<Response> {
    if (request.method === "POST") {
      try {
        const data = await request.json();
        console.log(`[SHARED-PARTY] Received HTTP request:`, data.type);

        if (data.type === "register-shared-elements") {
          await this.handleRegistrationHTTP(data);
          return new Response(JSON.stringify({ success: true }), {
            headers: { "Content-Type": "application/json" },
          });
        } else if (data.type === "request-shared-access") {
          const sharedElements = await this.handleAccessRequestHTTP(data);
          return new Response(JSON.stringify({ 
            success: true, 
            sharedElements 
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }
      } catch (error) {
        console.error("[SHARED-PARTY] Error handling HTTP request:", error);
        return new Response(
          JSON.stringify({
            error: "Failed to process request",
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

  async onMessage(message: string, sender: Party.Connection) {
    try {
      const data = JSON.parse(message);

      if (data.type === "element-update") {
        await this.handleElementUpdate(data);
      }
    } catch (error) {
      console.error("[SHARED-PARTY] Error handling message:", error);
      sender.send(
        JSON.stringify({
          type: "error",
          message: "Failed to process message",
        })
      );
    }
  }

  private async handleRegistrationHTTP(data: any) {
    const { domain, roomId, elements } = data;
    const registry = await this.getSharedRegistry();

    console.log(
      `[SHARED-PARTY] Registering ${elements.length} shared elements for domain: ${domain}`
    );

    // Register each shared element
    for (const element of elements) {
      const key = `${domain}#${element.elementId}`;
      registry.set(key, {
        domain,
        elementId: element.elementId,
        roomId,
        permissions: element.permissions || "read-write",
        scope: element.scope || "global",
        path: element.path,
      });

      console.log(
        `[SHARED-PARTY] Registered: ${key} (${element.scope}, ${element.permissions})`
      );
    }

    await this.updateSharedRegistry(registry);
  }

  private async handleAccessRequestHTTP(data: any): Promise<any[]> {
    const { requestingDomain, requestingRoomId, references } = data;

    console.log(
      `[SHARED-PARTY] HTTP Access request from ${requestingDomain} for ${references.length} elements`
    );

    const sharedElements = [];

    for (const ref of references) {
      const elementKey = `${ref.domain}#${ref.elementId}`;
      const registry = await this.getSharedRegistry();
      const elementConfig = registry.get(elementKey);

      console.log(`[SHARED-PARTY] Looking for key: "${elementKey}"`);
      console.log(`[SHARED-PARTY] Registry keys:`, Array.from(registry.keys()));
      console.log(`[SHARED-PARTY] Element found:`, !!elementConfig);

      if (elementConfig && this.hasAccess(requestingDomain, elementConfig)) {
        try {
          console.log(`[SHARED-PARTY] Getting data for element ${elementKey}`);

          // Get initial data from source room
          const initialData = await this.getElementData(elementConfig);
          console.log(`[SHARED-PARTY] Got initial data:`, initialData);

          sharedElements.push({
            type: "shared-element-data",
            sourceDomain: ref.domain,
            elementId: ref.elementId,
            data: initialData,
            permissions: elementConfig.permissions,
          });

          console.log(
            `[SHARED-PARTY] Granted access to ${elementKey} for ${requestingDomain}`
          );

          // Subscribe for future updates
          await this.subscribeToUpdates(elementKey, requestingRoomId);
        } catch (error) {
          console.error(
            `[SHARED-PARTY] Error accessing element ${elementKey}:`,
            error
          );
          console.error(`[SHARED-PARTY] Error stack:`, error.stack);
        }
      } else {
        console.log(
          `[SHARED-PARTY] Access denied to ${elementKey} for ${requestingDomain}`
        );
      }
    }

    return sharedElements;
  }



  private hasAccess(
    requestingDomain: string,
    elementConfig: SharedElementConfig
  ): boolean {
    console.log(
      `[SHARED-PARTY] Access check: requesting="${requestingDomain}", element domain="${elementConfig.domain}", scope="${elementConfig.scope}"`
    );

    // Basic permission check for v1.0

    // Domain-scoped elements only accessible from same domain
    if (
      elementConfig.scope === "domain" &&
      requestingDomain !== elementConfig.domain
    ) {
      console.log(
        `[SHARED-PARTY] Access denied: domain-scoped element, domains don't match`
      );
      return false;
    }

    // Global elements are accessible to all domains by default
    console.log(`[SHARED-PARTY] Access granted: global element or same domain`);
    return true;
  }

  private async getElementData(config: SharedElementConfig): Promise<any> {
    // Connect to source room and extract element data
    const sourceRoom = this.room.context.parties.main.get(config.roomId);

    try {
      // Request element data from the main party
      const response = await sourceRoom.fetch({
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const sourceData = await response.json();

      // Extract specific element data from the response
      // TODO: This is a naive approach - will be optimized in future phases
      return sourceData.elements?.[config.elementId] || null;
    } catch (error) {
      console.error(
        `[SHARED-PARTY] Failed to get element data for ${config.elementId}:`,
        error
      );
      return null;
    }
  }

  private async subscribeToUpdates(
    elementKey: string,
    requestingRoomId: string
  ) {
    // Store subscription for future update broadcasting
    if (!this.subscriptions.has(elementKey)) {
      this.subscriptions.set(elementKey, new Set());
    }

    this.subscriptions.get(elementKey)!.add(requestingRoomId);
    console.log(
      `[SHARED-PARTY] Subscribed room ${requestingRoomId} to updates for ${elementKey}`
    );
    console.log(
      `[SHARED-PARTY] Total subscribers for ${elementKey}: ${
        this.subscriptions.get(elementKey)!.size
      }`
    );
  }

  private async handleElementUpdate(data: any) {
    const { elementKey, elementData, sourceDomain } = data;

    console.log(
      `[SHARED-PARTY] Handling element update for ${elementKey} from ${sourceDomain}`
    );

    // Get subscribers for this element
    const subscribers = this.subscriptions.get(elementKey);
    if (!subscribers || subscribers.size === 0) {
      console.log(`[SHARED-PARTY] No subscribers for ${elementKey}`);
      return;
    }

    console.log(
      `[SHARED-PARTY] Broadcasting update to ${subscribers.size} subscribers`
    );

    // Broadcast to all subscribing rooms
    for (const roomId of subscribers) {
      try {
        const mainParty = this.room.context.parties.main.get(roomId);
        const socket = await mainParty.socket();

        socket.send(
          JSON.stringify({
            type: "shared-element-update",
            elementKey,
            elementData,
            sourceDomain,
          })
        );

        console.log(`[SHARED-PARTY] Sent update to room ${roomId}`);
      } catch (error) {
        console.error(
          `[SHARED-PARTY] Failed to send update to room ${roomId}:`,
          error
        );
        // Remove failed subscription
        subscribers.delete(roomId);
      }
    }
  }


}
