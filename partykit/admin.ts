// ABOUTME: Provides authenticated room inspection and maintenance endpoints.
// ABOUTME: Coordinates database snapshots, client resets, and Supabase persistence safeguards.
import { Buffer } from "node:buffer";
import { env } from "cloudflare:workers";
import * as Y from "yjs";
import { supabase } from "./db";
import { PartyServer } from "./party";
import { docToJson } from "./docUtils";
import { removeRecordsByTargets, type RemoveTarget } from "./moderation";
import { getAdminAuthError } from "./adminAuth";

export { getAdminAuthError } from "./adminAuth";

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
 * - Moderation and cleanup mutate the authoritative live room state, commit a
 *   fresh snapshot, then reset connected clients onto that snapshot.
 * - Force-save-live is an escape hatch for persisting the live in-memory doc.
 * - Force-reload-live syncs the live doc to match the database state.
 * - All Y.Doc conversions use shared utilities in docUtils.ts for consistency.
 */
export class AdminHandler {
  constructor(private context: PartyServer) {}

  async handleRequest(request: Request): Promise<Response> {
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
        return await this.handleAdminInspect(request);
      }
      if (path.includes("admin/raw-data") && request.method === "GET") {
        return await this.handleAdminRawData(request);
      }
      if (
        path.includes("admin/remove-subscriber") &&
        request.method === "POST"
      ) {
        return await this.handleAdminRemoveSubscriber(request);
      }
      if (path.includes("admin/live-compare") && request.method === "GET") {
        return await this.handleAdminLiveCompare(request);
      }
      if (path.includes("admin/force-save-live") && request.method === "POST") {
        return await this.handleAdminForceSaveLive(request);
      }
      if (
        path.includes("admin/force-reload-live") &&
        request.method === "POST"
      ) {
        return await this.handleAdminForceReloadLive(request);
      }
      if (
        path.includes("admin/save-edited-data") &&
        request.method === "POST"
      ) {
        return await this.handleAdminSaveEditedData(request);
      }
      if (
        path.includes("admin/moderation-remove") &&
        request.method === "POST"
      ) {
        return await this.handleModerationRemove(request);
      }
      if (path.includes("admin/cleanup-orphans") && request.method === "POST") {
        return await this.handleAdminCleanupOrphans(request);
      }
      if (path.includes("admin/hard-reset") && request.method === "POST") {
        return await this.handleAdminHardReset(request);
      }
      if (
        path.includes("admin/restore-raw-document") &&
        request.method === "POST"
      ) {
        return await this.handleAdminRestoreRawDocument(request);
      }
      if (path.includes("admin/quarantine-status") && request.method === "GET") {
        return await this.handleAdminQuarantineStatus(request);
      }
      if (path.includes("admin/quarantine-set") && request.method === "POST") {
        return await this.handleAdminQuarantineSet(request);
      }
      if (
        path.includes("admin/quarantine-clear") &&
        request.method === "POST"
      ) {
        return await this.handleAdminQuarantineClear(request);
      }
      if (
        path.includes("admin/compaction-retry") &&
        request.method === "POST"
      ) {
        return await this.handleAdminCompactionRetry(request);
      }

      return new Response("Admin endpoint not found", { status: 404 });
    } catch (err) {
      console.error("Admin request error:", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  private checkAdminAuth(request: Request): Response | null {
    return getAdminAuthError(request, env.ADMIN_TOKEN);
  }

  private checkPersistenceWriteAvailable(): Response | null {
    return this.context.getSharedDataWriteUnavailableResponse();
  }

  private async handleAdminInspect(request: Request): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      const subscribers = await this.context.getSubscribers();
      const sharedReferences = await this.context.getSharedReferences();
      const sharedPermissions = await this.context.getSharedPermissions();
      const quarantine =
        await this.context.circuitBreaker.getQuarantineStatusBody();

      // Never rebuild the Y.Doc of a quarantined room: applying that update is
      // exactly what OOMs the isolate.
      if (this.context.circuitBreaker.isQuarantined()) {
        return new Response(
          JSON.stringify(
            {
              roomId: this.context.name,
              subscribers,
              sharedReferences,
              sharedPermissions,
              quarantine,
              ydoc: {
                error:
                  "Room is quarantined; the persisted document was not loaded because hydrating it crashes the room.",
              },
              connections: Array.from(this.context.getConnections()).length,
              timestamp: new Date().toISOString(),
              resetEpoch: await this.context.getResetEpoch(),
            },
            null,
            2
          ),
          {
            headers: {
              "content-type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "Access-Control-Allow-Methods": "GET",
              "Access-Control-Allow-Headers": "Content-Type",
            },
          }
        );
      }

      // Get Y.Doc data if available - use direct approach for consistency
      let ydocData = null;
      let documentSize = null;
      try {
        // Create fresh Y.Doc and load data directly (same as debug reconstruction)
        const yDoc = new Y.Doc();
        const { data: docData } = await supabase
          .from("documents")
          .select("name, document, created_at")
          .eq("name", this.context.name)
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
              roomId: this.context.name,
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
            clientCount: Array.from(this.context.getConnections()).length,
          },
        };
      } catch (error: unknown) {
        console.warn("Failed to extract Y.Doc data:", error);
        ydocData = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      // Get reset epoch
      const resetEpoch = await this.context.getResetEpoch();

      const roomData = {
        roomId: this.context.name,
        subscribers,
        sharedReferences,
        sharedPermissions,
        quarantine,
        ydoc: ydocData,
        connections: Array.from(this.context.getConnections()).length,
        timestamp: new Date().toISOString(),
        documentSize: documentSize || 0,
        resetEpoch: resetEpoch,
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

  private async handleAdminRawData(request: Request): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      // Get raw document from Supabase
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("name", this.context.name)
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
        roomId: this.context.name,
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

  private async handleAdminLiveCompare(request: Request): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      // Method 1: Direct Y.Doc approach (what admin console uses)
      const directYDoc = new Y.Doc();
      const { data: docData } = await supabase
        .from("documents")
        .select("document")
        .eq("name", this.context.name)
        .maybeSingle();

      let directData = null;
      if (docData?.document) {
        const buffer = new Uint8Array(Buffer.from(docData.document, "base64"));
        Y.applyUpdate(directYDoc, buffer);
        directData = docToJson(directYDoc);
      }

      // Method 2: Live server approach (using document from the running server)
      let liveData = null;
      let liveDebugInfo: any = {};
      try {
        const liveYDoc = this.context.document;

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
        roomId: this.context.name,
        timestamp: new Date().toISOString(),
        methods: {
          direct: {
            description:
              "Direct Y.Doc creation + database load (admin console method)",
            data: directData,
            hasData: directData && Object.keys(directData).length > 0,
          },
          live: {
            description: "Document from y-partykit (live server method)",
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
  private async handleAdminForceSaveLive(request: Request): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;
    const persistenceError = this.checkPersistenceWriteAvailable();
    if (persistenceError) return persistenceError;

    try {
      const saved = await this.context.saveLiveDocument();
      if (!saved) {
        return new Response(
          JSON.stringify({ error: "Live document was not saved" }),
          {
            status: 409,
            headers: { "content-type": "application/json" },
          }
        );
      }
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
    request: Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;
    // Reloading the persisted document into the live doc is the exact operation
    // that OOMs a quarantined room, and it is a tempting thing to reach for
    // while a room looks broken.
    const persistenceError = this.checkPersistenceWriteAvailable();
    if (persistenceError) return persistenceError;

    try {
      // Load snapshot from DB
      const { data, error } = await supabase
        .from("documents")
        .select("document")
        .eq("name", this.context.name)
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

      // Force DB -> live is an authoritative admin reset boundary.
      const result = await this.context.restoreFromSnapshot(data.document, {
        bumpEpoch: true,
      });
      this.context.markPersistenceAvailable();

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Live doc reloaded from database",
          documentSize: result.documentSize,
          resetEpoch: result.resetEpoch,
          closedConnections: result.closedConnections,
        }),
        {
          headers: { "content-type": "application/json" },
        }
      );
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
   * Save edited JSON data as the authoritative room snapshot.
   */
  private async handleAdminSaveEditedData(request: Request): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;
    const persistenceError = this.checkPersistenceWriteAvailable();
    if (persistenceError) return persistenceError;

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

      console.log(`[Admin] Saving edited data for room ${this.context.name}`);
      console.log(
        `[Admin] Edited data keys: ${Object.keys(editedData).length}`
      );

      const result = await this.context.commitAdminPlayData(editedData);

      console.log(
        `[Admin] Saved authoritative snapshot and reset ${result.closedConnections} clients`
      );

      return new Response(JSON.stringify({ ok: true, ...result }), {
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

  private async handleModerationRemove(request: Request): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;
    const persistenceError = this.checkPersistenceWriteAvailable();
    if (persistenceError) return persistenceError;

    try {
      const body = (await request.json()) as { targets?: RemoveTarget[] };
      const targets = body?.targets;
      if (!Array.isArray(targets) || targets.length === 0) {
        return new Response(
          JSON.stringify({ error: "Missing or empty targets array" }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      }

      const mutation = await this.context.mutateAdminPlayData<ReturnType<
        typeof removeRecordsByTargets
      > | null>((play) => {
        if (Object.keys(play).length === 0) {
          return { kind: "skip", result: null };
        }

        const result = removeRecordsByTargets(play, targets);
        if (result.removed === 0) {
          return { kind: "skip", result };
        }

        for (const key of Object.keys(play)) {
          delete play[key];
        }
        Object.assign(play, result.play);
        return { kind: "commit", result };
      });

      if (!mutation.result) {
        return new Response(
          JSON.stringify({ error: "Room has no play data" }),
          { status: 404, headers: { "content-type": "application/json" } }
        );
      }

      const result = mutation.result;
      const resetResult = mutation.committed;

      return new Response(
        JSON.stringify({
          removed: result.removed,
          skipped: result.skipped,
          documentSize: resetResult?.documentSize ?? null,
          resetEpoch: resetResult?.resetEpoch ?? null,
          closedConnections: resetResult?.closedConnections ?? 0,
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
          error: "Failed to remove moderated records",
          message: error instanceof Error ? error.message : String(error),
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  private async handleAdminRemoveSubscriber(
    request: Request
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
  private async handleAdminCleanupOrphans(request: Request): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;
    const persistenceError = this.checkPersistenceWriteAvailable();
    if (persistenceError) return persistenceError;

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

      type CleanupResult =
        | { kind: "missing" }
        | {
            kind: "found";
            total: number;
            orphanedIds: string[];
            removed: number;
          };

      const activeIdSet = new Set(activeIds);
      const mutation = await this.context.mutateAdminPlayData<CleanupResult>(
        (play) => {
          const tagData = play[tag];
          if (!tagData || typeof tagData !== "object") {
            return { kind: "skip", result: { kind: "missing" } };
          }

          const allElementIds = Object.keys(tagData);
          const orphanedIds = allElementIds.filter(
            (id) => !activeIdSet.has(id)
          );
          const result: CleanupResult = {
            kind: "found",
            total: allElementIds.length,
            orphanedIds,
            removed: 0,
          };

          if (dryRun || orphanedIds.length === 0) {
            return { kind: "skip", result };
          }

          for (const orphanedId of orphanedIds) {
            try {
              delete tagData[orphanedId];
              result.removed += 1;
            } catch (error) {
              console.error(
                `Failed to remove ${tag}:${orphanedId}:`,
                error instanceof Error ? error.message : String(error)
              );
            }
          }

          return result.removed > 0
            ? { kind: "commit", result }
            : { kind: "skip", result };
        }
      );

      if (mutation.result.kind === "missing") {
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

      const { total, orphanedIds, removed } = mutation.result;

      if (dryRun) {
        return new Response(
          JSON.stringify({
            ok: true,
            tag,
            total,
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

      const resetResult = mutation.committed;

      return new Response(
        JSON.stringify({
          ok: true,
          tag,
          total,
          active: activeIds.length,
          removed,
          orphanedIds,
          message: `Removed ${removed} orphaned entries`,
          documentSize: resetResult?.documentSize ?? null,
          resetEpoch: resetResult?.resetEpoch ?? null,
          closedConnections: resetResult?.closedConnections ?? 0,
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
  private async handleAdminHardReset(request: Request): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;
    const persistenceError = this.checkPersistenceWriteAvailable();
    if (persistenceError) return persistenceError;

    const roomId = this.context.name;
    console.log(`[Hard Reset] Starting for room: ${roomId}`);

    try {
      // Use the centralized performHardReset method
      const result = await this.context.performHardReset();

      const sizeReduction = result.beforeSize - result.afterSize;
      const sizeReductionPercent = (
        (sizeReduction / result.beforeSize) *
        100
      ).toFixed(1);

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Hard reset completed successfully",
          beforeSize: result.beforeSize,
          afterSize: result.afterSize,
          sizeReduction,
          sizeReductionPercent: `${sizeReductionPercent}%`,
          resetEpoch: result.resetEpoch,
          closedConnections: result.closedConnections,
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error(
        `[Hard Reset] Failed for room ${roomId}:`,
        errorMessage,
        errorStack || error
      );

      return new Response(
        JSON.stringify({
          error: "Failed to perform hard reset",
          message: errorMessage,
          roomId,
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
    request: Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;
    // Quarantine also runs the room in transient mode, but this endpoint is how
    // an oversized document gets replaced with a repaired one, so it stays open
    // for a quarantined room. A genuine Supabase outage still blocks it.
    if (!this.context.circuitBreaker.isQuarantined()) {
      const persistenceError = this.checkPersistenceWriteAvailable();
      if (persistenceError) return persistenceError;
    }

    const roomId = this.context.name;
    console.log(`[Restore Raw] Starting for room: ${roomId}`);

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

      // Validate it's valid base64 and a valid YJS document
      try {
        const buffer = new Uint8Array(
          Buffer.from(body.base64Document, "base64")
        );
        // Try to decode a Y.Doc to validate it's a valid YJS document
        const testDoc = new Y.Doc();
        try {
          Y.applyUpdate(testDoc, buffer);
        } finally {
          testDoc.destroy();
        }
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

      // Use the centralized restoreFromSnapshot method (bump epoch).
      // The document here is operator-supplied and already validated above, so
      // this is the sanctioned way to replace a quarantined room's document.
      const result = await this.context.restoreFromSnapshot(
        body.base64Document,
        { bumpEpoch: true, allowQuarantined: true }
      );

      let quarantineCleared = false;
      let compactionFailureCleared = false;
      let cleanupError: string | null = null;

      // The restore itself already succeeded and is durable. A failure in this
      // cleanup must not turn into a 500, or an operator would re-run a restore
      // that actually worked.
      try {
        await this.context.circuitBreaker.clearCompactionFailure();
        compactionFailureCleared = true;
        if (this.context.circuitBreaker.isQuarantined()) {
          await this.context.circuitBreaker.clearQuarantine({
            recoveryCompleted: true,
          });
          quarantineCleared = true;
          this.context.markDocumentHydrated();
        }
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : String(error);
        console.error(
          `[Restore Raw] Post-restore cleanup failed for room ${roomId}:`,
          error
        );
      }

      return new Response(
        JSON.stringify({
          ok: true,
          message: "Raw document restored successfully",
          documentSize: result.documentSize,
          resetEpoch: result.resetEpoch,
          closedConnections: result.closedConnections,
          quarantineCleared,
          compactionFailureCleared,
          cleanupError,
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
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error(
        `[Restore Raw] Failed for room ${roomId}:`,
        errorMessage,
        errorStack || error
      );

      return new Response(
        JSON.stringify({
          error: "Failed to restore raw document",
          message: errorMessage,
          roomId,
        }),
        { status: 500, headers: { "content-type": "application/json" } }
      );
    }
  }

  // The room safety handlers carry their own try/catch so failures include
  // structured details and CORS headers instead of a bare platform 500.
  private controlErrorResponse(operation: string, error: unknown): Response {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[Admin] ${operation} failed for room ${this.context.name}:`,
      error
    );
    return new Response(
      JSON.stringify({
        error: `Failed to ${operation}`,
        message,
        roomId: this.context.name,
      }),
      {
        status: 500,
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }

  private async handleAdminQuarantineStatus(
    request: Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      const body = await this.context.circuitBreaker.getQuarantineStatusBody();

      return new Response(JSON.stringify(body, null, 2), {
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    } catch (error) {
      return this.controlErrorResponse("read quarantine status", error);
    }
  }

  // Quarantine is primarily an operator decision: it takes a room out of
  // persistence entirely, so nothing automatic reaches for it except as a last
  // resort after the retry backoff is exhausted.
  private async handleAdminQuarantineSet(request: Request): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    let body: { reason?: string } | null = null;
    const rawBody = await request.text();
    if (rawBody.trim()) {
      try {
        body = JSON.parse(rawBody) as { reason?: string };
      } catch {
        // Silently recording "no reason given" would lose the operator's note.
        return new Response(
          JSON.stringify({
            error: "Invalid JSON body",
            message:
              "Send {\"reason\": \"...\"} or an empty body to quarantine without a note.",
          }),
          {
            status: 400,
            headers: {
              "content-type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          }
        );
      }
    }

    try {
      const hasControlPlane =
        this.context.circuitBreaker.hasQuarantineControlPlane();
      await this.context.circuitBreaker.enterQuarantine({
        reason: "manual",
        detail: body?.reason?.trim() || "no reason given",
        failureKind: null,
        failureCount: 0,
      });

      const externalFlag =
        await this.context.circuitBreaker.readExternalQuarantineFlag();
      const status =
        await this.context.circuitBreaker.getQuarantineStatusBody();

      return new Response(
        JSON.stringify(
          {
            ...status,
            // Without the binding the room is quarantined locally only, which
            // will NOT survive a restart of a room that crashes on start.
            externalFlagWritten: externalFlag.available
              ? externalFlag.value !== null
              : false,
            warning: hasControlPlane
              ? undefined
              : "No quarantine control plane is configured, so this quarantine is local only and will not survive a restart.",
          },
          null,
          2
        ),
        {
          headers: {
            "content-type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        }
      );
    } catch (error) {
      return this.controlErrorResponse("set quarantine", error);
    }
  }

  // Clearing quarantine removes the flag and failure history, then leaves normal
  // traffic gated until a guarded load restores the persisted document.
  private async handleAdminQuarantineClear(
    request: Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      const previous = this.context.circuitBreaker.getQuarantineState();
      const reset = await this.context.circuitBreaker.clearQuarantine();

      // Even when nothing was quarantined this may have reset a failure ledger,
      // so the response reports what actually changed.
      const resetSomething =
        reset.wasQuarantined ||
        reset.loadFailures > 0 ||
        reset.alarmFailures > 0 ||
        reset.wasLoadDeferred;

      return new Response(
        JSON.stringify(
          {
            roomId: this.context.name,
            cleared: reset.wasQuarantined,
            previousReason: previous?.reason ?? null,
            previousDetail: previous?.detail ?? null,
            reset: {
              loadFailures: reset.loadFailures,
              alarmFailures: reset.alarmFailures,
              loadDeferral: reset.wasLoadDeferred,
            },
            stillTransient: !this.context.isPersistenceAvailable(),
            message: reset.wasQuarantined
              ? "Quarantine cleared. Normal traffic stays gated until a guarded load restores the persisted document, then its load failure history is cleared."
              : resetSomething
                ? "Room was not quarantined, but guarded recovery is pending. Normal traffic stays gated until the persisted document is restored."
                : "Room was not quarantined and had no failure history; nothing changed.",
          },
          null,
          2
        ),
        {
          headers: {
            "content-type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        }
      );
    } catch (error) {
      return this.controlErrorResponse("clear quarantine", error);
    }
  }

  private async handleAdminCompactionRetry(
    request: Request
  ): Promise<Response> {
    const authError = this.checkAdminAuth(request);
    if (authError) return authError;

    try {
      const reset = await this.context.retryAutomaticCompaction();
      const status =
        await this.context.circuitBreaker.getQuarantineStatusBody();

      return new Response(
        JSON.stringify(
          {
            ...status,
            reset: {
              failures: reset.failures,
              retryAfter: reset.retryAfter,
              disabledAt: reset.disabledAt,
            },
            message:
              "Automatic compaction failure state cleared and compaction retried.",
          },
          null,
          2
        ),
        {
          headers: {
            "content-type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization",
          },
        }
      );
    } catch (error) {
      return this.controlErrorResponse("retry automatic compaction", error);
    }
  }
}
