// ABOUTME: Checks element-awareness shard packing against a straightforward reference.
// ABOUTME: Generated inputs must split into byte-identical shards under the 4KB cap.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PRESENCE_VALUE_BYTES } from "@playhtml/common";
import { buildElementPresenceShards } from "../element-awareness";

function jsonByteLength(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return Infinity;
    return new TextEncoder().encode(json).byteLength;
  } catch {
    return Infinity;
  }
}

// Reference packing: re-measure the whole candidate shard for every entry.
function referenceShards(localTags: Map<string, Record<string, unknown>>) {
  const make = (entries: unknown[]) => ({ v: 1, at: Date.now(), entries });
  const sorted: unknown[] = [];
  for (const tag of Array.from(localTags.keys()).sort()) {
    const tagMap = localTags.get(tag)!;
    for (const elementId of Object.keys(tagMap).sort()) {
      sorted.push([tag, elementId, tagMap[elementId]]);
    }
  }
  const shards: unknown[] = [];
  let entries: unknown[] = [];
  for (const entry of sorted) {
    const candidate = [...entries, entry];
    if (
      entries.length > 0 &&
      jsonByteLength(make(candidate)) > MAX_PRESENCE_VALUE_BYTES
    ) {
      shards.push(make(entries));
      entries = [entry];
    } else {
      entries = candidate;
    }
  }
  if (entries.length > 0) shards.push(make(entries));
  return shards;
}

// Small deterministic PRNG so failures reproduce.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function randomValue(next: () => number): unknown {
  const kind = Math.floor(next() * 6);
  const len = Math.floor(next() * next() * 3000);
  switch (kind) {
    case 0:
      return "x".repeat(len);
    case 1:
      // Multi-byte characters so UTF-8 length differs from string length.
      return { label: "é✓".repeat(Math.floor(len / 3)), n: len };
    case 2:
      return Array.from({ length: len % 40 }, (_, i) => i * next());
    case 3:
      return undefined;
    case 4:
      return {
        nested: { ok: next() > 0.5, text: '"quoted"\n'.repeat(len % 200) },
      };
    default:
      return null;
  }
}

function generateTags(seed: number): Map<string, Record<string, unknown>> {
  const next = rng(seed);
  const tags = new Map<string, Record<string, unknown>>();
  const tagCount = 1 + Math.floor(next() * 4);
  for (let t = 0; t < tagCount; t++) {
    const record: Record<string, unknown> = {};
    const count = Math.floor(next() * 60);
    for (let i = 0; i < count; i++) {
      record[`el-${Math.floor(next() * 1e6)}`] = randomValue(next);
    }
    tags.set(`can-tag-${t}`, record);
  }
  return tags;
}

describe("buildElementPresenceShards", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_731_300_000_000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("matches the reference packing byte for byte on generated inputs", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const tags = generateTags(seed);
      const actual = buildElementPresenceShards(tags);
      expect(JSON.stringify(actual)).toBe(
        JSON.stringify(referenceShards(tags)),
      );
      for (const shard of actual) {
        if (shard.entries.length > 1) {
          expect(jsonByteLength(shard)).toBeLessThanOrEqual(
            MAX_PRESENCE_VALUE_BYTES,
          );
        }
      }
    }
  });

  it("isolates an unserializable value in its own shard like the reference", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const tags = new Map<string, Record<string, unknown>>([
      ["can-a", { a: "one", b: cyclic, c: "three", d: 10n as unknown }],
    ]);
    const actual = buildElementPresenceShards(tags);
    const expected = referenceShards(tags) as Array<{ entries: unknown[] }>;
    expect(actual.map((s) => s.entries.map((e) => e[1]))).toEqual(
      expected.map((s) => s.entries.map((e) => (e as unknown[])[1])),
    );
  });
});
