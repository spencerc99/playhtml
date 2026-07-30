// ABOUTME: Verifies the popup recovery notice shown when the satchel is hidden on a site.
// ABOUTME: Keeps the saved preference reversible without requiring an on-page handle.

import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiteVisibilityNotice } from "../components/SiteVisibilityNotice";

describe("SiteVisibilityNotice", () => {
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("names the hidden site and restores the satchel", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onShowSatchel = vi.fn();

    await act(async () => {
      root.render(
        <SiteVisibilityNotice
          siteName="mail.google.com"
          onShowSatchel={onShowSatchel}
        />,
      );
    });

    expect(container.textContent).toContain("The satchel is hidden on mail.google.com");
    await act(async () => {
      container.querySelector("button")?.click();
    });
    expect(onShowSatchel).toHaveBeenCalledOnce();

    act(() => root.unmount());
  });
});
