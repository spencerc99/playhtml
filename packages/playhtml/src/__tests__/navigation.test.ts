// ABOUTME: Tests for the navigation subsystem (handleNavigation, queue collapse,
// ABOUTME: detection layer attach/detach).
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createNavigationController,
  attachNavigationListeners,
} from "../navigation";

describe("navigation controller", () => {
  it("runs handler exactly once when called once", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const ctrl = createNavigationController(handler);
    await ctrl.trigger();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent calls into one queued run", async () => {
    let resolveFirst: () => void;
    const handler = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)))
      .mockResolvedValue(undefined);
    const ctrl = createNavigationController(handler);

    const p1 = ctrl.trigger();
    const p2 = ctrl.trigger();
    const p3 = ctrl.trigger();

    resolveFirst!();
    await Promise.all([p1, p2, p3]);

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("does not run after destroy", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const ctrl = createNavigationController(handler);
    ctrl.destroy();
    await ctrl.trigger();
    expect(handler).not.toHaveBeenCalled();
  });

  it("recovers after handler throws", async () => {
    const handler = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    const ctrl = createNavigationController(handler);

    await expect(ctrl.trigger()).rejects.toThrow("boom");
    await ctrl.trigger();

    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("completes in-flight run after destroy but skips queued retry", async () => {
    let resolveFirst: () => void;
    const handler = vi
      .fn()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)))
      .mockResolvedValue(undefined);
    const ctrl = createNavigationController(handler);

    const p1 = ctrl.trigger();
    const p2 = ctrl.trigger();

    ctrl.destroy();
    resolveFirst!();
    await Promise.all([p1, p2]);

    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("attachNavigationListeners", () => {
  it("calls trigger on popstate", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const ctrl = createNavigationController(handler);
    const detach = attachNavigationListeners(ctrl);

    window.dispatchEvent(new PopStateEvent("popstate"));
    await Promise.resolve();

    expect(handler).toHaveBeenCalledTimes(1);
    detach();
  });

  it("detach removes the popstate listener", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const ctrl = createNavigationController(handler);
    const detach = attachNavigationListeners(ctrl);
    detach();

    window.dispatchEvent(new PopStateEvent("popstate"));
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
  });
});
