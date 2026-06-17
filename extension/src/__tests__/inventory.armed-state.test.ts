// ABOUTME: Tests for armed-tool state — arm/disarm, getArmed, and subscriber notifications.
// ABOUTME: Pure logic, no DOM.

import { describe, it, expect, vi } from "vitest";
import { ArmedState } from "../features/inventory/armed-state";

describe("ArmedState", () => {
  it("starts disarmed", () => {
    expect(new ArmedState().get()).toBeNull();
  });

  it("arms and disarms, exposing the armed tool", () => {
    const s = new ArmedState();
    s.arm("tape");
    expect(s.get()).toEqual({ itemId: "tape" });
    s.disarm();
    expect(s.get()).toBeNull();
  });

  it("notifies subscribers on arm and disarm", () => {
    const s = new ArmedState();
    const cb = vi.fn();
    s.subscribe(cb);
    s.arm("tape");
    s.disarm();
    expect(cb).toHaveBeenNthCalledWith(1, { itemId: "tape" });
    expect(cb).toHaveBeenNthCalledWith(2, null);
  });

  it("re-arming a different item notifies once with the new tool", () => {
    const s = new ArmedState();
    const cb = vi.fn();
    s.subscribe(cb);
    s.arm("tape");
    s.arm("bottle");
    expect(cb).toHaveBeenLastCalledWith({ itemId: "bottle" });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("arming the already-armed item is a no-op (no extra notify)", () => {
    const s = new ArmedState();
    const cb = vi.fn();
    s.subscribe(cb);
    s.arm("tape");
    s.arm("tape");
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe stops notifications", () => {
    const s = new ArmedState();
    const cb = vi.fn();
    const off = s.subscribe(cb);
    off();
    s.arm("tape");
    expect(cb).not.toHaveBeenCalled();
  });
});
