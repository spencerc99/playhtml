import type * as Party from "partykit/server";
import { onConnect, unstable_getYDoc, YPartyKitOptions } from "y-partykit";
import { createClient } from "@supabase/supabase-js";
import { syncedStore, getYjsValue } from "@syncedstore/core";
import { deepReplaceIntoProxy } from "@playhtml/common";
import { Buffer } from "node:buffer";
import * as Y from "yjs";
import { deriveRoomId } from "@playhtml/common";

type Subscriber = {
  consumerRoomId: string;
  elementIds?: string[];
  createdAt?: string;
  lastSeen?: string;
  leaseMs?: number;
};
type SharedRefEntry = {
  sourceRoomId: string;
  elementIds: string[];
  lastSeen?: string;
};

// Create a single supabase client for interacting with your database
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_KEY as string,
  { auth: { persistSession: false } }
);

// Storage key constants for consistency
const STORAGE_KEYS = {
  // Stores consumer room ids and the elementIds they are interested in
  subscribers: "subscribers",
  // Stores references out to other source rooms that this source room is interested in
  sharedReferences: "sharedReferences",
  sharedPermissions: "sharedPermissions",
};
// Subscriber lease configuration (default 12 hours)
const DEFAULT_SUBSCRIBER_LEASE_MS = (() => {
  return 60 * 60 * 1000 * 12;
})();
// Prune interval configuration (default 6 hours). See PartyKit alarms guide:
// https://docs.partykit.io/guides/scheduling-tasks-with-alarms/
const DEFAULT_PRUNE_INTERVAL_MS = (() => {
  return 60 * 60 * 1000 * 4;
})();
const ORIGIN_S2C = "__bridge_s2c__";
const ORIGIN_C2S = "__bridge_c2s__";

export default class implements Party.Server {
  constructor(public room: Party.Room) {}
  // Reuse the exact same options for all Y.Doc access
  private providerOptions: YPartyKitOptions = {
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

  // Ensure an alarm is set if subscribers exist; avoids rescheduling if one is set sooner
  private async ensureAlarmIfSubscribersPresent(): Promise<void> {
    const subs: Array<any> =
      (await this.room.storage.get(STORAGE_KEYS.subscribers)) || [];
    const refs: Array<any> =
      (await this.room.storage.get(STORAGE_KEYS.sharedReferences)) || [];
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

  private async isSourceRoom(): Promise<boolean> {
    return !!(await this.room.storage.get(STORAGE_KEYS.sharedPermissions));
  }

  private clonePlain<T>(value: T): T {
    // Same cloning logic as PlayHTML
    try {
      // @ts-ignore
      if (typeof structuredClone === "function") {
        // @ts-ignore
        return structuredClone(value);
      }
    } catch {}
    if (value === null || value === undefined) return value;
    if (typeof value === "object") {
      return JSON.parse(JSON.stringify(value));
    }
    return value;
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
    const existing: Array<SharedRefEntry> =
      (await this.room.storage.get(STORAGE_KEYS.sharedReferences)) || [];
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
      await this.room.storage.put(STORAGE_KEYS.sharedReferences, merged);
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
          const res = await sourceRoom.fetch({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "subscribe",
              consumerRoomId: this.room.id,
              elementIds,
            }),
          });
          // technically we don't need this because we already check for the permissions
          // when we apply permissions, but it's good to have extra protection!
          let allowedIds: string[] = [];
          if (res.ok) {
            try {
              const data = (await res.json()) as any;
              if (data && data.subscribed && Array.isArray(data.elementIds)) {
                allowedIds = data.elementIds.filter(
                  (x: any) => typeof x === "string"
                );
              }
            } catch {}
          }
          // Update this room's sharedReferences to reflect allowedIds only
          const existing: Array<SharedRefEntry> =
            (await this.room.storage.get(STORAGE_KEYS.sharedReferences)) || [];
          const nowIso = new Date().toISOString();
          const idx = existing.findIndex(
            (e) => e.sourceRoomId === sourceRoomId
          );
          if (allowedIds.length) {
            if (idx !== -1) {
              existing[idx] = {
                sourceRoomId,
                elementIds: Array.from(new Set(allowedIds)),
                lastSeen: nowIso,
              };
            } else {
              existing.push({
                sourceRoomId,
                elementIds: Array.from(new Set(allowedIds)),
                lastSeen: nowIso,
              });
            }
          } else if (idx !== -1) {
            // No allowed ids, remove the entry
            existing.splice(idx, 1);
          }
          await this.room.storage.put(STORAGE_KEYS.sharedReferences, existing);
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
          await this.handleAddSharedReference(parsed.reference, sender);
        } else if (parsed.type === "export-permissions") {
          // Handle individual permission requests
          await this.handleExportPermissions(parsed.elementIds, sender);
        } else if (parsed.type === "register-shared-element") {
          // Handle dynamic registration of shared source element
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
    const perms: Record<string, "read-only" | "read-write"> =
      (await this.room.storage.get(STORAGE_KEYS.sharedPermissions)) || {};
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
    const existingPerms: Record<string, "read-only" | "read-write"> =
      (await this.room.storage.get(STORAGE_KEYS.sharedPermissions)) || {};
    const mode =
      element.permissions && element.permissions === "read-only"
        ? "read-only"
        : "read-write";
    existingPerms[element.elementId] = mode;
    await this.room.storage.put(STORAGE_KEYS.sharedPermissions, existingPerms);
  }

  async onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
    const room = this.room;
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
      await room.storage.put(
        STORAGE_KEYS.sharedPermissions,
        permissionsByElementId
      );
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

      // Admin endpoints
      if (request.method === "GET" && request.url.includes("admin/inspect")) {
        return this.handleAdminInspect(request);
      }
      if (request.method === "GET" && request.url.includes("admin/raw-data")) {
        return this.handleAdminRawData(request);
      }
      if (
        request.method === "POST" &&
        request.url.includes("admin/remove-subscriber")
      ) {
        return this.handleAdminRemoveSubscriber(request);
      }
      if (
        request.method === "GET" &&
        request.url.includes("admin/live-compare")
      ) {
        return this.handleAdminLiveCompare(request);
      }

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const body = await request.json();
      const action = (body && (body as any).action) as string;

      if (action === "subscribe") {
        // Called on SOURCE room; registers a consumer room id
        const consumerRoomId = (body && (body as any).consumerRoomId) as string;
        const elementIdsRaw = (body && (body as any).elementIds) as
          | string[]
          | undefined;
        if (!consumerRoomId)
          return new Response("Bad Request", { status: 400 });
        const elementIds = Array.isArray(elementIdsRaw)
          ? Array.from(
              new Set(elementIdsRaw.filter((x) => typeof x === "string"))
            )
          : undefined;
        // Validate requested elementIds against sharedPermissions of this SOURCE room
        const sharedPerms: Record<string, "read-only" | "read-write"> =
          (await this.room.storage.get(STORAGE_KEYS.sharedPermissions)) || {};
        const allowedIds = (elementIds || []).filter((id) => !!sharedPerms[id]);
        const existing: Array<Subscriber> =
          (await this.room.storage.get(STORAGE_KEYS.subscribers)) || [];
        const nowIso = new Date().toISOString();
        const leaseMs = DEFAULT_SUBSCRIBER_LEASE_MS;
        const found = existing.find((s) => s.consumerRoomId === consumerRoomId);
        // If there are no allowed elementIds, do not add/update a subscriber entry
        if (!allowedIds.length) {
          if (found) {
            const next = existing.filter(
              (s) => s.consumerRoomId !== consumerRoomId
            );
            await this.room.storage.put(STORAGE_KEYS.subscribers, next);
          }
          return new Response(
            JSON.stringify({
              ok: true,
              subscribed: false,
              reason: "no-shared-elements",
            }),
            { headers: { "content-type": "application/json" } }
          );
        }

        if (!found) {
          existing.push({
            consumerRoomId,
            elementIds: allowedIds,
            createdAt: nowIso,
            lastSeen: nowIso,
            leaseMs,
          });
        } else {
          // Update elementIds (filtered) and lastSeen
          found.elementIds = allowedIds;
          found.lastSeen = nowIso;
        }
        await this.room.storage.put(STORAGE_KEYS.subscribers, existing);
        return new Response(
          JSON.stringify({
            ok: true,
            subscribed: true,
            elementIds: allowedIds,
          }),
          {
            headers: { "content-type": "application/json" },
          }
        );
      }

      if (action === "export-permissions") {
        // Returns simple permissions (read-only/read-write) for requested elementIds
        const elementIds: string[] = Array.isArray((body as any)?.elementIds)
          ? (body as any).elementIds
          : [];
        const perms: Record<string, "read-only" | "read-write"> =
          (await this.room.storage.get(STORAGE_KEYS.sharedPermissions)) || {};
        const filtered: Record<string, "read-only" | "read-write"> = {};
        for (const id of elementIds) {
          if (perms[id]) filtered[id] = perms[id];
        }
        return new Response(JSON.stringify({ permissions: filtered }), {
          headers: { "content-type": "application/json" },
        });
      }

      if (action === "apply-subtrees-immediate") {
        // Applies provided subtrees immediately and marks origin to suppress echo
        const subtrees = (((body as any) || {}).subtrees || {}) as Record<
          string,
          Record<string, any>
        >;
        if (!subtrees || typeof subtrees !== "object") {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          });
        }
        const sender = (body && (body as any).sender) as string | undefined;
        const yDoc = await unstable_getYDoc(this.room, this.providerOptions);
        const isSourceRoom = await this.isSourceRoom();
        let subtreesToApply: Record<string, Record<string, any>> = subtrees;
        if (isSourceRoom) {
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
          const perms: Record<string, "read-only" | "read-write"> =
            (await this.room.storage.get(STORAGE_KEYS.sharedPermissions)) || {};
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
        }
        if (!Object.keys(subtreesToApply).length) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          });
        }
        const hasSharedRefs = !!(await this.room.storage.get(
          STORAGE_KEYS.sharedReferences
        ));
        const ORIGIN = hasSharedRefs ? ORIGIN_S2C : ORIGIN_C2S;
        yDoc.transact(
          () => this.assignPlaySubtrees(yDoc, subtreesToApply),
          ORIGIN
        );

        // If this is a SOURCE room, immediately fanout to other consumers (excluding sender if provided)
        const subscribers: Array<Subscriber> =
          (await this.room.storage.get(STORAGE_KEYS.subscribers)) || [];
        if (isSourceRoom && subscribers.length) {
          const mainParty = this.room.context.parties.main;
          await Promise.all(
            subscribers.map(async ({ consumerRoomId }) => {
              if (sender && consumerRoomId === sender) return;
              const consumerRoom = mainParty.get(consumerRoomId);
              try {
                await consumerRoom.fetch({
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    action: "apply-subtrees-immediate",
                    subtrees: subtreesToApply,
                  }),
                });
              } catch {}
            })
          );
        }
        return new Response(JSON.stringify({ ok: true }), {
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
      const subscribers: Array<Subscriber> =
        (await this.room.storage.get(STORAGE_KEYS.subscribers)) || [];

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
          await this.room.storage.put(STORAGE_KEYS.subscribers, prunedForLease);
        }
      }

      // Prune shared references by TTL on consumer rooms
      const refsRaw = await this.room.storage.get(
        STORAGE_KEYS.sharedReferences
      );
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
          await this.room.storage.put(STORAGE_KEYS.sharedReferences, kept);
        }
      }
    } finally {
      // Reschedule the next alarm only if there are subscribers or refs remaining
      const subs: Array<any> =
        (await this.room.storage.get(STORAGE_KEYS.subscribers)) || [];
      const refs: Array<any> =
        (await this.room.storage.get(STORAGE_KEYS.sharedReferences)) || [];
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

      const subscribers: Array<Subscriber> =
        (await this.room.storage.get("subscribers")) || [];
      if (!subscribers.length) return;

      const mainParty = this.room.context.parties.main;
      // Export all subtrees of interest and push immediately
      await Promise.all(
        subscribers.map(async ({ consumerRoomId, elementIds }) => {
          if (!elementIds || !elementIds.length) return;
          const subtrees = this.extractPlaySubtrees(yDoc, new Set(elementIds));
          if (!Object.keys(subtrees).length) return;
          const consumerRoom = mainParty.get(consumerRoomId);
          await consumerRoom.fetch({
            method: "POST",
            body: JSON.stringify({
              action: "apply-subtrees-immediate",
              subtrees,
              sender: this.room.id,
            }),
          });
        })
      );
    });

    // Consumer room: when our doc changes for tracked shared refs, push back to sources immediately
    yDoc.on("update", async (_update: Uint8Array, origin: any) => {
      // Ignore updates we just applied from a source push to avoid echo
      if (origin === ORIGIN_S2C) return;
      const mainParty = this.room.context.parties.main;
      const refs: Array<{ sourceRoomId: string; elementIds: string[] }> =
        (await this.room.storage.get(STORAGE_KEYS.sharedReferences)) || [];
      for (const { sourceRoomId, elementIds } of refs) {
        if (!elementIds?.length) continue;
        const subtrees = this.extractPlaySubtrees(yDoc, new Set(elementIds));
        if (!Object.keys(subtrees).length) continue;
        const sourceRoom = mainParty.get(sourceRoomId);
        await sourceRoom.fetch({
          method: "POST",
          body: JSON.stringify({
            action: "apply-subtrees-immediate",
            subtrees,
            sender: this.room.id,
          }),
        });
      }
    });

    this.observersAttached = true;
  }

  /*********************************
   *        ADMIN ENDPOINTS        *
   *********************************/
  private async handleAdminInspect(request: Party.Request): Promise<Response> {
    // Check admin token
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
    try {
      const subscribers =
        (await this.room.storage.get(STORAGE_KEYS.subscribers)) || [];
      const sharedReferences =
        (await this.room.storage.get(STORAGE_KEYS.sharedReferences)) || [];
      const sharedPermissions =
        (await this.room.storage.get(STORAGE_KEYS.sharedPermissions)) || {};

      // Get Y.Doc data if available - use direct approach for consistency
      let ydocData: any = null;
      try {
        // Create fresh Y.Doc and load data directly (same as debug reconstruction)
        const yDoc = new Y.Doc();
        const { data: docData } = await supabase
          .from("documents")
          .select("name, document, created_at")
          .eq("name", this.room.id)
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
        const playData = this.clonePlain(store.play);
        const hasAnyData = Object.keys(playData).some(
          (tag) => Object.keys(playData[tag] || {}).length > 0
        );

        // Return 404-like response if no actual play data exists
        if (!hasAnyData) {
          return new Response(
            JSON.stringify({
              error: "No Y.Doc play data found",
              message: "Room exists but contains no PlayHTML data",
              roomId: this.room.id,
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
            clientCount: Array.from(this.room.getConnections()).length,
          },
        };
      } catch (error: unknown) {
        console.warn("Failed to extract Y.Doc data:", error);
        ydocData = {
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const roomData = {
        roomId: this.room.id,
        subscribers,
        sharedReferences,
        sharedPermissions,
        ydoc: ydocData,
        connections: Array.from(this.room.getConnections()).length,
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
    // Check admin token
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

    try {
      // Get raw document from Supabase
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("name", this.room.id)
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
        roomId: this.room.id,
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
    // Check admin token
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

    try {
      // Method 1: Direct Y.Doc approach (what admin console uses)
      const directYDoc = new Y.Doc();
      const { data: docData } = await supabase
        .from("documents")
        .select("document")
        .eq("name", this.room.id)
        .maybeSingle();

      let directData: any = null;
      if (docData?.document) {
        const buffer = new Uint8Array(Buffer.from(docData.document, "base64"));
        Y.applyUpdate(directYDoc, buffer);
        const directStore = syncedStore<{ play: Record<string, any> }>(
          { play: {} },
          directYDoc
        );
        directData = this.clonePlain(directStore.play);
      }

      // Method 2: Live server approach (using unstable_getYDoc like the running server)
      let liveData: any = null;
      let liveDebugInfo: any = {};
      try {
        const liveYDoc = await unstable_getYDoc(
          this.room,
          this.providerOptions
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
        liveData = this.clonePlain(liveStore.play);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("Live data extraction failed:", msg);
        liveData = { error: `Failed to get live data: ${msg}` };
        liveDebugInfo.error = msg;
      }

      const comparison = {
        roomId: this.room.id,
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
          sameKeys: this.compareKeys(directData, liveData),
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

  private compareKeys(
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

  // --- Admin: remove a subscriber entry by consumerRoomId
  private async handleAdminRemoveSubscriber(
    request: Party.Request
  ): Promise<Response> {
    // Check admin token
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

      const subscribers: Array<Subscriber> =
        (await this.room.storage.get(STORAGE_KEYS.subscribers)) || [];
      const next = subscribers.filter(
        (s) => s.consumerRoomId !== consumerRoomId
      );
      await this.room.storage.put(STORAGE_KEYS.subscribers, next);

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
