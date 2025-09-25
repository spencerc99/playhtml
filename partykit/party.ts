import type * as Party from "partykit/server";
import { onConnect, unstable_getYDoc, YPartyKitOptions } from "y-partykit";
import { syncedStore, getYjsValue } from "@syncedstore/core";
import { deepReplaceIntoProxy } from "@playhtml/common";
import { Buffer } from "node:buffer";
import * as Y from "yjs";
import { deriveRoomId } from "@playhtml/common";
import { supabase } from "./db";
import { AdminHandler } from "./admin";
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
  PartyKitRequest,
  SubscribeRequest,
  ExportPermissionsRequest,
  ApplySubtreesImmediateRequest,
  SubscribeResponse,
  ExportPermissionsResponse,
  ApplySubtreesResponse,
  isSubscribeRequest,
  isExportPermissionsRequest,
  isApplySubtreesImmediateRequest,
} from "./request";

export default class PartyServer implements Party.Server {
  constructor(public room: Party.Room) {}
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
        // This is called every few seconds if the document has changed

        // convert the Yjs document to a Uint8Array
        const content = Y.encodeStateAsUpdate(doc);

        // Save the document to the database
        const { data: _data, error } = await supabase.from("documents").upsert(
          {
            name: this.room.id,
            document: Buffer.from(content).toString("base64"),
          },
          { onConflict: "name" }
        );

        if (error) {
          console.error("failed to save:", error);
        }
      },
    },
  };
  private observersAttached = false;
  private adminHandler = new AdminHandler(this);

  // Storage getters and setters to clean up repeated STORAGE_KEYS patterns
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
    Record<string, "read-only" | "read-write">
  > {
    return (await this.room.storage.get(STORAGE_KEYS.sharedPermissions)) || {};
  }

  async setSharedPermissions(
    permissions: Record<string, "read-only" | "read-write">
  ): Promise<void> {
    await this.room.storage.put(STORAGE_KEYS.sharedPermissions, permissions);
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

  async isSourceRoom(): Promise<boolean> {
    const permissions = await this.getSharedPermissions();
    return Object.keys(permissions).length > 0;
  }

  // --- Helper: compute source room id from domain and pathOrRoom
  getSourceRoomId(domain: string, pathOrRoom: string): string {
    return deriveRoomId(domain, pathOrRoom);
  }

  // --- Helper: parse shared references array from connection/request URL
  parseSharedReferencesFromUrl(url: string): Array<{
    domain: string;
    path: string;
    elementId: string;
  }> {
    try {
      const u = new URL(url);
      const raw = u.searchParams.get("sharedReferences");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }

  // --- Helper: parse shared elements (declared on source) from URL params
  parseSharedElementsFromUrl(url: string): Array<{
    elementId: string;
    permissions?: string; // 'read-only' | 'read-write'
  }> {
    try {
      const u = new URL(url);
      const raw = u.searchParams.get("sharedElements");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      return [];
    } catch {
      return [];
    }
  }

  // --- Helper: group SharedReferences into storage entries
  private groupRefsToEntries(
    refs: Array<{ domain: string; path: string; elementId: string }>
  ): Array<{ sourceRoomId: string; elementIds: string[] }> {
    const bySource = new Map<string, Set<string>>();
    for (const ref of refs) {
      const srcId = this.getSourceRoomId(ref.domain, ref.path);
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

    const sourceRoomId = this.getSourceRoomId(reference.domain, reference.path);
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
    const filtered: Record<string, "read-only" | "read-write"> = {};

    for (const id of elementIds) {
      if (perms[id]) filtered[id] = perms[id];
    }

    // Send permissions back to the requesting client
    sender.send(JSON.stringify({ permissions: filtered }));
  }

  private async handleRegisterSharedElement(
    element: {
      elementId: string;
      permissions: "read-only" | "read-write";
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
    // Opportunistically schedule an alarm if subscribers exist
    await this.ensureAlarmIfSubscribersPresent();

    // Parse shared references from the connecting client (for consumer rooms)
    // Parse from the WebSocket request URL
    const sharedReferences = this.parseSharedReferencesFromUrl(ctx.request.url);

    // Persist consumer interest mapping for later pulls/mirroring
    if (sharedReferences.length) {
      const entries = this.groupRefsToEntries(sharedReferences);
      const { entries: merged } = await this.mergeAndStoreSharedRefs(entries);
      await this.subscribeAndHydrate(merged);
    }

    // Persist source-declared permissions for simple global read-only
    const sharedElements = this.parseSharedElementsFromUrl(ctx.request.url);
    if (sharedElements.length) {
      const permissionsByElementId: Record<string, "read-only" | "read-write"> =
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
        const filtered: Record<string, "read-only" | "read-write"> = {};
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
        // Determine direction by inspecting our local state relative to sender
        // - If 'sender' matches a subscriber.consumerRoomId, this room is a SOURCE receiving from a CONSUMER
        // - If 'sender' matches a sharedReferences.sourceRoomId, this room is a CONSUMER receiving from a SOURCE
        const subsForDirCheck = await this.getSubscribers();
        const sharedRefs = await this.getSharedReferences();
        const receivingFromConsumer =
          originKind === "consumer" &&
          subsForDirCheck.some((s) => s.consumerRoomId === sender);
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
        const ORIGIN = originKind === "consumer" ? ORIGIN_C2S : ORIGIN_S2C;
        yDoc.transact(
          () => this.assignPlaySubtrees(yDoc, subtreesToApply),
          ORIGIN
        );

        // If this is a SOURCE room receiving from a CONSUMER, immediately fanout to other consumers (excluding sender if provided)
        if (receivingFromConsumer) {
          const subscribers = await this.getSubscribers();
          const mainParty = this.room.context.parties.main;
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

    // Source room: on change, push to each subscribed consumer immediately
    yDoc.on("update", async (_update: Uint8Array, origin: any) => {
      // Ignore updates we just applied from a consumer pull to avoid echo
      if (origin === ORIGIN_C2S) return;

      const subscribers = await this.getSubscribers();
      if (!subscribers.length) return;

      const permissions = await this.getSharedPermissions();
      const mainParty = this.room.context.parties.main;
      // Export all subtrees of interest and push immediately
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
            originKind: "consumer",
          };
          await consumerRoom.fetch({
            method: "POST",
            body: JSON.stringify(applyRequest),
          });
        })
      );
    });

    // Consumer room: when our doc changes for tracked shared refs, push back to sources immediately
    yDoc.on("update", async (_update: Uint8Array, origin: any) => {
      // Ignore updates we just applied from a source push to avoid echo
      if (origin === ORIGIN_S2C) return;
      const mainParty = this.room.context.parties.main;
      const refs = await this.getSharedReferences();
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
