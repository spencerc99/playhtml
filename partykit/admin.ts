import type * as Party from "partykit/server";
import { unstable_getYDoc } from "y-partykit";
import { syncedStore } from "@syncedstore/core";
import { clonePlain } from "@playhtml/common";
import { Buffer } from "node:buffer";
import * as Y from "yjs";
import { supabase } from "./db";
import PartyServer from "./party";

function compareKeys(
  obj1: any,
  obj2: any
): { directOnly: string[]; liveOnly: string[]; common: string[] } {
  if (!obj1 || !obj2) return { directOnly: [], liveOnly: [], common: [] };

  const keys1 = new Set(Object.keys(obj1));
  const keys2 = new Set(Object.keys(obj2));

  return {
    directOnly: [...keys1].filter((k) => !keys2.has(k)),
    liveOnly: [...keys2].filter((k) => !keys1.has(k)),
    common: [...keys1].filter((k) => keys2.has(k)),
  };
}

export class AdminHandler {
  constructor(private context: PartyServer) {}

  async handleRequest(request: Party.Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Handle CORS preflight requests
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 200,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        });
      }

      // Route admin endpoints
      if (path.includes("admin/inspect") && request.method === "GET") {
        return this.handleAdminInspect(request);
      }
      if (path.includes("admin/raw-data") && request.method === "GET") {
        return this.handleAdminRawData(request);
      }
      if (
        path.includes("admin/remove-subscriber") &&
        request.method === "POST"
      ) {
        return this.handleAdminRemoveSubscriber(request);
      }
      if (path.includes("admin/live-compare") && request.method === "GET") {
        return this.handleAdminLiveCompare(request);
      }
      if (path.includes("admin/force-save-live") && request.method === "POST") {
        return this.handleAdminForceSaveLive(request);
      }
      if (
        path.includes("admin/force-reload-live") &&
        request.method === "POST"
      ) {
        return this.handleAdminForceReloadLive(request);
      }

      return new Response("Admin endpoint not found", { status: 404 });
    } catch (err) {
      console.error("Admin request error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  private checkAdminAuth(request: Party.Request): Response | null {
    const adminToken = process.env.ADMIN_TOKEN;
    if (adminToken) {
      const url = new URL(request.url);
      const token =
        url.searchParams.get("token") ||
        request.headers.get("Authorization")?.replace("Bearer ", "");

      if (!token || token !== adminToken) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return null;
  }

  private async handleAdminInspect(request: Party.Request): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      const subscribers = await this.context.getSubscribers();
      const sharedReferences = await this.context.getSharedReferences();
      const sharedPermissions = await this.context.getSharedPermissions();

      // Get Y.Doc data if available - use direct approach for consistency
      let ydocData = null;
      try {
        // Create fresh Y.Doc and load data directly (same as debug reconstruction)
        const yDoc = new Y.Doc();
        const { data: docData } = await supabase
          .from("documents")
          .select("name, document, created_at")
          .eq("name", this.context.room.id)
          .maybeSingle();

        if (docData?.document) {
          const buffer = new Uint8Array(
            Buffer.from(docData.document, "base64")
          );
          Y.applyUpdate(yDoc, buffer);
        }

        // Extract Y.Doc data using SyncedStore exactly like PlayHTML does
        const store = syncedStore<{ play: Record<string, any> }>(
          { play: {} },
          yDoc
        );

        // Clone the store.play data to get a plain object
        const playData = clonePlain(store.play);
        const hasAnyData = Object.keys(playData).some(
          (tag) => Object.keys(playData[tag] || {}).length > 0
        );

        // Return 404-like response if no actual play data exists
        if (!hasAnyData) {
          return new Response(
            JSON.stringify({
              error: "No Y.Doc play data found",
              message: "Room exists but contains no PlayHTML data",
              roomId: this.context.room.id,
            }),
            {
              status: 404,
              headers: {
                "content-type": "application/json",
                "Access-Control-Allow-Origin": "*",
              },
            }
          );
        }

        ydocData = {
          play: playData,
          awareness: {
            clientCount: Array.from(this.context.room.getConnections()).length,
          },
        };
      } catch (error: unknown) {
        console.warn("Failed to extract Y.Doc data:", error);
        ydocData = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const roomData = {
        roomId: this.context.room.id,
        subscribers,
        sharedReferences,
        sharedPermissions,
        ydoc: ydocData,
        connections: Array.from(this.context.room.getConnections()).length,
        timestamp: new Date().toISOString(),
      };

      return new Response(JSON.stringify(roomData, null, 2), {
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    } catch (error: unknown) {
      console.error("Admin inspect error:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to inspect room",
          message: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        }
      );
    }
  }

  private async handleAdminRawData(request: Party.Request): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      // Get raw document from Supabase
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("name", this.context.room.id)
        .maybeSingle();

      if (error) {
        return new Response(
          JSON.stringify({
            error: "Failed to fetch raw data",
            message: error.message,
          }),
          {
            status: 500,
            headers: { "content-type": "application/json" },
          }
        );
      }

      const rawData = {
        roomId: this.context.room.id,
        exists: !!data,
        document: data
          ? {
              name: data.name,
              document: data.document,
              base64Length: data.document?.length || 0,
              created_at: data.created_at,
              // First 100 chars for quick inspection
              documentPreview:
                data.document?.substring(0, 100) +
                (data.document?.length > 100 ? "..." : ""),
            }
          : null,
        timestamp: new Date().toISOString(),
      };

      return new Response(JSON.stringify(rawData, null, 2), {
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    } catch (error: unknown) {
      console.error("Admin raw data error:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to fetch raw data",
          message: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        }
      );
    }
  }

  private async handleAdminLiveCompare(
    request: Party.Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      // Method 1: Direct Y.Doc approach (what admin console uses)
      const directYDoc = new Y.Doc();
      const { data: docData } = await supabase
        .from("documents")
        .select("document")
        .eq("name", this.context.room.id)
        .maybeSingle();

      let directData = null;
      if (docData?.document) {
        const buffer = new Uint8Array(Buffer.from(docData.document, "base64"));
        Y.applyUpdate(directYDoc, buffer);
        const directStore = syncedStore<{ play: Record<string, any> }>(
          { play: {} },
          directYDoc
        );
        directData = clonePlain(directStore.play);
      }

      // Method 2: Live server approach (using unstable_getYDoc like the running server)
      let liveData = null;
      let liveDebugInfo: any = {};
      try {
        const liveYDoc = await unstable_getYDoc(
          this.context.room,
          this.context.providerOptions
        );

        // Debug the raw Y.Doc state
        const playMap = liveYDoc.getMap("play");
        liveDebugInfo = {
          hasPlayMap: !!playMap,
          playMapSize: playMap ? playMap.size : 0,
          docClientId: liveYDoc.clientID,
          docGuid: liveYDoc.guid,
          stateVectorLength: Y.encodeStateVector(liveYDoc).length,
        };

        const liveStore = syncedStore<{ play: Record<string, any> }>(
          { play: {} },
          liveYDoc
        );
        liveData = clonePlain(liveStore.play);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Live data extraction failed:", msg);
        liveData = { error: `Failed to get live data: ${msg}` };
        liveDebugInfo.error = msg;
      }

      const comparison = {
        roomId: this.context.room.id,
        timestamp: new Date().toISOString(),
        methods: {
          direct: {
            description:
              "Direct Y.Doc creation + database load (admin console method)",
            data: directData,
            hasData: directData && Object.keys(directData).length > 0,
          },
          live: {
            description:
              "unstable_getYDoc from y-partykit (live server method)",
            data: liveData,
            hasData:
              liveData && !liveData.error && Object.keys(liveData).length > 0,
            debugInfo: liveDebugInfo,
          },
        },
        differences: {
          sameKeys: compareKeys(directData, liveData),
          dataMatch: JSON.stringify(directData) === JSON.stringify(liveData),
        },
      };

      return new Response(JSON.stringify(comparison, null, 2), {
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    } catch (error: unknown) {
      console.error("Admin live compare error:", error);
      return new Response(
        JSON.stringify({
          error: "Failed to compare data methods",
          message: error instanceof Error ? error.message : String(error),
        }),
        {
          status: 500,
          headers: { "content-type": "application/json" },
        }
      );
    }
  }

  private async handleAdminForceSaveLive(
    request: Party.Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      const liveYDoc = await unstable_getYDoc(
        this.context.room,
        this.context.providerOptions
      );
      const content = Y.encodeStateAsUpdate(liveYDoc);
      const { error } = await supabase.from("documents").upsert(
        {
          name: this.context.room.id,
          document: Buffer.from(content).toString("base64"),
        },
        { onConflict: "name" }
      );
      if (error) throw new Error(error.message);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    } catch (error: unknown) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  private async handleAdminForceReloadLive(
    request: Party.Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      const liveYDoc = await unstable_getYDoc(
        this.context.room,
        this.context.providerOptions
      );
      // Load snapshot from DB
      const { data, error } = await supabase
        .from("documents")
        .select("document")
        .eq("name", this.context.room.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data?.document) {
        return new Response(
          JSON.stringify({ ok: false, reason: "no-db-snapshot" }),
          {
            status: 404,
            headers: { "content-type": "application/json" },
          }
        );
      }
      const buffer = new Uint8Array(Buffer.from(data.document, "base64"));
      // Apply DB snapshot onto live doc (merge)
      Y.applyUpdate(liveYDoc, buffer);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    } catch (error: unknown) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : String(error),
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  private async handleAdminRemoveSubscriber(
    request: Party.Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      const body = (await request.json()) as any;
      const consumerRoomId = String(body?.consumerRoomId || "").trim();
      if (!consumerRoomId) {
        return new Response(
          JSON.stringify({ error: "Missing consumerRoomId" }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          }
        );
      }

      const subscribers = await this.context.getSubscribers();
      const next = subscribers.filter(
        (s) => s.consumerRoomId !== consumerRoomId
      );
      await this.context.setSubscribers(next);

      return new Response(
        JSON.stringify({ ok: true, removed: subscribers.length - next.length }),
        {
          headers: {
            "content-type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        }
      );
    } catch (error: unknown) {
      return new Response(
        JSON.stringify({
          error: "Failed to remove subscriber",
          message: error instanceof Error ? error.message : String(error),
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }
}
