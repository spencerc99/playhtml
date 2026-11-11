// ABOUTME: Verifies the dev tools panel cleans up page state on teardown.
// ABOUTME: Covers injected styles, body margins, and per-element reset.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupDevUI, teardownDevUI } from "../development";
import type { ElementHandler } from "../elements";

function setupWithHandler(
  tagType: string,
  elementId: string,
  handler: Record<string, unknown>,
) {
  setupDevUI(
    {} as any,
    new Map([[tagType, new Map([[elementId, handler]])]]) as unknown as Map<
      string,
      Map<string, ElementHandler>
    >,
  );
}

function devStyleCount(): number {
  return Array.from(document.head.querySelectorAll("style")).filter((style) =>
    style.textContent?.includes("#playhtml-dev-root"),
  ).length;
}

describe("dev tools teardown", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    document.body.removeAttribute("style");
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    teardownDevUI();
    vi.restoreAllMocks();
  });

  it("keeps one dev stylesheet across repeated setup and removes it on teardown", () => {
    const element = document.createElement("div");
    element.id = "toggle";
    document.body.appendChild(element);
    const handler = { element, data: {}, defaultData: {}, reset: vi.fn() };

    setupWithHandler("can-toggle", "toggle", handler);
    setupWithHandler("can-toggle", "toggle", handler);
    expect(devStyleCount()).toBe(1);

    teardownDevUI();
    expect(devStyleCount()).toBe(0);
  });

  it("restores the body margin when torn down with the panel open", () => {
    document.body.style.marginRight = "3px";
    const element = document.createElement("div");
    element.id = "toggle";
    document.body.appendChild(element);
    setupWithHandler("can-toggle", "toggle", {
      element,
      data: {},
      defaultData: {},
      reset: vi.fn(),
    });

    document.querySelector<HTMLElement>(".ph-trigger")!.click();
    expect(document.body.style.marginRight).not.toBe("3px");

    teardownDevUI();
    expect(document.body.style.marginRight).toBe("3px");
  });

  it("resets elements through the handler's reset", () => {
    const element = document.createElement("div");
    element.id = "toggle";
    document.body.appendChild(element);
    const reset = vi.fn();
    const setData = vi.fn();
    setupWithHandler("can-toggle", "toggle", {
      element,
      data: { on: true },
      defaultData: { on: false },
      reset,
      setData,
    });

    document.querySelector<HTMLElement>(".ph-trigger")!.click();
    document.querySelector<HTMLButtonElement>(".ph-tree-reset")!.click();
    document.querySelector<HTMLButtonElement>(".ph-reset-btn")!.click();

    expect(reset).toHaveBeenCalledTimes(2);
    expect(setData).not.toHaveBeenCalled();
  });

  it("finds tree rows for element ids containing quotes", () => {
    const element = document.createElement("div");
    element.id = 'say"hi';
    element.className = "__playhtml-element";
    document.body.appendChild(element);
    setupWithHandler("can-toggle", 'say"hi', {
      element,
      data: {},
      defaultData: {},
      reset: vi.fn(),
    });

    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    document.querySelector<HTMLElement>(".ph-trigger")!.click();
    document.querySelector<HTMLButtonElement>('button[title="Inspect"]')!.click();
    element.click();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    delete (HTMLElement.prototype as any).scrollIntoView;
  });
});
