// ABOUTME: Verifies the page announcement toast opens its CTA and then dismisses.
// ABOUTME: Covers mouse and keyboard activation and toasts without a web CTA.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnnouncementToast } from "./AnnouncementToast";
import type { Announcement } from "./announcements";

const WIKI_ANNOUNCEMENT: Announcement = {
  id: "wiki-chat",
  shippedAt: Date.parse("2026-05-27T00:00:00Z"),
  title: "Chat on Wikipedia!",
  body: "A small chat panel now lives on every page.",
  cta: {
    label: "try it →",
    href: "https://en.wikipedia.org/wiki/Cat",
  },
};

function renderToast(announcement: Announcement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onCtaClick = vi.fn();
  const onDismiss = vi.fn();
  act(() =>
    root.render(
      <AnnouncementToast
        announcement={announcement}
        onShown={vi.fn()}
        onDismiss={onDismiss}
        onCtaClick={onCtaClick}
      />,
    ),
  );
  return { container, root, onCtaClick, onDismiss };
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

describe("AnnouncementToast", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("opens the CTA and dismisses when its link is clicked", () => {
    const { container, root, onCtaClick, onDismiss } =
      renderToast(WIKI_ANNOUNCEMENT);
    try {
      const cta = container.querySelector<HTMLAnchorElement>(
        "a.announcement-toast__cta",
      );
      expect(cta?.textContent).toBe("try it →");
      expect(cta?.href).toBe("https://en.wikipedia.org/wiki/Cat");

      act(() => cta?.click());
      expect(onCtaClick).toHaveBeenCalledWith(
        "wiki-chat",
        "https://en.wikipedia.org/wiki/Cat",
      );
      expect(
        container
          .querySelector(".announcement-toast")
          ?.classList.contains("is-exiting"),
      ).toBe(true);

      act(() => vi.advanceTimersByTime(200));
      expect(onDismiss).toHaveBeenCalledOnce();
    } finally {
      cleanup(root, container);
    }
  });

  it("is reachable from the keyboard as a focusable link", () => {
    const { container, root } = renderToast(WIKI_ANNOUNCEMENT);
    try {
      const cta = container.querySelector<HTMLAnchorElement>(
        "a.announcement-toast__cta",
      );
      cta?.focus();
      expect(document.activeElement).toBe(cta);
    } finally {
      cleanup(root, container);
    }
  });

  it("renders no CTA for announcements without a web link", () => {
    const { container, root } = renderToast({
      ...WIKI_ANNOUNCEMENT,
      cta: undefined,
    });
    try {
      expect(container.querySelector(".announcement-toast__cta")).toBeNull();
    } finally {
      cleanup(root, container);
    }
  });
});
