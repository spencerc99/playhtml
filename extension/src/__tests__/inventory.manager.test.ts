// ABOUTME: Tests the InventoryManager-built InventoryAPI: register/list/arm/disarm/count guards.
// ABOUTME: Wires registry + armed-state + held-store; pure aside from storage load.

import { describe, it, expect, beforeEach, vi } from "vitest";
import browser from "webextension-polyfill";
import { InventoryManager } from "../features/inventory/InventoryManager";
import type { Item } from "../features/inventory/types";

const tape: Item = { id: "tape", tier: "system", label: "Tape", icon: "tape.png" };
const beacon: Item = { id: "beacon", tier: "found", label: "Beacon", icon: "beacon.png" };

async function makeApi() {
  const m = new InventoryManager();
  await m.load();
  return m.api;
}

describe("InventoryManager API", () => {
  beforeEach(() => {
    // ensure load() reads an empty store (found counts start at 0)
    (browser.storage.local.get as ReturnType<typeof vi.fn>).mockResolvedValue({});
  });

  it("registers and lists", async () => {
    const api = await makeApi();
    api.register(tape);
    expect(api.list().map((i) => i.id)).toEqual(["tape"]);
  });

  it("system items have Infinity count; unknown found items 0", async () => {
    const api = await makeApi();
    api.register(tape);
    api.register(beacon);
    expect(api.count("tape")).toBe(Infinity);
    expect(api.count("beacon")).toBe(0);
  });

  it("arm/getArmed/disarm and onArmedChange notify", async () => {
    const api = await makeApi();
    api.register(tape);
    const cb = vi.fn();
    api.onArmedChange(cb);
    api.arm("tape");
    expect(api.getArmed()).toEqual({ itemId: "tape" });
    api.disarm();
    expect(api.getArmed()).toBeNull();
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("arming an unregistered item is a no-op", async () => {
    const api = await makeApi();
    api.arm("ghost");
    expect(api.getArmed()).toBeNull();
  });

  it("arming a found item with 0 count is a no-op", async () => {
    const api = await makeApi();
    api.register(beacon); // count 0
    api.arm("beacon");
    expect(api.getArmed()).toBeNull();
  });
});
