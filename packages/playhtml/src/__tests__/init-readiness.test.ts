// ABOUTME: Tests playhtml's public init readiness lifecycle.
// ABOUTME: Covers shared readiness for duplicate init callers.

import { beforeEach, describe, expect, it } from "vitest";
import { playhtml, resetPlayHTML, html } from "../index";

describe("playhtml init readiness", () => {
  beforeEach(async () => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDER_THROW = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    document.body.innerHTML = "";
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
  });

  it("starts loading and exposes a ready promise", () => {
    expect(playhtml.isLoading).toBe(true);
    expect(playhtml.ready).toBeInstanceOf(Promise);
  });

  it("marks ready after init syncs", async () => {
    await playhtml.init({});

    expect(playhtml.isLoading).toBe(false);
    await expect(playhtml.ready).resolves.toBeUndefined();
  });

  it.each(["element", "id"] as const)(
    "clears loading state for an attribute-free %s registration after sync",
    async (registration) => {
      const element = document.createElement("div");
      element.id = `registered-${registration}`;
      element.setAttribute("loading-class", "counter-pending");
      document.body.append(element);
      const handle = playhtml.register<{ count: number }>(
        registration === "element" ? element : element.id,
        {
          defaultData: { count: 0 },
          view: ({ data, setData }) =>
            html`<button
              @click=${() =>
                setData((draft) => {
                  draft.count++;
                })}
            >
              ${data.count}
            </button>`,
        },
      );
      try {
        expect(element.hasAttribute("can-play")).toBe(false);
        expect(element.classList.contains("playhtml-loading")).toBe(true);
        expect(element.getAttribute("aria-busy")).toBe("true");

        await playhtml.init({});
        await playhtml.ready;
        expect(element.classList.contains("playhtml-loading")).toBe(false);
        expect(element.classList.contains("counter-pending")).toBe(false);
        expect(element.hasAttribute("aria-busy")).toBe(false);
        expect(element.hasAttribute("aria-live")).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
        element.querySelector("button")!.click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(handle.getData()).toEqual({ count: 1 });
      } finally {
        handle.unregister();
      }
    },
  );

  it("keeps duplicate init callers pending until the first init syncs", async () => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = true;

    const firstInit = playhtml.init({});
    const secondInit = playhtml.init({});
    let firstResolved = false;
    let secondResolved = false;
    firstInit.then(() => {
      firstResolved = true;
    });
    secondInit.then(() => {
      secondResolved = true;
    });

    await Promise.resolve();

    expect(firstResolved).toBe(false);
    expect(secondResolved).toBe(false);

    const [provider] = (globalThis as any).PLAYHTML_TEST_PROVIDERS;
    provider.emit("sync", true);

    await expect(firstInit).resolves.toBeDefined();
    await expect(secondInit).resolves.toBeUndefined();
    expect(playhtml.isLoading).toBe(false);
  });

  it("resets loading state and ready promise", async () => {
    await playhtml.init({});
    const resolvedReady = playhtml.ready;

    await resetPlayHTML();

    expect(playhtml.isLoading).toBe(true);
    expect(playhtml.ready).not.toBe(resolvedReady);
  });

  it("uses an existing global playhtml ready promise", async () => {
    let resolveExistingReady: () => void = () => {};
    const existingReady = new Promise<void>((resolve) => {
      resolveExistingReady = resolve;
    });
    (window as any).playhtml = {
      ready: existingReady,
      isLoading: true,
    };

    const initReady = playhtml.init({});

    expect(playhtml.ready).toBe(existingReady);
    expect(playhtml.isLoading).toBe(true);

    resolveExistingReady();
    await expect(initReady).resolves.toBeUndefined();

    expect(playhtml.isLoading).toBe(false);
  });

  it("rejects duplicate init callers when setup fails", async () => {
    (globalThis as any).PLAYHTML_TEST_PROVIDER_THROW = true;

    const firstInit = playhtml.init({});
    const secondInit = playhtml.init({});

    await expect(firstInit).rejects.toThrow("test provider init failure");
    await expect(secondInit).rejects.toThrow("test provider init failure");
    await expect(playhtml.ready).rejects.toThrow("test provider init failure");
  });
});
