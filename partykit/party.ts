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
  // Flags to suppress echo loops
  private applyingFromPull = false; // consumer applying source->consumer (transaction scope)
  private applyingFromMirror = false; // source applying consumer->source (transaction scope)
  private suppressNextMirror = false; // suppress next consumer mirror in callback
  private suppressNextNotify = false; // suppress next source notify in callback
  // Reuse the exact same options for all Y.Doc access
  private providerOptions: import("y-partykit").YPartyKitOptions | undefined;

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
      for (const { sourceRoomId } of entries) {
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
          }),
        });
      }
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

          // If this is a SOURCE room and has subscribers, notify them to pull updates
          const subscribers: string[] =
            (await room.storage.get("subscribers")) || [];
          if (subscribers.length) {
            if (this.applyingFromMirror || this.suppressNextNotify) {
              console.log(
                `[bridge] source ${room.id} skipping notify (mirror/pull)`
              );
              this.suppressNextNotify = false;
            } else {
              console.log(
                `[bridge] source ${room.id} changed; notifying ${subscribers.length} consumers`
              );
              const mainParty = room.context.parties.main;
              await Promise.all(
                subscribers.map(async (consumerRoomId) => {
                  const consumerRoom = mainParty.get(consumerRoomId);
                  await consumerRoom.fetch({
                    method: "POST",
                    body: JSON.stringify({ action: "pull" }),
                  });
                })
              );
            }
          }

          // If this is a CONSUMER room with sharedReferences, mirror writes to the corresponding sources
          const refs: Array<{ sourceRoomId: string; elementIds: string[] }> =
            (await room.storage.get("sharedReferences")) || [];
          if (refs.length) {
            if (this.applyingFromPull || this.suppressNextMirror) {
              console.log(
                `[bridge] consumer ${room.id} skipping mirror (mirror/pull)`
              );
              this.suppressNextMirror = false;
            } else {
              console.log(
                `[bridge] consumer ${room.id} changed; mirroring to ${refs.length} source rooms`
              );
              const mainParty = room.context.parties.main;
              for (const { sourceRoomId, elementIds } of refs) {
                if (!elementIds?.length) continue;
                const subtrees = this.extractPlaySubtrees(
                  doc as Y.Doc,
                  new Set(elementIds)
                );
                if (!Object.keys(subtrees).length) continue;
                console.log(
                  `[bridge] consumer ${room.id} -> source ${sourceRoomId} applying subtrees for ${elementIds.length} elementIds`
                );
                const sourceRoom = mainParty.get(sourceRoomId);
                await sourceRoom.fetch({
                  method: "POST",
                  body: JSON.stringify({ action: "apply-subtrees", subtrees }),
                });
              }
            }
          }
        },
      },
    } as const;

    this.providerOptions = yOptions;
    await onConnect(connection, this.room, yOptions);

    // After the Yjs connection is set up, perform an initial pull for consumers
    if (sharedReferences.length) {
      await this.handlePull();
    }
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
        if (!consumerRoomId)
          return new Response("Bad Request", { status: 400 });
        const existing: string[] =
          (await this.room.storage.get("subscribers")) || [];
        if (!existing.includes(consumerRoomId)) {
          existing.push(consumerRoomId);
          await this.room.storage.put("subscribers", existing);
        }
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

      if (action === "apply-subtrees") {
        // Called on SOURCE room; applies provided subtrees into its Y.Doc
        const subtrees = (((body as any) || {}).subtrees || {}) as Record<
          string,
          Record<string, any>
        >;
        const yDoc = await unstable_getYDoc(
          this.room,
          this.providerOptions || { load: async () => null }
        );
        this.applyingFromMirror = true;
        try {
          yDoc.transact(() => this.assignPlaySubtrees(yDoc, subtrees));
        } finally {
          this.applyingFromMirror = false;
        }
        console.log(
          `[bridge] source ${this.room.id} applied subtrees: tags=${
            Object.keys(subtrees).length
          }`
        );
        // Proactively notify consumers to pull for lower latency
        const subscribers: string[] =
          (await this.room.storage.get("subscribers")) || [];
        if (subscribers.length) {
          const mainParty = this.room.context.parties.main;
          // Suppress the following consumer mirror triggered by pull
          this.suppressNextMirror = true;
          await Promise.all(
            subscribers.map(async (consumerRoomId) => {
              const consumerRoom = mainParty.get(consumerRoomId);
              await consumerRoom.fetch({
                method: "POST",
                body: JSON.stringify({ action: "pull" }),
              });
            })
          );
        }
        return new Response(JSON.stringify({ ok: true }));
      }

      if (action === "pull") {
        // Called on CONSUMER room; pulls from all registered sources and injects subtrees
        console.log(`[bridge] consumer ${this.room.id} received pull`);
        await this.handlePull();
        return new Response(JSON.stringify({ ok: true }));
      }

      return new Response("Bad Request", { status: 400 });
    } catch (err) {
      console.error("onRequest error", err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  // Pulls from all registered sources for this consumer room and injects into its doc
  private async handlePull(): Promise<void> {
    const entries: Array<{ sourceRoomId: string; elementIds: string[] }> =
      (await this.room.storage.get("sharedReferences")) || [];
    if (!entries.length) return;

    const mainParty = this.room.context.parties.main;
    const yDoc = await unstable_getYDoc(
      this.room,
      this.providerOptions || { load: async () => null }
    );

    for (const { sourceRoomId, elementIds } of entries) {
      const sourceRoom = mainParty.get(sourceRoomId);
      console.log(
        `[bridge] consumer ${this.room.id} pulling from source ${sourceRoomId} for ${elementIds.length} ids`
      );
      const res = await sourceRoom.fetch({
        method: "POST",
        body: JSON.stringify({ action: "export", elementIds }),
      });
      if (!res.ok) continue;
      const parsed = (await res.json()) as any;
      const subtrees = (parsed && parsed.subtrees) as Record<
        string,
        Record<string, any>
      >;
      if (!subtrees) continue;
      this.applyingFromPull = true;
      try {
        yDoc.transact(() => this.assignPlaySubtrees(yDoc, subtrees));
      } finally {
        this.applyingFromPull = false;
      }
      // Suppress the following source notify; it's caused by our own pull
      this.suppressNextNotify = true;
      console.log(
        `[bridge] consumer ${
          this.room.id
        } injected subtrees from ${sourceRoomId}: tags=${
          Object.keys(subtrees).length
        }`
      );
    }
  }
}
