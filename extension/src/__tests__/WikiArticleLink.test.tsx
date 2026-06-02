// ABOUTME: Tests for WikiArticleLink hovercard behavior across article title changes.
// ABOUTME: Verifies the preview follows chat handle rerolls and page-name adoption.

import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _clearSummaryCacheForTest } from "../features/wiki-summary";
import { WikiArticleLink } from "../components/WikiArticleLink";

function okResponse(title: string, extract: string): Response {
  return {
    ok: true,
    json: () => Promise.resolve({ title, extract }),
  } as Response;
}

async function renderLink(title: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<WikiArticleLink title={title} />);
  });

  return { container, root };
}

async function hover(container: HTMLElement) {
  const link = container.querySelector("a");
  expect(link).toBeInstanceOf(HTMLAnchorElement);

  await act(async () => {
    link?.dispatchEvent(
      new MouseEvent("mouseover", { bubbles: true, cancelable: true }),
    );
    vi.advanceTimersByTime(350);
    await Promise.resolve();
  });
}

function cleanupRoot(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount();
  });
  container.remove();
}

describe("WikiArticleLink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _clearSummaryCacheForTest();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("shows the new article preview after the title changes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okResponse("Octopus", "Old preview"))
      .mockResolvedValueOnce(okResponse("Cuttlefish", "New preview"));
    globalThis.fetch = fetchMock as typeof fetch;

    const { container, root } = await renderLink("Octopus");

    try {
      await hover(container);
      expect(container.querySelector(".wiki-hovercard__title")?.textContent).toBe(
        "Octopus",
      );

      await act(async () => {
        root.render(<WikiArticleLink title="Cuttlefish" />);
      });
      await hover(container);

      expect(container.querySelector(".wiki-hovercard__title")?.textContent).toBe(
        "Cuttlefish",
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      cleanupRoot(root, container);
    }
  });
});
