// ABOUTME: Tests two clients creating the same element or page-data record at once.
// ABOUTME: The client whose record loses the Yjs merge must keep syncing.
import { describe, it, expect, beforeAll, vi } from "vitest";
import * as Y from "yjs";

// Capture the real store playhtml creates so the test can merge a peer's
// updates into its doc, the same way the network provider would.
const playhtmlStores: any[] = [];
let capturingStores = true;
vi.mock("@syncedstore/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@syncedstore/core")>();
  return {
    ...actual,
    syncedStore: (...args: Parameters<typeof actual.syncedStore>) => {
      const created = actual.syncedStore(...args);
      if (capturingStores) playhtmlStores.push(created);
      return created;
    },
  };
});

const { playhtml, elementHandlers } = await import("../index");
const { syncedStore, getYjsDoc } = await import(
  "@syncedstore/core"
);

const TAG = "can-toggle";
// Yjs resolves concurrent writes to one map key in favor of the higher
// client id, so peers near the largest uint32 always win. Each peer gets its
// own id so peers from earlier tests don't share a clock.
let nextWinningClientId = 2 ** 32 - 1;

function localDoc(): Y.Doc {
  return getYjsDoc(playhtmlStores[playhtmlStores.length - 1]);
}

function localRecord(id: string): Y.Map<any> {
  return (localDoc().getMap("play").get(TAG) as Y.Map<any>).get(
    id,
  ) as Y.Map<any>;
}

function mountToggle(id: string): HTMLElement {
  const el = document.createElement("div");
  el.id = id;
  el.setAttribute(TAG, "");
  document.body.appendChild(el);
  playhtml.setupPlayElementForTag(el, TAG);
  return el;
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeAll(async () => {
  await playhtml.init({});
  await flush();
  capturingStores = false;
});

describe("concurrent first registration of the same element id", () => {
  async function setUpLostRace(id: string) {
    // Make sure the tag map already exists on both clients so only the
    // element record itself is created concurrently.
    mountToggle(`${id}-warmup`);
    const peerDoc = new Y.Doc();
    peerDoc.clientID = nextWinningClientId--;
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc()));
    const peerStore = syncedStore({ play: {} as any }, peerDoc);

    // Both clients create the record without having seen the other's.
    mountToggle(id);
    const localRecordBeforeMerge = localRecord(id);
    (peerStore.play as any)[TAG][id] = { on: false };

    const syncPeerToLocal = () => {
      Y.applyUpdate(
        localDoc(),
        Y.encodeStateAsUpdate(peerDoc, Y.encodeStateVector(localDoc())),
      );
    };
    syncPeerToLocal();
    await flush();

    // Precondition: the local record lost the merge and was replaced.
    expect(localRecord(id)).not.toBe(localRecordBeforeMerge);

    return { peerStore, peerDoc, syncPeerToLocal };
  }

  it("receives peer writes after its own record loses the merge", async () => {
    const id = "race-receive";
    const { peerStore, syncPeerToLocal } = await setUpLostRace(id);

    (peerStore.play as any)[TAG][id].on = true;
    syncPeerToLocal();
    await flush();

    expect((playhtml.syncedStore as any)[TAG][id].on).toBe(true);
    expect(elementHandlers.get(TAG)!.get(id)!.data).toEqual({ on: true });
  });

  it("writes into the surviving record after its own record loses the merge", async () => {
    const id = "race-write";
    const { peerDoc } = await setUpLostRace(id);

    elementHandlers.get(TAG)!.get(id)!.setData({ on: true });
    await flush();

    expect((playhtml.syncedStore as any)[TAG][id].on).toBe(true);
    Y.applyUpdate(
      peerDoc,
      Y.encodeStateAsUpdate(localDoc(), Y.encodeStateVector(peerDoc)),
    );
    const peerRecord = (peerDoc.getMap("play").get(TAG) as Y.Map<any>).get(
      id,
    ) as Y.Map<any>;
    expect(peerRecord.get("on")).toBe(true);
  });

  it("keeps syncing when the whole tag map loses the merge", async () => {
    // First can-spin element on both clients: the tag map itself is created
    // concurrently, not just the element record.
    const tag = "can-spin";
    const id = "race-tag";
    const peerDoc = new Y.Doc();
    peerDoc.clientID = nextWinningClientId--;
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc()));
    const peerStore = syncedStore({ play: {} as any }, peerDoc);

    const el = document.createElement("div");
    el.id = id;
    el.setAttribute(tag, "");
    document.body.appendChild(el);
    playhtml.setupPlayElementForTag(el, tag);
    const localTagMapBeforeMerge = localDoc().getMap("play").get(tag);
    (peerStore.play as any)[tag] = { [id]: { rotation: 0 } };

    const syncPeerToLocal = () =>
      Y.applyUpdate(
        localDoc(),
        Y.encodeStateAsUpdate(peerDoc, Y.encodeStateVector(localDoc())),
      );
    syncPeerToLocal();
    await flush();
    expect(localDoc().getMap("play").get(tag)).not.toBe(
      localTagMapBeforeMerge,
    );

    (peerStore.play as any)[tag][id].rotation = 90;
    syncPeerToLocal();
    await flush();
    expect(elementHandlers.get(tag)!.get(id)!.data).toEqual({ rotation: 90 });

    elementHandlers.get(tag)!.get(id)!.setData({ rotation: 180 });
    await flush();
    Y.applyUpdate(
      peerDoc,
      Y.encodeStateAsUpdate(localDoc(), Y.encodeStateVector(peerDoc)),
    );
    expect((peerStore.play as any)[tag][id].rotation).toBe(180);
  });
});

describe("concurrent first creation of the same page-data channel", () => {
  const PAGE_TAG = "__page__";

  function peerFromLocal() {
    const peerDoc = new Y.Doc();
    peerDoc.clientID = nextWinningClientId--;
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(localDoc()));
    const peerStore = syncedStore({ play: {} as any }, peerDoc);
    const syncPeerToLocal = () =>
      Y.applyUpdate(
        localDoc(),
        Y.encodeStateAsUpdate(peerDoc, Y.encodeStateVector(localDoc())),
      );
    const syncLocalToPeer = () =>
      Y.applyUpdate(
        peerDoc,
        Y.encodeStateAsUpdate(localDoc(), Y.encodeStateVector(peerDoc)),
      );
    return { peerStore, syncPeerToLocal, syncLocalToPeer };
  }

  // Runs first in this block: no channel exists yet, so the page-data map
  // itself is created concurrently.
  it("keeps syncing when the whole page-data map loses the merge", async () => {
    const name = "race-page-map";
    const { peerStore, syncPeerToLocal, syncLocalToPeer } = peerFromLocal();
    expect(localDoc().getMap("play").get(PAGE_TAG)).toBeUndefined();

    const channel = playhtml.createPageData(name, { count: 0 });
    const updates: Array<{ count: number }> = [];
    channel.onUpdate((value) => updates.push(value));
    const localMapBeforeMerge = localDoc().getMap("play").get(PAGE_TAG);
    (peerStore.play as any)[PAGE_TAG] = { [name]: { count: 0 } };
    syncPeerToLocal();
    await flush();
    expect(localDoc().getMap("play").get(PAGE_TAG)).not.toBe(
      localMapBeforeMerge,
    );

    (peerStore.play as any)[PAGE_TAG][name].count = 1;
    syncPeerToLocal();
    await flush();
    expect(channel.getData()).toEqual({ count: 1 });
    expect(updates.at(-1)).toEqual({ count: 1 });

    channel.setData((draft) => {
      draft.count = 2;
    });
    await flush();
    syncLocalToPeer();
    expect((peerStore.play as any)[PAGE_TAG][name].count).toBe(2);
    channel.destroy();
  });

  it("writes into the surviving value when a channel's value loses the merge", async () => {
    const name = "race-page-value";
    const { peerStore, syncPeerToLocal, syncLocalToPeer } = peerFromLocal();

    const channel = playhtml.createPageData(name, { count: 0 });
    const localValueBeforeMerge = (
      localDoc().getMap("play").get(PAGE_TAG) as Y.Map<any>
    ).get(name);
    (peerStore.play as any)[PAGE_TAG][name] = { count: 0 };
    syncPeerToLocal();
    await flush();
    expect(
      (localDoc().getMap("play").get(PAGE_TAG) as Y.Map<any>).get(name),
    ).not.toBe(localValueBeforeMerge);

    channel.setData((draft) => {
      draft.count = 3;
    });
    await flush();
    expect(channel.getData()).toEqual({ count: 3 });
    syncLocalToPeer();
    expect((peerStore.play as any)[PAGE_TAG][name].count).toBe(3);
    channel.destroy();
  });
});
