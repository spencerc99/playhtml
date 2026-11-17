// ABOUTME: Checks documentContainsSnapshot against a slow apply-and-compare oracle.
// ABOUTME: Generates seeded random two-client Yjs histories with overwrites, deletes and partial syncs.
import { describe, expect, it } from "bun:test";
import { Buffer } from "node:buffer";
import * as Y from "yjs";
import { documentContainsSnapshot } from "../docUtils";

type Random = () => number;

function seededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: Random, items: T[]): T {
  return items[Math.floor(random() * items.length)];
}

function toBase64(update: Uint8Array): string {
  return Buffer.from(update).toString("base64");
}

function normalizedDeleteSet(update: Uint8Array): string {
  const { ds } = Y.decodeUpdate(update);
  const clients = Array.from(ds.clients.entries())
    .map(([client, items]) => {
      const ranges = items
        .map((item) => [item.clock, item.len] as [number, number])
        .sort((a, b) => a[0] - b[0]);
      const merged: [number, number][] = [];
      for (const [clock, len] of ranges) {
        const last = merged[merged.length - 1];
        if (last && last[0] + last[1] >= clock) {
          last[1] = Math.max(last[0] + last[1], clock + len) - last[0];
        } else {
          merged.push([clock, len]);
        }
      }
      return [client, merged] as const;
    })
    .sort((a, b) => a[0] - b[0]);
  return JSON.stringify(clients);
}

function docState(doc: Y.Doc): string {
  const update = Y.encodeStateAsUpdate(doc);
  const shared: Record<string, unknown> = {};
  for (const name of ["root", "list"]) {
    shared[name] = (
      name === "root" ? doc.getMap(name) : doc.getArray(name)
    ).toJSON();
  }
  return JSON.stringify({
    stateVector: Array.from(Y.decodeStateVector(Y.encodeStateVector(doc))).sort(
      (a, b) => a[0] - b[0],
    ),
    deleteSet: normalizedDeleteSet(update),
    shared,
  });
}

// Applies the snapshot to a copy of the document and reports whether nothing
// changed: same state vector, same delete set, same content, nothing pending.
function oracleContains(document: Uint8Array, snapshot: Uint8Array): boolean {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, document);
  const before = docState(doc);
  Y.applyUpdate(doc, snapshot);
  const after = docState(doc);
  const store = (doc as any).store;
  const pending = store.pendingStructs !== null || store.pendingDs !== null;
  doc.destroy();
  return before === after && !pending;
}

function randomValue(random: Random): unknown {
  return pick(random, [
    () => Math.floor(random() * 100),
    () => `s${Math.floor(random() * 100)}`,
    () => ({ x: Math.floor(random() * 10), y: Math.floor(random() * 10) }),
    () => null,
  ])();
}

function containers(doc: Y.Doc): Array<Y.Map<unknown> | Y.Array<unknown>> {
  const found: Array<Y.Map<unknown> | Y.Array<unknown>> = [];
  const visit = (type: Y.Map<unknown> | Y.Array<unknown>) => {
    found.push(type);
    const children =
      type instanceof Y.Map ? Array.from(type.values()) : type.toArray();
    for (const child of children) {
      if (child instanceof Y.Map || child instanceof Y.Array) visit(child);
    }
  };
  visit(doc.getMap("root"));
  visit(doc.getArray("list"));
  return found;
}

function randomEdit(random: Random, doc: Y.Doc): void {
  const target = pick(random, containers(doc));
  const roll = random();
  if (target instanceof Y.Map) {
    const key = `k${Math.floor(random() * 4)}`;
    if (roll < 0.15 && target.size > 0) {
      target.delete(pick(random, Array.from(target.keys())));
    } else if (roll < 0.25) {
      target.set(key, new Y.Map());
    } else if (roll < 0.35) {
      target.set(key, Y.Array.from([randomValue(random)]));
    } else {
      target.set(key, randomValue(random));
    }
    return;
  }
  if (roll < 0.35 && target.length > 0) {
    const index = Math.floor(random() * target.length);
    const length =
      1 + Math.floor(random() * Math.min(3, target.length - index));
    target.delete(index, length);
  } else if (roll < 0.45) {
    target.insert(Math.floor(random() * (target.length + 1)), [new Y.Map()]);
  } else {
    const count = 1 + Math.floor(random() * 3);
    const values = Array.from({ length: count }, () => randomValue(random));
    target.insert(Math.floor(random() * (target.length + 1)), values);
  }
}

function randomHistory(seed: number): Uint8Array[] {
  const random = seededRandom(seed);
  const first = new Y.Doc();
  const second = new Y.Doc();
  first.clientID = 1 + (seed % 1000);
  second.clientID = 2000 + (seed % 1000);
  const checkpoints: Uint8Array[] = [];
  const steps = 5 + Math.floor(random() * 30);

  for (let step = 0; step < steps; step++) {
    const roll = random();
    if (roll < 0.1) {
      Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    } else if (roll < 0.2) {
      Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    } else {
      const doc = roll < 0.6 ? first : second;
      doc.transact(() => {
        const edits = 1 + Math.floor(random() * 3);
        for (let i = 0; i < edits; i++) randomEdit(random, doc);
      });
    }
    if (random() < 0.4) {
      checkpoints.push(Y.encodeStateAsUpdate(random() < 0.5 ? first : second));
    }
  }

  checkpoints.push(Y.encodeStateAsUpdate(first));
  checkpoints.push(Y.encodeStateAsUpdate(second));
  first.destroy();
  second.destroy();
  return checkpoints;
}

describe("documentContainsSnapshot randomized equivalence", () => {
  it("agrees with the apply-and-compare oracle across seeded histories", () => {
    let containedCount = 0;
    let missingCount = 0;
    let containedWithDeletions = 0;

    for (let seed = 1; seed <= 150; seed++) {
      const checkpoints = randomHistory(seed);
      for (const document of checkpoints) {
        for (const snapshot of checkpoints) {
          const expected = oracleContains(document, snapshot);
          const actual = documentContainsSnapshot(
            toBase64(document),
            toBase64(snapshot),
          );
          if (actual !== expected) {
            throw new Error(
              `seed=${seed} expected=${expected} actual=${actual} ` +
                `document=${toBase64(document)} snapshot=${toBase64(snapshot)}`,
            );
          }
          if (expected) {
            containedCount++;
            if (Y.decodeUpdate(snapshot).ds.clients.size > 0) {
              containedWithDeletions++;
            }
          } else {
            missingCount++;
          }
        }
      }
    }

    expect(containedCount).toBeGreaterThan(500);
    expect(missingCount).toBeGreaterThan(500);
    expect(containedWithDeletions).toBeGreaterThan(200);
  }, 30_000);

  it("detects a snapshot deletion the document lacks when the struct sets match", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = seededRandom(seed);
      const doc = new Y.Doc();
      doc.clientID = seed;
      for (let i = 0; i < 6; i++) {
        doc.transact(() => randomEdit(random, doc));
      }
      const document = Y.encodeStateAsUpdate(doc);
      const fork = new Y.Doc();
      Y.applyUpdate(fork, document);
      const list = fork.getArray("list");
      if (list.length === 0) {
        doc.destroy();
        fork.destroy();
        continue;
      }
      // Deleting without inserting adds no structs, only a delete-set range.
      list.delete(Math.floor(random() * list.length), 1);
      const snapshot = Y.encodeStateAsUpdate(fork);

      expect(oracleContains(document, snapshot)).toBe(false);
      expect(
        documentContainsSnapshot(toBase64(document), toBase64(snapshot)),
      ).toBe(false);
      expect(
        documentContainsSnapshot(toBase64(snapshot), toBase64(document)),
      ).toBe(true);
      doc.destroy();
      fork.destroy();
    }
  });
});
