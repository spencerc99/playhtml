import type * as Party from "partykit/server";
import { onConnect, unstable_getYDoc, YPartyKitOptions } from "y-partykit";
import { syncedStore, getYjsValue } from "@syncedstore/core";
import { deepReplaceIntoProxy } from "@playhtml/common";
import { Buffer } from "node:buffer";
import * as Y from "yjs";
import { supabase } from "./db";
import { AdminHandler } from "./admin";
import {
  docToJson,
  jsonToDoc,
  encodeDocToBase64,
  replaceDocFromSnapshot,
  setDocResetEpoch,
  getDocResetEpoch,
} from "./docUtils";
import {
  STORAGE_KEYS,
  DEFAULT_PRUNE_INTERVAL_MS,
  DEFAULT_SUBSCRIBER_LEASE_MS,
  ORIGIN_S2C,
  ORIGIN_C2S,
  Subscriber,
  SharedRefEntry,
  ensureExists,
} from "./const";
import {
  SubscribeRequest,
  ApplySubtreesImmediateRequest,
  SubscribeResponse,
  ExportPermissionsResponse,
  ApplySubtreesResponse,
  isSubscribeRequest,
  isExportPermissionsRequest,
  isApplySubtreesImmediateRequest,
} from "./request";
import {
  getSourceRoomId,
  parseSharedElementsFromUrl,
  parseSharedReferencesFromUrl,
  SharedElementPermissions,
} from "./sharing";

export default class PartyServer implements Party.Server {
  constructor(public room: Party.Room) {}

  // Public flag to pause autosave during administrative resets
  // This prevents the server from overwriting the clean DB state with
  // in-memory state while we are performing a reset.
  public isSkippingSave = false;

  // Reuse the exact same options for all Y.Doc access
  readonly providerOptions: YPartyKitOptions = {
    load: async () => {
      // This is called once per "room" when the first user connects

      // Let's make a Yjs document
      const doc = new Y.Doc();

      // Load the document from the database
      const { data, error } = await supabase
        .from("documents")
        .select("document")
        .eq("name", this.room.id)
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

      // Return the Yjs document
      return doc;
    },
    callback: {
      handler: async (doc: Y.Doc) => {
        // Skip autosave if we are performing a reset operation
        if (this.isSkippingSave) {
          console.log(
            "[PartyServer] Skipping autosave due to active reset operation"
          );
          return;
        }

        // This is called every few seconds if the document has changed

        // convert the Yjs document to a Uint8Array
        const content = Y.encodeStateAsUpdate(doc);
        const base64Document = Buffer.from(content).toString("base64");
        const documentSize = base64Document.length;

        // Get current reset epoch for logging and validation
        const serverResetEpoch = await this.getResetEpoch();
        const docResetEpoch = getDocResetEpoch(doc);

        if (this.isEpochStale(docResetEpoch, serverResetEpoch)) {
          const reason =
            docResetEpoch === null
              ? `doc reset epoch missing while server epoch=${serverResetEpoch}`
              : `doc reset epoch ${docResetEpoch} < server epoch ${serverResetEpoch}`;
          console.warn(
            `[PartyServer] Autosave skipped for room ${this.room.id}: ${reason}`
          );
          return;
        }

        if (
          docResetEpoch !== null &&
          serverResetEpoch !== null &&
          docResetEpoch > serverResetEpoch
        ) {
          console.warn(
            `[PartyServer] Autosave skipped for room ${this.room.id}: doc reset epoch (${docResetEpoch}) is ahead of server epoch (${serverResetEpoch})`
          );
          return;
        }

        // Log structured information about the save
        console.log(
          `[PartyServer] Autosave: room=${
            this.room.id
          }, size=${documentSize} bytes (${(documentSize / 1024 / 1024).toFixed(
            2
          )} MB), resetEpoch=${docResetEpoch ?? serverResetEpoch ?? "none"}`
        );

        // Save the document to the database
        const { data: _data, error } = await supabase.from("documents").upsert(
          {
            name: this.room.id,
            document: base64Document,
          },
          { onConflict: "name" }
        );

        if (error) {
          console.error(
            `[PartyServer] Autosave failed for room ${this.room.id}:`,
            error
          );
        } else {
          console.log(
            `[PartyServer] Autosave succeeded for room ${this.room.id}`
          );
        }
      },
    },
  };
  private observersAttached = false;
  private adminHandler = new AdminHandler(this);

  async getSubscribers(): Promise<Subscriber[]> {
    return (await this.room.storage.get(STORAGE_KEYS.subscribers)) || [];
  }

  async setSubscribers(subscribers: Subscriber[]): Promise<void> {
    await this.room.storage.put(STORAGE_KEYS.subscribers, subscribers);
  }

  async getSharedReferences(): Promise<SharedRefEntry[]> {
    return (await this.room.storage.get(STORAGE_KEYS.sharedReferences)) || [];
  }

  async setSharedReferences(references: SharedRefEntry[]): Promise<void> {
    await this.room.storage.put(STORAGE_KEYS.sharedReferences, references);
  }

  async getSharedPermissions(): Promise<
    Record<string, SharedElementPermissions>
  > {
    return (await this.room.storage.get(STORAGE_KEYS.sharedPermissions)) || {};
  }

  async setSharedPermissions(
    permissions: Record<string, SharedElementPermissions>
  ): Promise<void> {
    await this.room.storage.put(STORAGE_KEYS.sharedPermissions, permissions);
  }

  async getResetEpoch(): Promise<number | null> {
    return (await this.room.storage.get(STORAGE_KEYS.resetEpoch)) || null;
  }

  async setResetEpoch(epoch: number): Promise<void> {
    await this.room.storage.put(STORAGE_KEYS.resetEpoch, epoch);
  }

  /**
   * Determine whether a candidate epoch (from a doc, client, or bridge message)
   * is stale relative to the authoritative epoch stored in room storage.
   *
   * When we perform a hard reset or raw restore, we bump the room's
   * `resetEpoch`. Every autosave and bridge request checks that the data it is
   * about to persist is tagged with the same epoch so that stale PartyKit
   * instances (which might still hold the pre-reset Y.Doc in memory) cannot
   * overwrite the clean snapshot. Without this guard, autosave from a hibernated
   * worker could reintroduce the old, bloated state even if no clients are
   * connected.
   */
  private isEpochStale(
    candidateEpoch: number | null,
    serverEpoch: number | null
  ): boolean {
    return (
      serverEpoch !== null &&
      (candidateEpoch === null || candidateEpoch < serverEpoch)
    );
  }

  /**
   * Restore the room's Y.Doc from a base64 snapshot.
   * This is used for restore-raw-document and force-reload-live operations.
   *
   * Steps:
   * 1. Lock autosave
   * 2. Save snapshot to database
   * 3. Replace live doc with snapshot
   * 4. Set resetEpoch
   * 5. Broadcast room-reset signal
   * 6. Close all connections
   * 7. Flush microtasks and release lock
   *
   * @param snapshotBase64 Base64-encoded Y.Doc snapshot
   * @returns Object with documentSize and resetEpoch
   */
  async restoreFromSnapshot(
    snapshotBase64: string,
    options?: { bumpEpoch?: boolean }
  ): Promise<{
    documentSize: number;
    resetEpoch: number;
  }> {
    const roomId = this.room.id;
    console.log(`[Restore Snapshot] Starting for room: ${roomId}`);

    // Lock autosave immediately
    this.isSkippingSave = true;

    try {
      // Decode snapshot to Y.Doc so we can ensure metadata is present
      const snapshotDoc = new Y.Doc();
      Y.applyUpdate(
        snapshotDoc,
        new Uint8Array(Buffer.from(snapshotBase64, "base64"))
      );

      const storedEpoch = await this.getResetEpoch();
      let resetEpoch = getDocResetEpoch(snapshotDoc);
      if (options?.bumpEpoch) {
        resetEpoch = Date.now();
      } else if (resetEpoch === null) {
        resetEpoch = storedEpoch ?? Date.now();
      }
      setDocResetEpoch(snapshotDoc, resetEpoch);

      const updatedBase64 = encodeDocToBase64(snapshotDoc);
      const documentSize = updatedBase64.length;

      // Save to database
      console.log(`[Restore Snapshot] Saving snapshot to database...`);
      const { error: saveError } = await supabase.from("documents").upsert(
        {
          name: this.room.id,
          document: updatedBase64,
        },
        { onConflict: "name" }
      );

      if (saveError) {
        console.error(
          `[Restore Snapshot] Database save failed:`,
          saveError.message,
          saveError
        );
        throw new Error(`Failed to save snapshot: ${saveError.message}`);
      }
      console.log(`[Restore Snapshot] Successfully saved snapshot to database`);

      // Reload the live server from the snapshot
      console.log(`[Restore Snapshot] Reloading live server from snapshot...`);
      const liveYDoc = await unstable_getYDoc(this.room, this.providerOptions);
      replaceDocFromSnapshot(liveYDoc, updatedBase64);
      setDocResetEpoch(liveYDoc, resetEpoch);
      console.log(`[Restore Snapshot] Successfully reloaded live server`);

      // Set reset epoch for client detection
      await this.setResetEpoch(resetEpoch);
      console.log(`[Restore Snapshot] Set resetEpoch: ${resetEpoch}`);

      // Broadcast a "room-reset" message to all connected clients
      this.room.broadcast(
        JSON.stringify({
          type: "room-reset",
          timestamp: resetEpoch,
          resetEpoch: resetEpoch,
        })
      );
      console.log(
        `[Restore Snapshot] Broadcasted room-reset signal to all clients`
      );

      // FORCE DISCONNECT: Close all connections
      const connections = [...this.room.getConnections()];
      connections.forEach((conn) => {
        try {
          conn.close(4000, "Room Restored by Admin");
        } catch (e) {
          console.error("[Restore Snapshot] Failed to close connection:", e);
        }
      });
      console.log(
        `[Restore Snapshot] Closed ${connections.length} connections`
      );

      console.log(
        `[Restore Snapshot] Completed successfully: ${documentSize} bytes`
      );

      // Flush pending microtasks
      await Promise.resolve();

      return {
        documentSize,
        resetEpoch,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error(
        `[Restore Snapshot] Failed for room ${roomId}:`,
        errorMessage,
        errorStack || error
      );

      throw error;
    } finally {
      // Re-enable autosave after a short delay
      setTimeout(() => {
        this.isSkippingSave = false;
        console.log("[Restore Snapshot] Autosave re-enabled");
      }, 1000);
    }
  }

  // Ensure an alarm is set if subscribers exist; avoids rescheduling if one is set sooner
  private async ensureAlarmIfSubscribersPresent(): Promise<void> {
    const subs = await this.getSubscribers();
    const refs = await this.getSharedReferences();
    if (!subs.length && !refs.length) return;
    const nextAlarm = Date.now() + DEFAULT_PRUNE_INTERVAL_MS;
    const previousAlarm = await this.room.storage.getAlarm?.();
    if (
      previousAlarm === null ||
      previousAlarm === undefined ||
      nextAlarm < previousAlarm
    ) {
      await this.room.storage.setAlarm?.(nextAlarm);
    }
  }

  // --- Helper: group SharedReferences into storage entries
  private groupRefsToEntries(
    refs: Array<{ domain: string; path: string; elementId: string }>
  ): Array<{ sourceRoomId: string; elementIds: string[] }> {
    const bySource = new Map<string, Set<string>>();
    for (const ref of refs) {
      const srcId = getSourceRoomId(ref.domain, ref.path);
      const set = bySource.get(srcId) ?? new Set<string>();
      set.add(ref.elementId);
      bySource.set(srcId, set);
    }
    return Array.from(bySource.entries()).map(([sourceRoomId, ids]) => ({
      sourceRoomId,
      elementIds: Array.from(ids),
    }));
  }

  // --- Helper: merge and persist sharedReferences entries; returns updated entries and whether changed
  private async mergeAndStoreSharedRefs(
    newEntries: Array<{ sourceRoomId: string; elementIds: string[] }>
  ): Promise<{
    entries: Array<{ sourceRoomId: string; elementIds: string[] }>;
    changed: boolean;
  }> {
    const existing = await this.getSharedReferences();
    const bySource = new Map<string, Set<string>>();
    for (const e of existing)
      bySource.set(e.sourceRoomId, new Set(e.elementIds));
    let changed = false;
    for (const e of newEntries) {
      const set = bySource.get(e.sourceRoomId) ?? new Set<string>();
      const before = set.size;
      for (const id of e.elementIds) set.add(id);
      if (!bySource.has(e.sourceRoomId) || set.size !== before) changed = true;
      bySource.set(e.sourceRoomId, set);
    }
    if (changed) {
      const nowIso = new Date().toISOString();
      const merged: Array<SharedRefEntry> = Array.from(bySource.entries()).map(
        ([sourceRoomId, ids]) => {
          return {
            sourceRoomId,
            elementIds: Array.from(ids),
            lastSeen: nowIso,
          };
        }
      );
      await this.setSharedReferences(merged);
      return { entries: merged, changed: true };
    }
    return { entries: existing, changed: false };
  }

  // --- Helper: subscribe to sources and optionally hydrate immediately
  private async subscribeAndHydrate(
    entries: Array<{ sourceRoomId: string; elementIds: string[] }>
  ): Promise<void> {
    const mainParty = this.room.context.parties.main;
    // Subscribe and cache allowedIds per source in sharedReferences
    await Promise.all(
      entries.map(async ({ sourceRoomId, elementIds }) => {
        if (!elementIds?.length) return;
        try {
          const sourceRoom = mainParty.get(sourceRoomId);
          const subscribeRequest: SubscribeRequest = {
            action: "subscribe",
            consumerRoomId: this.room.id,
            elementIds,
          };
          await sourceRoom.fetch({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(subscribeRequest),
          });
        } catch {}
      })
    );
  }

  // --- Helper: extract subtrees for a set of elementIds from the play map
  extractPlaySubtrees(
    doc: Y.Doc,
    elementIds: Set<string>
  ): Record<string, Record<string, any>> {
    const result: Record<string, Record<string, any>> = {};
    // Bind SyncedStore to this doc to operate on the same structure clients use
    const store = syncedStore<{ play: Record<string, any> }>({ play: {} }, doc);
    const playY = getYjsValue(store.play) as unknown as Y.Map<any>;
    if (!playY) return result;
    playY.forEach((tagMap: any, tag: string) => {
      if (!(tagMap instanceof Y.Map)) return;
      const outForTag: Record<string, any> = {};
      tagMap.forEach((val: any, elementId: string) => {
        if (!elementIds.has(elementId)) return;
        // Prefer toJSON to get plain values
        const plain = typeof val?.toJSON === "function" ? val.toJSON() : val;
        outForTag[elementId] = plain;
      });
      if (Object.keys(outForTag).length) {
        result[tag] = outForTag;
      }
    });
    return result;
  }

  // --- Helper: assign subtrees into doc.play[tag][elementId] (replace semantics)
  assignPlaySubtrees(
    doc: Y.Doc,
    subtrees: Record<string, Record<string, any>>
  ): void {
    const store = syncedStore<{ play: Record<string, any> }>({ play: {} }, doc);
    Object.entries(subtrees).forEach(([tag, elements]) => {
      // Ensure tag map exists
      // @ts-ignore
      store.play[tag] ??= {};
      Object.entries(elements).forEach(([elementId, data]) => {
        const tagObj = store.play[tag];
        const exists = Object.prototype.hasOwnProperty.call(tagObj, elementId);
        if (!exists) {
          // First time create to establish types
          tagObj[elementId] = data;
          return;
        }
        // In-place mutate existing proxy so observers remain attached
        const proxy = tagObj[elementId];
        // Equality guard to reduce redundant writes
        try {
          const yExisting = getYjsValue(proxy);
          const existingPlain =
            yExisting && typeof yExisting.toJSON === "function"
              ? yExisting.toJSON()
              : proxy;
          const same =
            JSON.stringify(existingPlain ?? null) ===
            JSON.stringify(data ?? null);
          if (same) return;
        } catch {}
        if (proxy && typeof proxy === "object") {
          deepReplaceIntoProxy(proxy, data);
        } else {
          tagObj[elementId] = data;
        }
      });
    });
  }

  async onMessage(
    message: string | ArrayBuffer | ArrayBufferView,
    sender: Party.Connection<unknown>
  ): Promise<void> {
    if (typeof message === "string") {
      try {
        const parsed = JSON.parse(message);

        if (parsed.type === "add-shared-reference") {
          // Handle dynamic addition of shared reference
          // TODO: this MIGHT still has some data inconsistencies when a source renders a dynamic element and changes it and then when we add the shared reference, it doesn't get the updated data
          await this.handleAddSharedReference(parsed.reference, sender);
        } else if (parsed.type === "export-permissions") {
          // Handle individual permission requests
          await this.handleExportPermissions(parsed.elementIds, sender);
        } else if (parsed.type === "register-shared-element") {
          // Handle dynamic registration of shared source element
          // TODO: this still has some data inconsistencies when a consumer renders a dynamic element and changes it and then when we register the shared element, it doesn't get the updated data
          await this.handleRegisterSharedElement(parsed.element, sender);
        } else {
          // Broadcast other messages normally
          this.room.broadcast(message);
        }
      } catch (error) {
        // If not valid JSON, broadcast as-is (existing behavior)
        this.room.broadcast(message);
      }
    }
  }

  private async handleAddSharedReference(
    reference: {
      domain: string;
      path: string;
      elementId: string;
    },
    sender: Party.Connection<unknown>
  ): Promise<void> {
    if (!reference?.domain || !reference?.path || !reference?.elementId) return;

    const sourceRoomId = getSourceRoomId(reference.domain, reference.path);
    const { entries, changed } = await this.mergeAndStoreSharedRefs([
      { sourceRoomId, elementIds: [reference.elementId] },
    ]);
    if (changed) await this.subscribeAndHydrate(entries);
  }

  private async handleExportPermissions(
    elementIds: string[],
    sender: Party.Connection<unknown>
  ): Promise<void> {
    const perms = await this.getSharedPermissions();
    const filtered: Record<string, SharedElementPermissions> = {};

    for (const id of elementIds) {
      if (perms[id]) filtered[id] = perms[id];
    }

    // Send permissions back to the requesting client
    sender.send(JSON.stringify({ permissions: filtered }));
  }

  private async handleRegisterSharedElement(
    element: {
      elementId: string;
      permissions: SharedElementPermissions;
      path?: string;
    },
    sender: Party.Connection<unknown>
  ): Promise<void> {
    if (!element || !element.elementId) return;

    // Update shared permissions for this source room
    const existingPerms = await this.getSharedPermissions();
    const mode =
      element.permissions && element.permissions === "read-only"
        ? "read-only"
        : "read-write";
    existingPerms[element.elementId] = mode;
    await this.setSharedPermissions(existingPerms);

    // If new shared element just registered, proactively fanout to subscribers who requested it
    try {
      const yDoc = await unstable_getYDoc(this.room, this.providerOptions);
      const play = yDoc.getMap("play") as Y.Map<any>;
      // Find the tag containing this elementId
      let subtreesForNew: Record<string, Record<string, any>> | null = null;
      play.forEach((tagMap: any, tag: string) => {
        if (!(tagMap instanceof Y.Map)) return;
        if (tagMap.has(element.elementId)) {
          const val = tagMap.get(element.elementId);
          const plain = typeof val?.toJSON === "function" ? val.toJSON() : val;
          subtreesForNew = { [tag]: { [element.elementId]: plain } };
        }
      });
      if (subtreesForNew === null) return;

      const subscribers = await this.getSubscribers();
      if (!subscribers.length) return;
      const mainParty = this.room.context.parties.main;
      const currentEpoch = await this.getResetEpoch();
      await Promise.all(
        subscribers.map(async ({ consumerRoomId, elementIds }) => {
          if (!elementIds || !elementIds.includes(element.elementId)) return;
          const consumerRoom = mainParty.get(consumerRoomId);
          try {
            const applyRequest: ApplySubtreesImmediateRequest = {
              action: "apply-subtrees-immediate",
              subtrees: ensureExists(subtreesForNew),
              sender: this.room.id,
              originKind: "source",
              resetEpoch: currentEpoch ?? null,
            };
            await consumerRoom.fetch({
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(applyRequest),
            });
          } catch {}
        })
      );
    } catch {}
  }

  async onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
    // Check reset epoch from client params and enforce if stale
    let shouldForceReset = false;
    let serverResetEpoch: number | null = null;
    try {
      const url = new URL(ctx.request.url);
      const clientResetEpochParam = url.searchParams.get("clientResetEpoch");
      const clientResetEpoch =
        clientResetEpochParam !== null
          ? parseInt(clientResetEpochParam, 10)
          : null;

      serverResetEpoch = await this.getResetEpoch();

      // If server has a reset epoch and client's is stale (or missing), mark for reset
      if (this.isEpochStale(clientResetEpoch, serverResetEpoch)) {
        console.log(
          `[PartyServer] Client reset epoch (${clientResetEpoch}) is stale compared to server (${serverResetEpoch}). Will force reload.`
        );
        shouldForceReset = true;
      } else if (clientResetEpoch !== null && serverResetEpoch !== null) {
        console.log(
          `[PartyServer] Client reset epoch (${clientResetEpoch}) matches server (${serverResetEpoch}). Connection allowed.`
        );
      }
    } catch (error) {
      // If epoch check fails, log but don't block connection (fail open for backwards compatibility)
      console.warn(
        `[PartyServer] Failed to check reset epoch on connect:`,
        error
      );
    }

    // Opportunistically schedule an alarm if subscribers exist
    await this.ensureAlarmIfSubscribersPresent();

    // Parse shared references from the connecting client (for consumer rooms)
    // Parse from the WebSocket request URL
    const sharedReferences = parseSharedReferencesFromUrl(ctx.request.url);

    // Persist consumer interest mapping for later pulls/mirroring
    if (sharedReferences.length) {
      const entries = this.groupRefsToEntries(sharedReferences);
      const { entries: merged } = await this.mergeAndStoreSharedRefs(entries);
      await this.subscribeAndHydrate(merged);
    }

    // Persist source-declared permissions for simple global read-only
    const sharedElements = parseSharedElementsFromUrl(ctx.request.url);
    if (sharedElements.length) {
      const permissionsByElementId: Record<string, SharedElementPermissions> =
        {};
      for (const el of sharedElements) {
        const mode =
          el.permissions && el.permissions.includes("read-only")
            ? "read-only"
            : "read-write";
        permissionsByElementId[el.elementId] = mode;
      }
      // TODO: instead of overriding, maybe we should merge and also do pruning of permissions that aren't present anymore to handle dynamic elements?
      // OR we should stop with all this pruning and instead enforce that these are declared globally in the client even for dynamically rendered elements (they have to be registered in init?)
      await this.setSharedPermissions(permissionsByElementId);
    }

    await onConnect(connection, this.room, this.providerOptions);

    // If reset is needed, send the message after connection is established
    if (shouldForceReset && serverResetEpoch !== null) {
      // Send room-reset message - client will reload when it receives this
      connection.send(
        JSON.stringify({
          type: "room-reset",
          timestamp: serverResetEpoch,
          resetEpoch: serverResetEpoch,
        })
      );
      console.log(
        `[PartyServer] Sent room-reset message to client with stale epoch`
      );
    }

    // Attach immediate-update observers once
    await this.attachImmediateBridgeObservers();
  }

  async onRequest(request: Party.Request): Promise<Response> {
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

      const url = new URL(request.url);

      // Route admin requests to admin handler
      // PartyKit paths are like /parties/main/room-id/admin/inspect
      if (url.pathname.includes("/admin")) {
        return this.adminHandler.handleRequest(request);
      }

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const body: unknown = await request.json();

      if (isSubscribeRequest(body)) {
        // Called on SOURCE room; registers a consumer room id
        const { consumerRoomId, elementIds: elementIdsRaw } = body;
        const elementIds = Array.isArray(elementIdsRaw)
          ? Array.from(
              new Set(elementIdsRaw.filter((x) => typeof x === "string"))
            )
          : undefined;
        // IMPORTANT: Do NOT filter out unknown/not-yet-shared ids at subscribe time.
        // Keep the requested ids so that when the source registers those elements later,
        // existing subscribers will start receiving data automatically.
        const requestedIds = elementIds || [];
        const existing = await this.getSubscribers();
        const nowIso = new Date().toISOString();
        const leaseMs = DEFAULT_SUBSCRIBER_LEASE_MS;
        const found = existing.find((s) => s.consumerRoomId === consumerRoomId);
        if (!found) {
          existing.push({
            consumerRoomId,
            elementIds: requestedIds,
            createdAt: nowIso,
            lastSeen: nowIso,
            leaseMs,
          });
        } else {
          // Update elementIds (filtered) and lastSeen
          found.elementIds = requestedIds;
          found.lastSeen = nowIso;
        }
        await this.setSubscribers(existing);
        const response: SubscribeResponse = {
          ok: true,
          subscribed: true,
          elementIds: requestedIds,
        };
        return new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        });
      }

      if (isExportPermissionsRequest(body)) {
        // Returns simple permissions (read-only/read-write) for requested elementIds
        const { elementIds } = body;
        const perms = await this.getSharedPermissions();
        const filtered: Record<string, SharedElementPermissions> = {};
        for (const id of elementIds) {
          if (perms[id]) filtered[id] = perms[id];
        }
        const response: ExportPermissionsResponse = { permissions: filtered };
        return new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        });
      }

      if (isApplySubtreesImmediateRequest(body)) {
        // Applies provided subtrees immediately and marks origin to suppress echo
        const { subtrees, sender, originKind } = body;

        const yDoc = await unstable_getYDoc(this.room, this.providerOptions);
        const subscribers = await this.getSubscribers();
        const sharedRefs = await this.getSharedReferences();
        const senderResetEpoch =
          typeof body.resetEpoch === "number" ? body.resetEpoch : null;
        const serverResetEpoch = await this.getResetEpoch();

        if (this.isEpochStale(senderResetEpoch, serverResetEpoch)) {
          console.warn(
            `[Bridge] Ignoring apply-subtrees from ${sender} (${originKind}) due to stale reset epoch (sender=${senderResetEpoch}, server=${serverResetEpoch})`
          );
          const response: ApplySubtreesResponse = { ok: true };
          return new Response(JSON.stringify(response), {
            headers: { "content-type": "application/json" },
          });
        }

        const receivingFromConsumer =
          originKind === "consumer" &&
          subscribers.some((s) => s.consumerRoomId === sender);
        const receivingFromSource =
          originKind === "source" &&
          sharedRefs.some((r) => r.sourceRoomId === sender);

        let subtreesToApply: Record<string, Record<string, any>> = subtrees;
        if (receivingFromConsumer) {
          // IMPORTANT: Only apply tags/elementIds that already exist in the source's doc to ensure
          // the source of truth is derived from the source room and not consumer-added capabilities.
          const play = yDoc.getMap("play") as Y.Map<any>;
          const filtered: Record<string, Record<string, any>> = {};
          Object.entries(subtreesToApply).forEach(([tag, elements]) => {
            const tagMap = play.get?.(tag) as Y.Map<any> | undefined;
            if (!(tagMap instanceof Y.Map)) return;
            const kept: Record<string, any> = {};
            Object.entries(elements).forEach(([elementId, data]) => {
              if (tagMap.has(elementId)) kept[elementId] = data;
            });
            if (Object.keys(kept).length) filtered[tag] = kept;
          });
          // Enforce simple permissions: read-only shared elements on this source room cannot be modified by consumers
          const perms = await this.getSharedPermissions();
          const filteredByPerms: Record<string, Record<string, any>> = {};
          Object.entries(filtered).forEach(([tag, elements]) => {
            const kept: Record<string, any> = {};
            Object.entries(elements).forEach(([elementId, data]) => {
              // Only allow writes to elements explicitly shared as read-write
              // This handles both read-only elements and ones that aren't even shared
              if (perms[elementId] !== "read-write") {
                return;
              }
              kept[elementId] = data;
            });
            if (Object.keys(kept).length) filteredByPerms[tag] = kept;
          });
          subtreesToApply = filteredByPerms;
        } else if (receivingFromSource) {
          // Consumer: apply only the elementIds we are subscribed to for this sender/source
          const ref = sharedRefs.find((r) => r.sourceRoomId === sender);
          const allowed = new Set(ref?.elementIds || []);
          if (allowed.size > 0) {
            const filteredByRefs: Record<string, Record<string, any>> = {};
            Object.entries(subtreesToApply).forEach(([tag, elements]) => {
              const kept: Record<string, any> = {};
              Object.entries(elements).forEach(([elementId, data]) => {
                if (allowed.has(elementId)) kept[elementId] = data;
              });
              if (Object.keys(kept).length) filteredByRefs[tag] = kept;
            });
            subtreesToApply = filteredByRefs;
          } else {
            subtreesToApply = {};
          }
        }
        if (!Object.keys(subtreesToApply).length) {
          const response: ApplySubtreesResponse = { ok: true };
          return new Response(JSON.stringify(response), {
            headers: { "content-type": "application/json" },
          });
        }
        const beforeSize = encodeDocToBase64(yDoc).length;
        const ORIGIN = originKind === "consumer" ? ORIGIN_C2S : ORIGIN_S2C;
        yDoc.transact(
          () => this.assignPlaySubtrees(yDoc, subtreesToApply),
          ORIGIN
        );
        const afterSize = encodeDocToBase64(yDoc).length;
        console.log(
          `[Bridge] Applied subtrees from ${sender} (${originKind}). Size: ${beforeSize} -> ${afterSize}`
        );

        // If this is a SOURCE room receiving from a CONSUMER, immediately fanout to other consumers (excluding sender if provided)
        if (receivingFromConsumer) {
          const subscribers = await this.getSubscribers();
          const mainParty = this.room.context.parties.main;
          const currentEpoch = await this.getResetEpoch();
          await Promise.all(
            subscribers.map(async ({ consumerRoomId, elementIds }) => {
              if (sender && consumerRoomId === sender) return;
              // Per-subscriber filtering by their subscribed elementIds
              let toSend = subtreesToApply;
              if (elementIds && elementIds.length) {
                const allowedElementIds = new Set(elementIds);
                const filteredSubtrees: Record<
                  string,
                  Record<string, any>
                > = {};
                Object.entries(subtreesToApply).forEach(([tag, elements]) => {
                  const kept: Record<string, any> = {};
                  Object.entries(elements).forEach(([elementId, data]) => {
                    if (allowedElementIds.has(elementId))
                      kept[elementId] = data;
                  });
                  if (Object.keys(kept).length) filteredSubtrees[tag] = kept;
                });
                toSend = filteredSubtrees;
                if (!Object.keys(toSend).length) return;
              }
              const consumerRoom = mainParty.get(consumerRoomId);
              try {
                const applyRequest: ApplySubtreesImmediateRequest = {
                  action: "apply-subtrees-immediate",
                  subtrees: toSend,
                  sender: this.room.id,
                  originKind: "source",
                  resetEpoch: currentEpoch ?? null,
                };
                await consumerRoom.fetch({
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify(applyRequest),
                });
              } catch {}
            })
          );
        }
        const response: ApplySubtreesResponse = { ok: true };
        return new Response(JSON.stringify(response), {
          headers: { "content-type": "application/json" },
        });
      }

      return new Response("Bad Request", { status: 400 });
    } catch (err) {
      console.error("onRequest error", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  /**
   * Perform a hard reset (garbage collection) of the room's Y.Doc.
   * This creates a fresh document from the current state, removing all history/tombstones.
   *
   * Steps:
   * 1. Lock autosave to prevent overwriting clean DB state
   * 2. Extract current state as JSON
   * 3. Create fresh Y.Doc from JSON (no history)
   * 4. Save to database
   * 5. Replace live doc with snapshot
   * 6. Set resetEpoch for client detection
   * 7. Broadcast room-reset signal
   * 8. Close all connections
   * 9. Flush microtasks and release lock
   *
   * @returns Object with beforeSize, afterSize, and resetEpoch
   */
  async performHardReset(): Promise<{
    beforeSize: number;
    afterSize: number;
    resetEpoch: number;
  }> {
    const roomId = this.room.id;
    console.log(`[Hard Reset] Starting for room: ${roomId}`);

    // Lock autosave immediately
    this.isSkippingSave = true;

    try {
      // Get current live doc state
      const liveYDoc = await unstable_getYDoc(this.room, this.providerOptions);
      console.log(`[Hard Reset] Successfully retrieved live Y.Doc`);

      // Extract current state as JSON
      const currentPlayData = docToJson(liveYDoc);
      console.log(
        `[Hard Reset] Extracted play data: ${
          currentPlayData ? "has data" : "empty"
        }`
      );

      // Calculate before size
      const beforeSize = encodeDocToBase64(liveYDoc).length;
      console.log(
        `[Hard Reset] Before size: ${beforeSize} bytes (${(
          beforeSize /
          1024 /
          1024
        ).toFixed(2)} MB)`
      );

      const resetEpoch = Date.now();
      let freshBase64: string;
      let afterSize: number;

      // Handle empty room case
      if (!currentPlayData) {
        console.log(`[Hard Reset] Room is empty, creating empty fresh doc...`);
        const emptyDoc = new Y.Doc();
        setDocResetEpoch(emptyDoc, resetEpoch);
        freshBase64 = encodeDocToBase64(emptyDoc);
        afterSize = freshBase64.length;
        console.log(`[Hard Reset] Empty doc size: ${afterSize} bytes`);
      } else {
        // Create a fresh Y.Doc with the current state (no history/tombstones)
        console.log(`[Hard Reset] Creating fresh Y.Doc from play data...`);
        const freshDoc = jsonToDoc(currentPlayData);
        setDocResetEpoch(freshDoc, resetEpoch);
        console.log(`[Hard Reset] Successfully created fresh Y.Doc`);

        // Encode the fresh doc
        freshBase64 = encodeDocToBase64(freshDoc);
        afterSize = freshBase64.length;
        console.log(
          `[Hard Reset] After size: ${afterSize} bytes (${(
            afterSize /
            1024 /
            1024
          ).toFixed(2)} MB)`
        );
      }

      // Save to database
      console.log(`[Hard Reset] Saving fresh doc to database...`);
      const { error: saveError } = await supabase.from("documents").upsert(
        {
          name: this.room.id,
          document: freshBase64,
        },
        { onConflict: "name" }
      );

      if (saveError) {
        console.error(
          `[Hard Reset] Database save failed:`,
          saveError.message,
          saveError
        );
        throw new Error(`Failed to save reset document: ${saveError.message}`);
      }
      console.log(`[Hard Reset] Successfully saved fresh doc to database`);

      // Reload the live server from the new snapshot
      console.log(`[Hard Reset] Reloading live server from snapshot...`);
      replaceDocFromSnapshot(liveYDoc, freshBase64);
      setDocResetEpoch(liveYDoc, resetEpoch);
      console.log(`[Hard Reset] Successfully reloaded live server`);

      // Set reset epoch for client detection
      await this.setResetEpoch(resetEpoch);
      console.log(`[Hard Reset] Set resetEpoch: ${resetEpoch}`);

      // Broadcast a "room-reset" message to all connected clients
      this.room.broadcast(
        JSON.stringify({
          type: "room-reset",
          timestamp: resetEpoch,
          resetEpoch: resetEpoch,
        })
      );
      console.log(`[Hard Reset] Broadcasted room-reset signal to all clients`);

      // FORCE DISCONNECT: Close all connections to ensure no lingering clients
      // push their old state back to the server
      const connections = [...this.room.getConnections()];
      connections.forEach((conn) => {
        try {
          conn.close(4000, "Room Reset by Admin");
        } catch (e) {
          console.error("[Hard Reset] Failed to close connection:", e);
        }
      });
      console.log(`[Hard Reset] Closed ${connections.length} connections`);

      const sizeReduction = beforeSize - afterSize;
      const sizeReductionPercent = ((sizeReduction / beforeSize) * 100).toFixed(
        1
      );

      console.log(
        `[Hard Reset] Completed successfully: ${beforeSize} -> ${afterSize} bytes (${sizeReductionPercent}% reduction)`
      );

      // Flush pending microtasks to ensure any queued autosave callbacks are processed
      // before we release the lock
      await Promise.resolve();

      return {
        beforeSize,
        afterSize,
        resetEpoch,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      console.error(
        `[Hard Reset] Failed for room ${roomId}:`,
        errorMessage,
        errorStack || error
      );

      throw error;
    } finally {
      // Re-enable autosave after a short delay to let the dust settle
      // Use setTimeout to ensure any pending callbacks have been processed
      setTimeout(() => {
        this.isSkippingSave = false;
        console.log("[Hard Reset] Autosave re-enabled");
      }, 1000);
    }
  }

  // PartyKit Alarm: invoked when storage alarm rings
  async onAlarm(): Promise<void> {
    try {
      const subscribers = await this.getSubscribers();

      if (subscribers.length) {
        const now = Date.now();
        const withinLease = (s: any) => {
          const leaseMs = DEFAULT_SUBSCRIBER_LEASE_MS;
          const last = s?.lastSeen || s?.createdAt;
          const t = last ? Date.parse(last) : NaN;
          if (!Number.isFinite(t)) return true; // if no timestamp, be permissive but keep once
          return now - t <= leaseMs;
        };

        const prunedForLease = subscribers.filter(withinLease);
        if (prunedForLease.length !== subscribers.length) {
          await this.setSubscribers(prunedForLease);
        }
      }

      // Prune shared references by TTL on consumer rooms
      const refsRaw = await this.getSharedReferences();
      const refs: Array<SharedRefEntry> = Array.isArray(refsRaw) ? refsRaw : [];
      if (refs.length) {
        const now = Date.now();
        const leaseMs = DEFAULT_SUBSCRIBER_LEASE_MS; // unified lease
        const kept = refs.filter((r) => {
          const t = r?.lastSeen ? Date.parse(r.lastSeen) : NaN;
          if (!Number.isFinite(t)) return true;
          return now - t <= leaseMs;
        });
        if (kept.length !== refs.length) {
          await this.setSharedReferences(kept);
        }
      }
    } finally {
      // Reschedule the next alarm only if there are subscribers or refs remaining
      const subs = await this.getSubscribers();
      const refs = await this.getSharedReferences();
      if (subs.length || refs.length) {
        await this.room.storage.setAlarm?.(
          Date.now() + DEFAULT_PRUNE_INTERVAL_MS
        );
      }
    }
  }

  // Attach immediate observers to this room's doc to bridge changes without waiting for save callback
  private async attachImmediateBridgeObservers(): Promise<void> {
    if (this.observersAttached) return;
    const yDoc = await unstable_getYDoc(this.room, this.providerOptions);

    // Handle source room updates for shared elements: on change, push to each subscribed consumer immediately
    yDoc.on("update", async (_update: Uint8Array, origin: any) => {
      // Ignore updates we just applied from a consumer pull to avoid echo
      if (origin === ORIGIN_C2S) return;

      const subscribers = await this.getSubscribers();
      if (!subscribers.length) return;

      const permissions = await this.getSharedPermissions();
      const mainParty = this.room.context.parties.main;
      // Export all subtrees of interest and push immediately
      const currentEpoch = await this.getResetEpoch();
      await Promise.all(
        subscribers.map(async ({ consumerRoomId, elementIds }) => {
          if (!elementIds || !elementIds.length) return;
          const sharedElementIds = elementIds.filter((id) => {
            return Boolean(permissions[id]);
          });
          const subtrees = this.extractPlaySubtrees(
            yDoc,
            new Set(sharedElementIds)
          );
          if (!Object.keys(subtrees).length) return;
          const consumerRoom = mainParty.get(consumerRoomId);
          const applyRequest: ApplySubtreesImmediateRequest = {
            action: "apply-subtrees-immediate",
            subtrees,
            sender: this.room.id,
            originKind: "source",
            resetEpoch: currentEpoch ?? null,
          };
          await consumerRoom.fetch({
            method: "POST",
            body: JSON.stringify(applyRequest),
          });
        })
      );
    });

    // Handle consumer room updates for shared references: when our doc changes for tracked shared refs, push back to sources immediately
    yDoc.on("update", async (_update: Uint8Array, origin: any) => {
      // Ignore updates we just applied from a source push to avoid echo
      if (origin === ORIGIN_S2C) return;
      const mainParty = this.room.context.parties.main;
      const refs = await this.getSharedReferences();
      const currentEpoch = await this.getResetEpoch();
      for (const { sourceRoomId, elementIds } of refs) {
        if (!elementIds?.length) continue;
        const subtrees = this.extractPlaySubtrees(yDoc, new Set(elementIds));
        if (!Object.keys(subtrees).length) continue;
        const sourceRoom = mainParty.get(sourceRoomId);
        const applyRequest: ApplySubtreesImmediateRequest = {
          action: "apply-subtrees-immediate",
          subtrees,
          sender: this.room.id,
          originKind: "consumer",
          resetEpoch: currentEpoch ?? null,
        };
        await sourceRoom.fetch({
          method: "POST",
          body: JSON.stringify(applyRequest),
        });
      }
    });

    this.observersAttached = true;
  }
}
