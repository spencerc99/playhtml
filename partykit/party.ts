import type * as Party from "partykit/server";
import { onConnect, unstable_getYDoc } from "y-partykit";
import { createClient } from "@supabase/supabase-js";
import { syncedStore, getYjsValue } from "@syncedstore/core";
import { Buffer } from "node:buffer";
import * as Y from "yjs";

// Create a single supabase client for interacting with your database
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_KEY as string,
  { auth: { persistSession: false } }
);

export default class implements Party.Server {
  constructor(public room: Party.Room) {}
  // Reuse the exact same options for all Y.Doc access
  private providerOptions: import("y-partykit").YPartyKitOptions | undefined;
  private observersAttached = false;
  // @ts-expect-error
  private static readonly ORIGIN_S2C = "__bridge_s2c__";
  // @ts-expect-error
  private static readonly ORIGIN_C2S = "__bridge_c2s__";

  // --- Helper: normalize path used in room id derivation
  normalizePath(path: string): string {
    // strip file extension
    const cleaned = path.replace(/\.[^/.]+$/, "");
    return cleaned || "/";
  }

  // --- Helper: compute source room id from domain and path
  getSourceRoomId(domain: string, path: string): string {
    return encodeURIComponent(`${domain}-${this.normalizePath(path)}`);
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
          // @ts-ignore
          this.deepReplaceIntoProxy(proxy, data);
        } else {
          tagObj[elementId] = data;
        }
      });
    });
  }

  wrapPlainAsY(value: any): any {
    if (Array.isArray(value)) {
      const arr = new Y.Array<any>();
      arr.push(value.map((v) => this.wrapPlainAsY(v)));
      return arr;
    }
    if (value && typeof value === "object") {
      const map = new Y.Map<any>();
      Object.entries(value).forEach(([k, v]) => {
        map.set(k, this.wrapPlainAsY(v));
      });
      return map;
    }
    return value;
  }

  // --- Helpers to mutate SyncedStore proxies in-place (preserve Y types)
  private isPlainObject(value: any): value is Record<string, any> {
    return (
      value !== null &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype
    );
  }

  private deepReplaceIntoProxy(target: any, src: any) {
    if (src === null || src === undefined) return;
    if (Array.isArray(src)) {
      // Replace array contents in place
      target.splice(0, target.length, ...src);
      return;
    }
    if (this.isPlainObject(src)) {
      // Remove keys not present in src
      for (const key of Object.keys(target)) {
        if (!(key in src)) delete target[key];
      }
      // Set all keys from src
      for (const [k, v] of Object.entries(src)) {
        if (Array.isArray(v)) {
          if (!Array.isArray(target[k])) target[k] = [];
          this.deepReplaceIntoProxy(target[k], v);
        } else if (this.isPlainObject(v)) {
          if (!this.isPlainObject(target[k])) target[k] = {};
          this.deepReplaceIntoProxy(target[k], v);
        } else {
          target[k] = v;
        }
      }
      return;
    }
    // primitives: assign
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    target = src;
  }

  async onMessage(
    message: string | ArrayBuffer | ArrayBufferView,
    sender: Party.Connection<unknown>
  ): Promise<void> {
    if (typeof message === "string") {
      this.room.broadcast(message);
    }
  }

  async onConnect(connection: Party.Connection, ctx: Party.ConnectionContext) {
    const room = this.room;

    // Parse shared references from the connecting client (for consumer rooms)
    // Parse from the WebSocket request URL
    const sharedReferences = this.parseSharedReferencesFromUrl(ctx.request.url);
    if (sharedReferences.length) {
      console.log(
        `[bridge] consumer ${room.id} registering ${sharedReferences.length} shared references`
      );
    }

    // Persist consumer interest mapping for later pulls/mirroring
    if (sharedReferences.length) {
      // Group by sourceRoomId
      const bySource = new Map<string, Set<string>>();
      for (const ref of sharedReferences) {
        const srcId = this.getSourceRoomId(ref.domain, ref.path);
        const set = bySource.get(srcId) ?? new Set<string>();
        set.add(ref.elementId);
        bySource.set(srcId, set);
      }
      // Store mapping in this consumer room's storage
      const entries: Array<{ sourceRoomId: string; elementIds: string[] }> = [];
      bySource.forEach((ids, srcId) => {
        entries.push({ sourceRoomId: srcId, elementIds: Array.from(ids) });
      });
      await room.storage.put("sharedReferences", entries);

      // Register with each source room so it can notify us on changes
      for (const { sourceRoomId, elementIds } of entries) {
        const mainParty = room.context.parties.main;
        const sourceRoom = mainParty.get(sourceRoomId);
        console.log(
          `[bridge] consumer ${room.id} subscribing to source ${sourceRoomId}`
        );
        await sourceRoom.fetch({
          method: "POST",
          body: JSON.stringify({
            action: "subscribe",
            consumerRoomId: room.id,
            elementIds,
          }),
        });
      }
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
      await room.storage.put("sharedPermissions", permissionsByElementId);
      console.log(
        `[bridge] source ${room.id} registered ${
          Object.keys(permissionsByElementId).length
        } shared element permissions`
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
        const elementIds = (body && (body as any).elementIds) as
          | string[]
          | undefined;
        if (!consumerRoomId)
          return new Response("Bad Request", { status: 400 });
        const existing: Array<{
          consumerRoomId: string;
          elementIds?: string[];
        }> = (await this.room.storage.get("subscribers")) || [];
        if (!existing.find((s) => s.consumerRoomId === consumerRoomId)) {
          existing.push({ consumerRoomId, elementIds });
        } else {
          // Update elementIds if provided
          const idx = existing.findIndex(
            (s) => s.consumerRoomId === consumerRoomId
          );
          if (idx !== -1 && elementIds) existing[idx].elementIds = elementIds;
        }
        await this.room.storage.put("subscribers", existing);
        console.log(
          `[bridge] source ${this.room.id} subscribed consumer ${consumerRoomId} (total: ${existing.length})`
        );
        return new Response(JSON.stringify({ ok: true }));
      }

      if (action === "export") {
        // Called on SOURCE room; returns subtrees for requested elementIds across all tags
        const elementIds: string[] = Array.isArray((body as any)?.elementIds)
          ? (body as any).elementIds
          : [];
        const yDoc = await unstable_getYDoc(
          this.room,
          this.providerOptions || { load: async () => null }
        );
        const subtrees = this.extractPlaySubtrees(yDoc, new Set(elementIds));
        console.log(
          `[bridge] source ${this.room.id} export for ${
            elementIds.length
          } ids; tags: ${Object.keys(subtrees).length}`
        );
        return new Response(JSON.stringify({ subtrees }));
      }

      if (action === "export-permissions") {
        // Returns simple permissions (read-only/read-write) for requested elementIds
        const elementIds: string[] = Array.isArray((body as any)?.elementIds)
          ? (body as any).elementIds
          : [];
        const perms: Record<string, "read-only" | "read-write"> =
          (await this.room.storage.get("sharedPermissions")) || {};
        const filtered: Record<string, "read-only" | "read-write"> = {};
        for (const id of elementIds) {
          if (perms[id]) filtered[id] = perms[id];
        }
        return new Response(JSON.stringify({ permissions: filtered }));
      }

      // Removed legacy apply-subtrees; immediate path is used instead

      if (action === "apply-subtrees-immediate") {
        // Applies provided subtrees immediately and marks origin to suppress echo
        const subtrees = (((body as any) || {}).subtrees || {}) as Record<
          string,
          Record<string, any>
        >;
        const sender = (body && (body as any).sender) as string | undefined;
        const yDoc = await unstable_getYDoc(
          this.room,
          this.providerOptions || { load: async () => null }
        );
        const isSourceRoom = !!(await this.room.storage.get(
          "sharedPermissions"
        ));
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
            (await this.room.storage.get("sharedPermissions")) || {};
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
        const hasSharedRefs = !!(await this.room.storage.get(
          "sharedReferences"
        ));
        const ORIGIN = hasSharedRefs
          ? ((this.constructor as any).ORIGIN_S2C as string)
          : ((this.constructor as any).ORIGIN_C2S as string);
        yDoc.transact(
          () => this.assignPlaySubtrees(yDoc, subtreesToApply),
          ORIGIN
        );

        // If this is a SOURCE room, immediately fanout to other consumers (excluding sender if provided)
        const subscribers: Array<{
          consumerRoomId: string;
          elementIds?: string[];
        }> = (await this.room.storage.get("subscribers")) || [];
        if (isSourceRoom && subscribers.length) {
          const mainParty = this.room.context.parties.main;
          await Promise.all(
            subscribers.map(async ({ consumerRoomId }) => {
              if (sender && consumerRoomId === sender) return;
              const consumerRoom = mainParty.get(consumerRoomId);
              await consumerRoom.fetch({
                method: "POST",
                body: JSON.stringify({
                  action: "apply-subtrees-immediate",
                  subtrees: subtreesToApply,
                }),
              });
            })
          );
        }
        return new Response(JSON.stringify({ ok: true }));
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
      if (origin === (this.constructor as any).ORIGIN_C2S) return;
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
    const refs: Array<{ sourceRoomId: string; elementIds: string[] }> =
      (await this.room.storage.get("sharedReferences")) || [];
    if (refs.length) {
      yDoc.on("update", async (_update: Uint8Array, origin: any) => {
        // Ignore updates we just applied from a source push to avoid echo
        if (origin === (this.constructor as any).ORIGIN_S2C) return;
        const mainParty = this.room.context.parties.main;
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
    }

    this.observersAttached = true;
  }
}
