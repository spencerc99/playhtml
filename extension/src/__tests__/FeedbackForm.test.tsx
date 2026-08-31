// ABOUTME: Verifies the popup feedback form interaction and Worker request.
// ABOUTME: Covers successful submissions, validation, and retryable failures.

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";

vi.mock("../components/InternetPortraitHome.scss", () => ({}));
vi.mock("@movement/config", () => ({
  WORKER_URL: "https://worker.example.com",
}));

async function renderFeedbackForm() {
  const { FeedbackForm } = await import("../components/FeedbackForm");
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<FeedbackForm />);
  });

  return { container, root };
}

function cleanupRoot(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("FeedbackForm", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 Test Browser",
    });
    Object.assign(browser.runtime, {
      getManifest: vi.fn(() => ({ version: "0.1.19" })),
    });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("opens, submits feedback, and shows confirmation", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { container, root } = await renderFeedbackForm();

    try {
      const openButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "send feedback",
      );

      await act(async () => {
        openButton?.click();
      });

      const textarea = container.querySelector("textarea");
      const form = container.querySelector("form");
      expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
      expect(form).toBeInstanceOf(HTMLFormElement);

      await act(async () => {
        setTextareaValue(textarea as HTMLTextAreaElement, "The portrait is blank");
      });
      await act(async () => {
        form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });

      expect(fetchMock).toHaveBeenCalledWith("https://worker.example.com/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "The portrait is blank",
          extensionVersion: "0.1.19",
          browser: "Mozilla/5.0 Test Browser",
        }),
      });
      expect(container.textContent).toContain("thanks — received");
    } finally {
      cleanupRoot(root, container);
    }
  });

  it("keeps the message available when submission fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
    const { container, root } = await renderFeedbackForm();

    try {
      const openButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "send feedback",
      );
      await act(async () => openButton?.click());

      const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
      await act(async () => setTextareaValue(textarea, "Still broken"));
      await act(async () => {
        container
          .querySelector("form")
          ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });

      expect(container.textContent).toContain("couldn’t send — try again");
      expect(textarea.value).toBe("Still broken");
    } finally {
      cleanupRoot(root, container);
    }
  });
});
