import { describe, it, expect, beforeAll } from "vitest";
import { playhtml } from "../index";

beforeAll(async () => {
  await playhtml.init({});
  await new Promise((r) => setTimeout(r, 0));
});

describe("playhtml.createPageData", () => {
  it("creates a page data channel with default value", () => {
    const channel = playhtml.createPageData("test-basic", { count: 0 });
    expect(channel.getData()).toEqual({ count: 0 });
  });

  it("setData with value form replaces data", async () => {
    const channel = playhtml.createPageData("test-set-value", { count: 0 });
    channel.setData({ count: 5 });
    await new Promise((r) => queueMicrotask(r));
    expect(channel.getData()).toEqual({ count: 5 });
  });

  it("setData with mutator form mutates via proxy", async () => {
    const channel = playhtml.createPageData("test-set-mutator", { count: 0 });
    channel.setData((draft) => {
      draft.count = 10;
    });
    await new Promise((r) => queueMicrotask(r));
    expect(channel.getData()).toEqual({ count: 10 });
  });

  it("onUpdate fires on local changes", async () => {
    const channel = playhtml.createPageData("test-onupdate", { count: 0 });
    const updates: any[] = [];
    channel.onUpdate((data) => updates.push(data));

    channel.setData({ count: 1 });
    await new Promise((r) => queueMicrotask(r));

    expect(updates.length).toBe(1);
    expect(updates[0]).toEqual({ count: 1 });
  });

  it("onUpdate unsubscribe stops callbacks", async () => {
    const channel = playhtml.createPageData("test-unsub", { count: 0 });
    const updates: any[] = [];
    const unsub = channel.onUpdate((data) => updates.push(data));

    channel.setData({ count: 1 });
    await new Promise((r) => queueMicrotask(r));
    expect(updates.length).toBe(1);

    unsub();
    channel.setData({ count: 2 });
    await new Promise((r) => queueMicrotask(r));
    expect(updates.length).toBe(1);
  });

  it("destroy prevents further operations", () => {
    const channel = playhtml.createPageData("test-destroy", { count: 0 });
    channel.destroy();
    expect(() => channel.getData()).toThrow(/destroyed/);
    expect(() => channel.setData({ count: 1 })).toThrow(/destroyed/);
  });

  it("multiple handles share data but have independent listeners", async () => {
    const ch1 = playhtml.createPageData("test-multi", { count: 0 });
    const ch2 = playhtml.createPageData("test-multi", { count: 0 });

    const updates1: any[] = [];
    const updates2: any[] = [];
    ch1.onUpdate((d) => updates1.push(d));
    ch2.onUpdate((d) => updates2.push(d));

    ch1.setData({ count: 5 });
    await new Promise((r) => queueMicrotask(r));

    // Both see the update
    expect(updates1.length).toBe(1);
    expect(updates2.length).toBe(1);

    // Both read same data
    expect(ch2.getData()).toEqual({ count: 5 });

    // Destroying one doesn't affect the other
    ch1.destroy();
    ch2.setData({ count: 10 });
    await new Promise((r) => queueMicrotask(r));

    expect(updates1.length).toBe(1); // ch1's listener removed
    expect(updates2.length).toBe(2); // ch2 still works
    expect(ch2.getData()).toEqual({ count: 10 });

    ch2.destroy();
  });

  it("reserved __page__ tag throws in maybeSetupTag path", async () => {
    const el = document.createElement("div");
    el.id = "bad-tag-test";
    el.setAttribute("__page__", "");
    document.body.appendChild(el);

    await expect(
      playhtml.setupPlayElementForTag(el, "__page__")
    ).rejects.toThrow(/reserved/);

    document.body.removeChild(el);
  });
});
