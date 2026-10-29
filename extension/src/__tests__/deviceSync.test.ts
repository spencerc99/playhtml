// ABOUTME: Tests that Safari's copy of the extension and the iPhone app's copy converge through sync.
// ABOUTME: Runs both sides against one in-memory shared folder with fake stores.

import { describe, expect, it } from "vitest";
import type { CollectionEvent } from "@playhtml/extension-types";
import type { CollageRecord } from "../entrypoints/scraps/collageRecord";
import {
  SYNC_DELETIONS_KEY,
  collagesToSave,
  mergeDeletions,
  newDeletions,
  pickSharedSettings,
  runDeviceSync,
  shouldAdopt,
  type SyncDeps,
} from "../sync/deviceSync";
import type { SharedContainer, SyncSide } from "../sync/sharedContainer";

function sharedFolder() {
  const files = new Map<string, { bytes: Uint8Array; modified: number }>();
  let clock = 1_000;
  return function containerFor(side: SyncSide): SharedContainer {
    return {
      side,
      async stat(name) {
        const file = files.get(name);
        return file
          ? { size: file.bytes.length, modified: file.modified }
          : null;
      },
      async read(name) {
        const file = files.get(name);
        return file ? { bytes: file.bytes, modified: file.modified } : null;
      },
      async write(name, bytes) {
        clock += 1;
        files.set(name, { bytes, modified: clock });
      },
    };
  };
}

function event(
  id: string,
  ts: number,
  type: CollectionEvent["type"] = "navigation",
): CollectionEvent {
  return {
    id,
    ts,
    type,
    data: {},
    meta: {
      pid: "p",
      sid: "s",
      url: "https://example.com/",
      vw: 1,
      vh: 1,
      tz: "UTC",
    },
  } as unknown as CollectionEvent;
}

function collage(id: string, updatedAt: number, extra = {}): CollageRecord {
  return {
    id,
    updatedAt,
    title: id,
    pieces: [],
    ...extra,
  } as unknown as CollageRecord;
}

function identity(publicKey: string) {
  return {
    public: { publicKey, playerStyle: {} },
    privateKey: `${publicKey}-private`,
  };
}

const clock = { now: 5_000 };

function side(
  container: SharedContainer,
  storage: Record<string, unknown> = {},
) {
  const events = new Map<string, CollectionEvent>();
  const collages = new Map<string, CollageRecord>();
  const deps: SyncDeps = {
    container,
    store: {
      async eventSummary() {
        const all = [...events.values()];
        return {
          count: all.length,
          newest: all.reduce((max, entry) => Math.max(max, entry.ts), 0),
        };
      },
      async getAllEvents() {
        return [...events.values()];
      },
      async addSyncedEvents(incoming) {
        const stored = incoming.filter((entry) => !events.has(entry.id));
        for (const entry of stored) events.set(entry.id, entry);
        return stored;
      },
      async deleteScrapEvents(ids) {
        let deleted = 0;
        for (const id of ids) if (events.delete(id)) deleted += 1;
        return deleted;
      },
    },
    collages: {
      async list() {
        return [...collages.values()].map(({ id, updatedAt }) => ({
          id,
          updatedAt,
        }));
      },
      async load(id) {
        return collages.get(id) ?? null;
      },
      async save(record) {
        collages.set(record.id, record);
      },
      async remove(id) {
        collages.delete(id);
      },
      async encode(record) {
        const { publication: _dropped, ...kept } = record as CollageRecord & {
          publication?: unknown;
        };
        return JSON.stringify(kept);
      },
      decode: (text) => JSON.parse(text) as CollageRecord,
    },
    storage: {
      async get(keys) {
        if (keys === null) return { ...storage };
        return Object.fromEntries(keys.map((key) => [key, storage[key]]));
      },
      async set(items) {
        Object.assign(storage, items);
      },
      async remove(keys) {
        for (const key of keys) delete storage[key];
      },
    },
    now: () => clock.now,
  };
  return { deps, events, collages, storage };
}

describe("shouldAdopt", () => {
  it("takes the other side's identity when this side was never set up", () => {
    expect(
      shouldAdopt(
        { onboarded: false, publicKey: "minted" },
        { side: "safari", onboarded: true, publicKey: "safari" },
      ),
    ).toBe(true);
  });

  it("keeps Safari's identity when both sides were set up as different people", () => {
    expect(
      shouldAdopt(
        { onboarded: true, publicKey: "app" },
        { side: "safari", onboarded: true, publicKey: "safari" },
      ),
    ).toBe(true);
    expect(
      shouldAdopt(
        { onboarded: true, publicKey: "safari" },
        { side: "app", onboarded: true, publicKey: "app" },
      ),
    ).toBe(false);
  });

  it("never takes an identity from a side that was not set up", () => {
    expect(
      shouldAdopt(
        { onboarded: false, publicKey: null },
        { side: "safari", onboarded: false, publicKey: "safari" },
      ),
    ).toBe(false);
  });
});

describe("deletions and collages", () => {
  it("merges deletions keeping the later time, and finds the new ones", () => {
    const before = { scraps: { a: 1 }, collages: {} };
    const merged = mergeDeletions(before, {
      scraps: { a: 3, b: 2 },
      collages: { c: 4 },
    });
    expect(merged).toEqual({ scraps: { a: 3, b: 2 }, collages: { c: 4 } });
    expect(newDeletions(before, merged)).toEqual({
      scraps: ["b"],
      collages: ["c"],
    });
  });

  it("saves only newer collages that were not deleted since", () => {
    const saved = collagesToSave(
      [{ id: "held", updatedAt: 10 }],
      [
        collage("held", 5),
        collage("newer", 20),
        collage("gone", 7),
        collage("held", 11),
      ],
      { scraps: {}, collages: { gone: 8 } },
    );
    expect(saved.map((record) => [record.id, record.updatedAt])).toEqual([
      ["newer", 20],
      ["held", 11],
    ]);
  });

  it("shares only identity and setup choices", () => {
    expect(
      Object.keys(
        pickSharedSettings({
          playerIdentity: 1,
          onboarding_complete: "true",
          collection_mode_cursor: "local",
          setup_email: "a@b.c",
          wwoSyncProgress: {},
          featureAccess: {},
        }),
      ).sort(),
    ).toEqual([
      "collection_mode_cursor",
      "onboarding_complete",
      "playerIdentity",
      "setup_email",
    ]);
  });
});

describe("runDeviceSync", () => {
  it("brings the app up to Safari's identity, history and collages", async () => {
    const folder = sharedFolder();
    const safari = side(folder("safari"), {
      playerIdentity: identity("safari"),
      onboarding_complete: "true",
      collection_mode_cursor: "local",
    });
    safari.events.set("n1", event("n1", 100));
    safari.events.set("s1", event("s1", 200, "element"));
    safari.collages.set(
      "c1",
      collage("c1", 50, { publication: { token: "t" } }),
    );

    const app = side(folder("app"), { playerIdentity: identity("minted") });

    await runDeviceSync(safari.deps);
    const result = await runDeviceSync(app.deps);

    expect(result.adoptedIdentity).toBe(true);
    expect(app.storage.playerIdentity).toEqual(identity("safari"));
    expect(app.storage.onboarding_complete).toBe("true");
    expect(app.storage.collection_mode_cursor).toBe("local");
    expect(result.importedEvents).toBe(2);
    expect(result.importedScraps.map((entry) => entry.id)).toEqual(["s1"]);
    expect([...app.events.keys()].sort()).toEqual(["n1", "s1"]);
    expect(app.collages.get("c1")?.updatedAt).toBe(50);
    // The shared link's delete token stays with the side that shared it.
    expect(app.collages.get("c1")).not.toHaveProperty("publication");
  });

  it("carries the app's new history and collages back to Safari", async () => {
    const folder = sharedFolder();
    const safari = side(folder("safari"), {
      playerIdentity: identity("safari"),
      onboarding_complete: "true",
    });
    const app = side(folder("app"));
    await runDeviceSync(safari.deps);
    await runDeviceSync(app.deps);

    app.events.set("a1", event("a1", 300, "element"));
    app.collages.set("c2", collage("c2", 60));
    await runDeviceSync(app.deps);
    const result = await runDeviceSync(safari.deps);

    expect(result.adoptedIdentity).toBe(false);
    expect(result.importedScraps.map((entry) => entry.id)).toEqual(["a1"]);
    expect(safari.collages.has("c2")).toBe(true);
    expect(safari.storage.playerIdentity).toEqual(identity("safari"));
  });

  it("keeps a newer local edit and the local share token", async () => {
    const folder = sharedFolder();
    const safari = side(folder("safari"));
    const app = side(folder("app"));
    safari.collages.set("c", collage("c", 10, { title: "old" }));
    app.collages.set("c", collage("c", 5, { publication: { token: "mine" } }));

    await runDeviceSync(safari.deps);
    await runDeviceSync(app.deps);

    expect(app.collages.get("c")).toMatchObject({
      updatedAt: 10,
      publication: { token: "mine" },
    });
    safari.collages.set("c", collage("c", 3));
    await runDeviceSync(safari.deps);
    await runDeviceSync(app.deps);
    expect(app.collages.get("c")?.updatedAt).toBe(10);
  });

  it("carries out deletions made on the other side instead of bringing things back", async () => {
    const folder = sharedFolder();
    const safari = side(folder("safari"));
    const app = side(folder("app"));
    safari.events.set("s1", event("s1", 100, "element"));
    safari.collages.set("c1", collage("c1", 10));
    await runDeviceSync(safari.deps);
    await runDeviceSync(app.deps);
    expect(app.events.has("s1")).toBe(true);

    app.events.delete("s1");
    app.collages.delete("c1");
    app.storage[SYNC_DELETIONS_KEY] = {
      scraps: { s1: 400 },
      collages: { c1: 400 },
    };
    await runDeviceSync(app.deps);
    await runDeviceSync(safari.deps);

    expect(safari.events.has("s1")).toBe(false);
    expect(safari.collages.has("c1")).toBe(false);

    await runDeviceSync(safari.deps);
    await runDeviceSync(app.deps);
    expect(app.events.has("s1")).toBe(false);
    expect(app.collages.has("c1")).toBe(false);
  });

  it("leaves the shared files alone when nothing changed", async () => {
    const folder = sharedFolder();
    const safari = side(folder("safari"));
    safari.events.set("n1", event("n1", 100));
    await runDeviceSync(safari.deps);
    const before = await safari.deps.container.stat("safari.events");
    const stateBefore = await safari.deps.container.stat("safari.state");

    await runDeviceSync(safari.deps);

    expect(await safari.deps.container.stat("safari.events")).toEqual(before);
    expect(await safari.deps.container.stat("safari.state")).toEqual(
      stateBefore,
    );
  });

  it("carries a later change to a setup choice to the other side", async () => {
    const folder = sharedFolder();
    const safari = side(folder("safari"), {
      playerIdentity: identity("safari"),
      onboarding_complete: "true",
      collection_mode_cursor: "local",
    });
    const app = side(folder("app"));
    await runDeviceSync(safari.deps);
    await runDeviceSync(app.deps);
    await runDeviceSync(safari.deps);
    expect(app.storage.collection_mode_cursor).toBe("local");

    clock.now += 1_000;
    app.storage.collection_mode_cursor = "off";
    await runDeviceSync(app.deps);
    await runDeviceSync(safari.deps);
    expect(safari.storage.collection_mode_cursor).toBe("off");

    // Safari's older value does not flip it back.
    await runDeviceSync(app.deps);
    expect(app.storage.collection_mode_cursor).toBe("off");

    clock.now += 1_000;
    safari.storage.collection_mode_cursor = "shared";
    await runDeviceSync(safari.deps);
    await runDeviceSync(app.deps);
    expect(app.storage.collection_mode_cursor).toBe("shared");
  });

  it("keeps a collage edited here after the other side deleted it", async () => {
    const folder = sharedFolder();
    const safari = side(folder("safari"));
    const app = side(folder("app"));
    safari.collages.set("c1", collage("c1", 10));
    await runDeviceSync(safari.deps);
    await runDeviceSync(app.deps);

    app.collages.delete("c1");
    app.storage[SYNC_DELETIONS_KEY] = { scraps: {}, collages: { c1: 20 } };
    safari.collages.set("c1", collage("c1", 30));
    await runDeviceSync(app.deps);
    await runDeviceSync(safari.deps);
    expect(safari.collages.get("c1")?.updatedAt).toBe(30);

    // And the newer edit comes back to the side that deleted the older one.
    await runDeviceSync(app.deps);
    expect(app.collages.get("c1")?.updatedAt).toBe(30);
  });

  it("clears a forgotten email on the other side too", async () => {
    const folder = sharedFolder();
    const safari = side(folder("safari"), {
      playerIdentity: identity("safari"),
      onboarding_complete: "true",
      setup_email: "me@example.com",
    });
    const app = side(folder("app"));
    await runDeviceSync(safari.deps);
    await runDeviceSync(app.deps);
    await runDeviceSync(safari.deps);
    expect(app.storage.setup_email).toBe("me@example.com");

    clock.now += 1_000;
    delete app.storage.setup_email;
    await runDeviceSync(app.deps);
    await runDeviceSync(safari.deps);
    expect(safari.storage).not.toHaveProperty("setup_email");

    await runDeviceSync(app.deps);
    expect(app.storage).not.toHaveProperty("setup_email");

    // Setting it again later carries over as before.
    clock.now += 1_000;
    safari.storage.setup_email = "new@example.com";
    await runDeviceSync(safari.deps);
    await runDeviceSync(app.deps);
    expect(app.storage.setup_email).toBe("new@example.com");
  });
});
