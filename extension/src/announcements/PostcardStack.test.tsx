// ABOUTME: Verifies popup postcards retire themselves after a CTA click or repeated views.
// ABOUTME: Each render simulates one popup open against an in-memory storage.local.

import { act } from "react";
import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostcardStack } from "./PostcardStack";
import { ANNOUNCEMENTS } from "./announcements";
import { POSTCARD_VIEW_LIMIT } from "./announcement-storage";

vi.mock("./announcements.scss", () => ({}));

// Announcements for a still-dark feature never surface, so use one every user can see.
const target = ANNOUNCEMENTS.find(
  (announcement) =>
    announcement.requiresFeature === undefined && announcement.cta,
);
if (!target) throw new Error("expected a reachable announcement with a CTA");

let data: Record<string, unknown>;

function setupStorage() {
  data = {};
  vi.mocked(browser.storage.local.get).mockImplementation((keys: any) => {
    if (typeof keys === "string")
      return Promise.resolve({ [keys]: data[keys] });
    return Promise.resolve({ ...data });
  });
  vi.mocked(browser.storage.local.set).mockImplementation((items: any) => {
    Object.assign(data, items);
    return Promise.resolve();
  });
}

async function openPopup() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PostcardStack />);
  });
  // Let the per-card view writes settle before the popup "closes".
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const titles = Array.from(
    container.querySelectorAll(".announcement-postcard__title"),
  ).map((el) => el.textContent);
  return {
    container,
    titles,
    close() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("PostcardStack", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    setupStorage();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(`shows a postcard on ${POSTCARD_VIEW_LIMIT} popup opens, then retires it`, async () => {
    for (let open = 1; open <= POSTCARD_VIEW_LIMIT; open++) {
      const popup = await openPopup();
      expect(popup.titles).toContain(target.title);
      popup.close();
    }
    expect(data[`announcement_views_${target.id}`]).toBe(POSTCARD_VIEW_LIMIT);
    expect(data[`announcement_seen_${target.id}`]).toBe("dismissed");

    const popup = await openPopup();
    expect(popup.titles).not.toContain(target.title);
    popup.close();
  });

  it("retires a postcard as soon as its CTA is clicked", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    const popup = await openPopup();
    const card = Array.from(
      popup.container.querySelectorAll<HTMLElement>("article"),
    ).find((el) => el.textContent?.includes(target.title));
    expect(card).toBeDefined();

    await act(async () => {
      card?.click();
    });
    const cta = card?.querySelector<HTMLAnchorElement>(
      ".announcement-postcard__cta",
    );
    expect(cta).not.toBeNull();

    // Unmount right after the click, the way opening a tab closes the popup,
    // so only writes issued synchronously by the click can count.
    await act(async () => {
      cta?.click();
      popup.close();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(data[`announcement_seen_${target.id}`]).toBe("dismissed");

    const next = await openPopup();
    expect(next.titles).not.toContain(target.title);
    next.close();
  });
});
