// ABOUTME: Tests playhtml's public init readiness lifecycle.
// ABOUTME: Covers shared readiness for duplicate init callers.

import { beforeEach, describe, expect, it } from "vitest";
import { playhtml, resetPlayHTML } from "../index";

describe("playhtml init readiness", () => {
  beforeEach(async () => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
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
});
