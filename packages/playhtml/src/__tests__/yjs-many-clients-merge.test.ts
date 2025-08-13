import { describe, it, expect } from "vitest";
import * as Y from "yjs";

type Client = { id: number; doc: Y.Doc; root: Y.Map<any> };

function createClient(id: number): Client {
  const doc = new Y.Doc();
  const root = doc.getMap("root");
  return { id, doc, root };
}

function bootstrapSharedStructure(clients: Client[]) {
  // Create containers once on client 0, then sync to all so type identity is shared
  const c0 = clients[0];
  const root0 = c0.root;
  const arrays = new Y.Map<any>();
  const maps = new Y.Map<any>();
  const nested = new Y.Map<any>();
  nested.set("a", new Y.Map<any>());
  nested.set("m", new Y.Map<any>());
  root0.set("arrays", arrays);
  root0.set("maps", maps);
  root0.set("nested", nested);
  syncAll(clients);
}

function offlineEdits(c: Client, edits: number) {
  const id = String(c.id);
  const arrays = c.root.get("arrays") as Y.Map<any>;
  const maps = c.root.get("maps") as Y.Map<any>;
  const nested = c.root.get("nested") as Y.Map<any>;
  // Ensure per-client substructures exist in shared containers
  if (!arrays.get(id)) arrays.set(id, new Y.Array<string>());
  if (!maps.get(id)) maps.set(id, new Y.Map<any>());
  const nestedA = nested.get("a") as Y.Map<any>;
  const nestedM = nested.get("m") as Y.Map<any>;
  if (!nestedA.get(id)) nestedA.set(id, new Y.Array<string>());
  if (!nestedM.get(id)) nestedM.set(id, new Y.Map<any>());

  const arr = arrays.get(id) as Y.Array<string>;
  const map = maps.get(id) as Y.Map<any>;
  const b = nestedA.get(id) as Y.Array<string>;
  const mm = nestedM.get(id) as Y.Map<any>;

  for (let i = 0; i < edits; i++) {
    arr.push([`${id}-arr-${i}`]);
    map.set(`${id}-k-${i}`, i);
    b.push([`${id}-b-${i}`]);
    mm.set(`${id}-mk-${i}`, i * 2);
  }
}

function syncAll(clients: Client[]) {
  // naive pairwise sync to ensure structure maps carry through
  for (let i = 0; i < clients.length; i++) {
    for (let j = i + 1; j < clients.length; j++) {
      const ui = Y.encodeStateAsUpdate(clients[i].doc);
      Y.applyUpdate(clients[j].doc, ui);
      const uj = Y.encodeStateAsUpdate(clients[j].doc);
      Y.applyUpdate(clients[i].doc, uj);
    }
  }
}

describe("Yjs many-clients merge (disjoint namespaces)", () => {
  it("merges edits across 10 clients with complex structure", () => {
    const N = 10;
    const editsPerClient = 200;
    const clients = Array.from({ length: N }, (_, i) => createClient(i));
    // Create shared containers first
    bootstrapSharedStructure(clients);
    // offline edits
    clients.forEach((c) => offlineEdits(c, editsPerClient));
    // sync
    syncAll(clients);

    // verify on client 0
    const c0 = clients[0];
    const arrays = c0.root.get("arrays") as Y.Map<any>;
    const maps = c0.root.get("maps") as Y.Map<any>;
    const nested = c0.root.get("nested") as Y.Map<any>;
    const allArrayLens = Array.from(
      { length: N },
      (_, i) => (arrays.get(String(i)) as Y.Array<any>)?.length ?? 0
    );
    const allMapLens = Array.from(
      { length: N },
      (_, i) => (maps.get(String(i)) as Y.Map<any>)?.size ?? 0
    );
    const nestedA = nested.get("a") as Y.Map<any>;
    const nestedM = nested.get("m") as Y.Map<any>;
    const nestedALens = Array.from(
      { length: N },
      (_, i) => (nestedA.get(String(i)) as Y.Array<any>)?.length ?? 0
    );
    const nestedMLens = Array.from(
      { length: N },
      (_, i) => (nestedM.get(String(i)) as Y.Map<any>)?.size ?? 0
    );

    allArrayLens.forEach((len) => expect(len).toBe(editsPerClient));
    allMapLens.forEach((len) => expect(len).toBe(editsPerClient));
    nestedALens.forEach((len) => expect(len).toBe(editsPerClient));
    nestedMLens.forEach((len) => expect(len).toBe(editsPerClient));
  });
});
