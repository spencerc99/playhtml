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
});
