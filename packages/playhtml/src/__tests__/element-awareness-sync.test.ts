// ABOUTME: Verifies element awareness snapshots stay current as peers update.
// ABOUTME: Covers removal paths so ephemeral user state does not linger.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playhtml, resetPlayHTML } from "../index";

function getCurrentProvider(): any {
  const providers = (globalThis as any).PLAYHTML_TEST_PROVIDERS as any[];
  const provider = providers?.[providers.length - 1];
  if (!provider) throw new Error("Expected test provider");
  return provider;
}

describe("element awareness sync", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    await playhtml.init({
      cursors: { enabled: false },
    });
  });

  afterEach(async () => {
    document.body.innerHTML = "";
    await resetPlayHTML();
  });

  it("clears a handler's awareness when the last peer leaves that element", async () => {
    const awarenessSnapshots: unknown[][] = [];
    const byStableIdSnapshots: Array<Map<string, unknown>> = [];

    const el = document.createElement("div");
    el.id = "presence-card";
    el.setAttribute("can-play", "");
    (el as any).defaultData = {};
    (el as any).updateElement = vi.fn();
    (el as any).updateElementAwareness = ({
      awareness,
      awarenessByStableId,
    }: any) => {
      awarenessSnapshots.push(awareness);
      byStableIdSnapshots.push(awarenessByStableId);
    };
    document.body.appendChild(el);
    await playhtml.setupPlayElementForTag(el, "can-play");

    const provider = getCurrentProvider();
    const states = provider.awareness.getStates();
    states.set(2, {
      __playhtml_identity__: { publicKey: "pk_remote" },
      "can-play": {
        "presence-card": { active: true },
      },
    });
    provider.emit("change", { added: [2], updated: [], removed: [] });

    expect(awarenessSnapshots.at(-1)).toEqual([{ active: true }]);
    expect(byStableIdSnapshots.at(-1)?.get("pk_remote")).toEqual({
      active: true,
    });

    states.delete(2);
    provider.emit("change", { added: [], updated: [], removed: [2] });

    expect(awarenessSnapshots.at(-1)).toEqual([]);
    expect(byStableIdSnapshots.at(-1)?.size).toBe(0);
  });
});
