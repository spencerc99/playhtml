// ABOUTME: Verifies identity details sent to the page stay readable on Firefox.
// ABOUTME: Firefox hides content-script objects from page scripts unless cloned in.

import { afterEach, describe, expect, it, vi } from "vitest";
import { detailForPage } from "../entrypoints/content/pageDetail";

describe("detailForPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes the detail through where the page can already read it", () => {
    const detail = { playerIdentity: { publicKey: "pk" } };
    expect(detailForPage(detail)).toBe(detail);
  });

  it("clones the detail into the page on Firefox", () => {
    const cloned = { playerIdentity: { publicKey: "pk" } };
    const cloneInto = vi.fn(() => cloned);
    vi.stubGlobal("cloneInto", cloneInto);
    const detail = { playerIdentity: { publicKey: "pk" } };
    expect(detailForPage(detail)).toBe(cloned);
    expect(cloneInto).toHaveBeenCalledWith(detail, window);
  });
});
