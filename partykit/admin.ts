import type * as Party from "partykit/server";
import { unstable_getYDoc } from "y-partykit";
import { syncedStore } from "@syncedstore/core";
import { Buffer } from "node:buffer";
import * as Y from "yjs";
import { supabase } from "./db";
import PartyServer from "./party";
import {
  docToJson,
  replaceDocState,
  replaceDocFromSnapshot,
  encodeDocToBase64,
  jsonToDoc,
} from "./docUtils";

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

/**
 * AdminHandler provides endpoints for inspecting and managing PlayHTML rooms.
 *
 * Data Flow:
 * - Normal admin edits (save-edited-data, cleanup-orphans) mutate the live Y.Doc directly,
 *   then persist to database. The background autosave will naturally keep DB in sync.
 * - Force-reload-live is an escape hatch for when DB was modified externally (e.g., scripts)
 *   and we need to sync the live doc to match the database state.
 * - All Y.Doc conversions use shared utilities in docUtils.ts for consistency.
 */
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
      if (
        path.includes("admin/save-edited-data") &&
        request.method === "POST"
      ) {
        return this.handleAdminSaveEditedData(request);
      }
      if (path.includes("admin/cleanup-orphans") && request.method === "POST") {
        return this.handleAdminCleanupOrphans(request);
      }
      if (path.includes("admin/hard-reset") && request.method === "POST") {
        return this.handleAdminHardReset(request);
      }
      if (
        path.includes("admin/restore-raw-document") &&
        request.method === "POST"
      ) {
        return this.handleAdminRestoreRawDocument(request);
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
      let documentSize = null;
      try {
        // Create fresh Y.Doc and load data directly (same as debug reconstruction)
        const yDoc = new Y.Doc();
        const { data: docData } = await supabase
          .from("documents")
          .select("name, document, created_at")
          .eq("name", this.context.room.id)
          .maybeSingle();

        if (docData?.document) {
          // Calculate document size (base64 length)
          documentSize = docData.document.length;
          
          const buffer = new Uint8Array(
            Buffer.from(docData.document, "base64")
          );
          Y.applyUpdate(yDoc, buffer);
        }

        // Extract Y.Doc data using shared utility
        const playData = docToJson(yDoc);

        // Return 404-like response if no actual play data exists
        if (!playData) {
          return new Response(
            JSON.stringify({
              error: "No Y.Doc play data found",
              message: "Room exists but contains no PlayHTML data",
              roomId: this.context.room.id,
              documentSize: documentSize || 0,
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
        documentSize: documentSize || 0,
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
        directData = docToJson(directYDoc);
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

        liveData = docToJson(liveYDoc);
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

  /**
   * Force save the current live Y.Doc state to database.
   * This manually triggers a save without waiting for the background autosave.
   */
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
      const base64 = encodeDocToBase64(liveYDoc);
      const { error } = await supabase.from("documents").upsert(
        {
          name: this.context.room.id,
          document: base64,
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

  /**
   * Force reload the live Y.Doc from database snapshot.
   * This is an escape hatch for when the database was modified externally
   * (e.g., via Supabase console or scripts) and we need to sync the live doc.
   */
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
      // Replace live doc state with DB snapshot
      replaceDocFromSnapshot(liveYDoc, data.document);
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

  /**
   * Save edited JSON data to the live Y.Doc and persist to database.
   * This mutates the live doc directly, so the background autosave will
   * naturally persist the same state. No force-reload needed.
   */
  private async handleAdminSaveEditedData(
    request: Party.Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      const body = (await request.json()) as any;
      const editedData = body?.data;

      if (!editedData || typeof editedData !== "object") {
        return new Response(
          JSON.stringify({ error: "Invalid or missing data field" }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          }
        );
      }

      // Get the live Y.Doc and mutate it directly
      const liveYDoc = await unstable_getYDoc(
        this.context.room,
        this.context.providerOptions
      );

      console.log(
        `[Admin] Saving edited data for room ${this.context.room.id}`
      );
      console.log(
        `[Admin] Edited data keys: ${Object.keys(editedData).length}`
      );

      // Replace live doc state with edited data
      replaceDocState(liveYDoc, editedData);

      // Persist immediately to database
      const base64 = encodeDocToBase64(liveYDoc);
      console.log(`[Admin] Encoded content length: ${base64.length}`);

      const { error } = await supabase.from("documents").upsert(
        {
          name: this.context.room.id,
          document: base64,
        },
        { onConflict: "name" }
      );

      if (error) {
        console.error(`[Admin] Database error:`, error);
        throw new Error(error.message);
      }

      console.log(`[Admin] Successfully saved to database and live doc`);

      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    } catch (error: unknown) {
      return new Response(
        JSON.stringify({
          error: "Failed to save edited data",
          message: error instanceof Error ? error.message : String(error),
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

  /**
   * Cleanup orphaned element data for a specific tag.
   * Removes entries that are not in the provided list of active element IDs.
   *
   * Request body:
   * {
   *   tag: string, // e.g., "can-move"
   *   activeIds: string[], // Array of element IDs that should be kept
   *   dryRun?: boolean // If true, only report what would be removed without actually removing
   * }
   */
  private async handleAdminCleanupOrphans(
    request: Party.Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      const body = (await request.json()) as {
        tag?: string;
        activeIds?: string[];
        dryRun?: boolean;
      };

      const tag = body?.tag;
      const activeIds = body?.activeIds;
      const dryRun = body?.dryRun ?? false;

      if (!tag || typeof tag !== "string") {
        return new Response(
          JSON.stringify({ error: "Missing or invalid 'tag' field" }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          }
        );
      }

      if (!Array.isArray(activeIds)) {
        return new Response(
          JSON.stringify({ error: "Missing or invalid 'activeIds' field" }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          }
        );
      }

      const activeIdSet = new Set(activeIds);

      // Load the room document
      const yDoc = await unstable_getYDoc(
        this.context.room,
        this.context.providerOptions
      );
      const store = syncedStore<{ play: Record<string, any> }>(
        { play: {} },
        yDoc
      );

      // Get all entries for the specified tag
      const tagData = store.play[tag];
      if (!tagData || typeof tagData !== "object") {
        return new Response(
          JSON.stringify({
            ok: true,
            tag,
            removed: 0,
            total: 0,
            message: `No data found for tag '${tag}'`,
            dryRun,
          }),
          {
            headers: {
              "content-type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      const allElementIds = Object.keys(tagData);
      const orphanedIds = allElementIds.filter((id) => !activeIdSet.has(id));

      if (dryRun) {
        return new Response(
          JSON.stringify({
            ok: true,
            tag,
            total: allElementIds.length,
            active: activeIds.length,
            orphaned: orphanedIds.length,
            orphanedIds,
            message: `Dry run: Would remove ${orphanedIds.length} orphaned entries`,
            dryRun: true,
          }),
          {
            headers: {
              "content-type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }

      // Remove orphaned entries (mutates live doc directly)
      let removedCount = 0;
      for (const orphanedId of orphanedIds) {
        try {
          delete tagData[orphanedId];
          removedCount++;
        } catch (error) {
          console.error(
            `Failed to remove ${tag}:${orphanedId}:`,
            error instanceof Error ? error.message : String(error)
          );
        }
      }

      // Persist the updated live doc to database
      const base64 = encodeDocToBase64(yDoc);
      const { error: saveError } = await supabase.from("documents").upsert(
        {
          name: this.context.room.id,
          document: base64,
        },
        { onConflict: "name" }
      );

      if (saveError) {
        throw new Error(
          `Failed to save cleaned document: ${saveError.message}`
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          tag,
          total: allElementIds.length,
          active: activeIds.length,
          removed: removedCount,
          orphanedIds,
          message: `Removed ${removedCount} orphaned entries`,
        }),
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
          error: "Failed to cleanup orphans",
          message: error instanceof Error ? error.message : String(error),
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  /**
   * Hard Reset / Garbage Collection: Recreates the Y.Doc from scratch,
   * stripping all history and tombstones. This is the only way to remove
   * YJS deletion metadata that accumulates over time.
   *
   * Process:
   * 1. Extract current live doc state as plain JSON
   * 2. Create a fresh Y.Doc and populate it with the JSON
   * 3. Encode the fresh doc (now history-free) to base64
   * 4. Save to Supabase, replacing the bloated blob
   * 5. Reload the live server from this new snapshot
   */
  private async handleAdminHardReset(
    request: Party.Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      // Get current live doc state
      const liveYDoc = await unstable_getYDoc(
        this.context.room,
        this.context.providerOptions
      );

      // Extract current state as JSON
      const currentPlayData = docToJson(liveYDoc);
      
      // Get size before reset (for reporting)
      const beforeSize = encodeDocToBase64(liveYDoc).length;

      // Handle empty room case - create empty fresh doc
      if (!currentPlayData) {
        // Create an empty fresh Y.Doc
        const emptyDoc = new Y.Doc();
        const emptyBase64 = encodeDocToBase64(emptyDoc);
        const emptyAfterSize = emptyBase64.length;

        // Save empty doc to database
        const { error: saveError } = await supabase.from("documents").upsert(
          {
            name: this.context.room.id,
            document: emptyBase64,
          },
          { onConflict: "name" }
        );

        if (saveError) {
          throw new Error(`Failed to save reset document: ${saveError.message}`);
        }

        // Reload the live server from the new snapshot
        replaceDocFromSnapshot(liveYDoc, emptyBase64);

        return new Response(
          JSON.stringify({
            ok: true,
            message: "Hard reset completed successfully (room was empty)",
            beforeSize,
            afterSize: emptyAfterSize,
            sizeReduction: beforeSize - emptyAfterSize,
            sizeReductionPercent: beforeSize > 0 
              ? `${(((beforeSize - emptyAfterSize) / beforeSize) * 100).toFixed(1)}%`
              : "0%",
            wasEmpty: true,
          }),
          {
            headers: {
              "content-type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, Authorization",
            },
          }
        );
      }

      // Create a fresh Y.Doc with the current state (no history/tombstones)
      const freshDoc = jsonToDoc(currentPlayData);

      // Encode the fresh doc
      const freshBase64 = encodeDocToBase64(freshDoc);
      const afterSize = freshBase64.length;

      // Save to database
      const { error: saveError } = await supabase.from("documents").upsert(
        {
          name: this.context.room.id,
          document: freshBase64,
        },
        { onConflict: "name" }
      );

      if (saveError) {
        throw new Error(`Failed to save reset document: ${saveError.message}`);
      }

      // Reload the live server from the new snapshot
      replaceDocFromSnapshot(liveYDoc, freshBase64);

      const sizeReduction = beforeSize - afterSize;
      const sizeReductionPercent = ((sizeReduction / beforeSize) * 100).toFixed(1);

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Hard reset completed successfully",
          beforeSize,
          afterSize,
          sizeReduction,
          sizeReductionPercent: `${sizeReductionPercent}%`,
        }),
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
          error: "Failed to perform hard reset",
          message: error instanceof Error ? error.message : String(error),
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  /**
   * Restore a room's document from a raw base64-encoded YJS document.
   * This allows restoring the exact database state including all history/tombstones.
   *
   * Request body:
   * {
   *   base64Document: string // The base64-encoded YJS document
   * }
   */
  private async handleAdminRestoreRawDocument(
    request: Party.Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      const body = (await request.json()) as { base64Document?: string };

      if (!body?.base64Document || typeof body.base64Document !== "string") {
        return new Response(
          JSON.stringify({
            error: "Missing or invalid 'base64Document' field",
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          }
        );
      }

      // Validate it's valid base64
      try {
        const buffer = new Uint8Array(
          Buffer.from(body.base64Document, "base64")
        );
        // Try to decode a Y.Doc to validate it's a valid YJS document
        const testDoc = new Y.Doc();
        Y.applyUpdate(testDoc, buffer);
      } catch (validationError) {
        return new Response(
          JSON.stringify({
            error: "Invalid base64 document or not a valid YJS document",
            message:
              validationError instanceof Error
                ? validationError.message
                : String(validationError),
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          }
        );
      }

      // Save to database
      const { error: saveError } = await supabase.from("documents").upsert(
        {
          name: this.context.room.id,
          document: body.base64Document,
        },
        { onConflict: "name" }
      );

      if (saveError) {
        throw new Error(
          `Failed to restore document: ${saveError.message}`
        );
      }

      // Reload the live server from the restored snapshot
      const liveYDoc = await unstable_getYDoc(
        this.context.room,
        this.context.providerOptions
      );
      replaceDocFromSnapshot(liveYDoc, body.base64Document);

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Raw document restored successfully",
          documentSize: body.base64Document.length,
        }),
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
          error: "Failed to restore raw document",
          message: error instanceof Error ? error.message : String(error),
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }
}
