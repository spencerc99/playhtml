import type * as Party from "partykit/server";
import { onConnect, unstable_getYDoc } from "y-partykit";
import { createClient } from "@supabase/supabase-js";
import { syncedStore, getYjsValue } from "@syncedstore/core";
import { deepReplaceIntoProxy } from "@playhtml/common";
import { Buffer } from "node:buffer";
import * as Y from "yjs";
import { deriveRoomId, normalizePath } from "@playhtml/common";

// Create a single supabase client for interacting with your database
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_KEY as string,
  { auth: { persistSession: false } }
);

// Storage key constants for consistency
const STORAGE_KEYS = {
  subscribers: "subscribers",
  sharedReferences: "sharedReferences",
  sharedPermissions: "sharedPermissions",
};
const ORIGIN_S2C = "__bridge_s2c__";
const ORIGIN_C2S = "__bridge_c2s__";

export default class implements Party.Server {
  constructor(public room: Party.Room) {}
  // Reuse the exact same options for all Y.Doc access
  private providerOptions: import("y-partykit").YPartyKitOptions | undefined;
  private observersAttached = false;

  private async isSourceRoom(): Promise<boolean> {
    return !!(await this.room.storage.get(STORAGE_KEYS.sharedPermissions));
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
    const existing: Array<{ sourceRoomId: string; elementIds: string[] }> =
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
      const merged = Array.from(bySource.entries()).map(
        ([sourceRoomId, ids]) => ({
          sourceRoomId,
          elementIds: Array.from(ids),
        })
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
    const mainPartyAny = this.room.context.parties.main as any;
    // Subscribe
    await Promise.all(
      entries.map(async ({ sourceRoomId, elementIds }) => {
        if (!elementIds?.length) return;
        try {
          const sourceRoomAny = mainPartyAny.get(sourceRoomId);
          await (sourceRoomAny as any).fetch({
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "subscribe",
              consumerRoomId: this.room.id,
              elementIds,
            }),
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
    const store = syncedStore<{ play: Record<string, any> }>(
      { play: {} },
      doc as any
    );
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
    const store = syncedStore<{ play: Record<string, any> }>(
      { play: {} },
      doc as any
    );
    Object.entries(subtrees).forEach(([tag, elements]) => {
      // Ensure tag map exists
      // @ts-ignore
      store.play[tag] ??= {};
      Object.entries(elements).forEach(([elementId, data]) => {
        const tagObj = (store.play as any)[tag];
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
          const yExisting = getYjsValue(proxy) as any;
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

    const yOptions = {
      async load() {
        // This is called once per "room" when the first user connects

        // Let's make a Yjs document
        const doc = new Y.Doc();

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

        // Return the Yjs document
        return doc;
      },
      callback: {
        handler: async (doc: Y.Doc) => {
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
        },
      },
    } as const;

    this.providerOptions = yOptions;
    await onConnect(connection, this.room, yOptions);

    // Attach immediate-update observers once
    await this.attachImmediateBridgeObservers();
  }

  async onRequest(request: Party.Request): Promise<Response> {
    try {
      if (request.method !== "POST") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      const body = (await request.json()) as any;
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
        const existing: Array<{
          consumerRoomId: string;
          elementIds?: string[];
        }> = (await this.room.storage.get(STORAGE_KEYS.subscribers)) || [];
        if (!existing.find((s) => s.consumerRoomId === consumerRoomId)) {
          existing.push({ consumerRoomId, elementIds });
        } else {
          // Update elementIds if provided
          const idx = existing.findIndex(
            (s) => s.consumerRoomId === consumerRoomId
          );
          if (idx !== -1 && elementIds) existing[idx].elementIds = elementIds;
        }
        await this.room.storage.put(STORAGE_KEYS.subscribers, existing);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json" },
        });
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
        const yDoc = await unstable_getYDoc(
          this.room,
          this.providerOptions || { load: async () => null }
        );
        const isSourceRoom = await this.isSourceRoom();
        let subtreesToApply: Record<string, Record<string, any>> = subtrees;
        if (isSourceRoom) {
          // IMPORTANT: Only apply tags/elementIds that already exist in the source's doc to ensure
          // the source of truth is derived from the source room and not consumer-added capabilities.
          const play = (yDoc.getMap("play") as Y.Map<any>) || ({} as any);
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
              if (perms[elementId] === "read-only") {
                return; // skip writes to read-only elements
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
        const subscribers: Array<{
          consumerRoomId: string;
          elementIds?: string[];
        }> = (await this.room.storage.get(STORAGE_KEYS.subscribers)) || [];
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

  // Attach immediate observers to this room's doc to bridge changes without waiting for save callback
  private async attachImmediateBridgeObservers(): Promise<void> {
    if (this.observersAttached) return;
    const yDoc = await unstable_getYDoc(
      this.room,
      this.providerOptions || { load: async () => null }
    );

    // Source room: on change, push to each subscribed consumer immediately
    yDoc.on("update", async (_update: Uint8Array, origin: any) => {
      // Ignore updates we just applied from a consumer pull to avoid echo
      if (origin === ORIGIN_C2S) return;
      const subscribers: Array<{
        consumerRoomId: string;
        elementIds?: string[];
      }> = (await this.room.storage.get("subscribers")) || [];
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
}
