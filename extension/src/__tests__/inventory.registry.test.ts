// ABOUTME: Tests for the inventory item registry (register/list, idempotent by id).
// ABOUTME: Pure logic, no DOM or storage.

import { describe, it, expect } from "vitest";
import { InventoryRegistry } from "../features/inventory/registry";
import type { Item } from "../features/inventory/types";

const tape: Item = { id: "tape", tier: "system", label: "Tape", icon: "tape.png" };
const bottle: Item = { id: "bottle", tier: "system", label: "Bottle", icon: "bottle.png" };

describe("InventoryRegistry", () => {
  it("lists registered items in order", () => {
    const r = new InventoryRegistry();
    r.register(tape);
    r.register(bottle);
    expect(r.list().map((i) => i.id)).toEqual(["tape", "bottle"]);
  });

  it("is idempotent by id (re-register replaces, keeps position)", () => {
    const r = new InventoryRegistry();
    r.register(tape);
    r.register(bottle);
    r.register({ ...tape, label: "Caution Tape" });
    expect(r.list().map((i) => i.id)).toEqual(["tape", "bottle"]);
    expect(r.get("tape")?.label).toBe("Caution Tape");
  });

  it("get returns undefined for unknown id", () => {
    const r = new InventoryRegistry();
    expect(r.get("nope")).toBeUndefined();
  });
});
