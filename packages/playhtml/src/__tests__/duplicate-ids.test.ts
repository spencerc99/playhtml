// ABOUTME: Verifies playhtml reports duplicate element IDs during setup.
// ABOUTME: Covers live registration diagnostics and dev UI conflict grouping.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listDuplicatePlayElements, setupDevUI } from "../development";
import { playhtml, resetPlayHTML } from "../index";

describe("duplicate playhtml element IDs", () => {
  beforeEach(async () => {
    (globalThis as any).PLAYHTML_TEST_DISABLE_AUTO_SYNC = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDER_THROW = false;
    (globalThis as any).PLAYHTML_TEST_PROVIDERS = [];
    await resetPlayHTML();
    document.body.innerHTML = "";
    delete (window as any).playhtml;
    delete document.documentElement.dataset.playhtml;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetPlayHTML();
    document.body.innerHTML = "";
  });

  it("reports and skips a duplicate ID for the same capability tag", async () => {
    await playhtml.init({});

    const first = document.createElement("div");
    first.id = "duplicate-card";
    first.setAttribute("can-toggle", "");

    const second = document.createElement("div");
    second.id = "duplicate-card";
    second.setAttribute("can-toggle", "");

    document.body.append(first, second);

    await playhtml.setupPlayElementForTag(first, "can-toggle");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await playhtml.setupPlayElementForTag(second, "can-toggle");

    const handler = playhtml.elementHandlers
      .get("can-toggle")!
      .get("duplicate-card")!;
    expect(handler.element).toBe(first);
    expect(second.classList.contains("__playhtml-element")).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Duplicate element id "duplicate-card"'),
      { existingElement: first, duplicateElement: second },
    );
  });

  it("groups duplicate DOM IDs by capability tag for dev tools", () => {
    const firstToggle = document.createElement("div");
    firstToggle.id = "shared-id";
    firstToggle.setAttribute("can-toggle", "");

    const secondToggle = document.createElement("button");
    secondToggle.id = "shared-id";
    secondToggle.setAttribute("can-toggle", "");

    const moveElement = document.createElement("div");
    moveElement.id = "shared-id";
    moveElement.setAttribute("can-move", "");

    const uniqueToggle = document.createElement("div");
    uniqueToggle.id = "unique-id";
    uniqueToggle.setAttribute("can-toggle", "");

    document.body.append(firstToggle, secondToggle, moveElement, uniqueToggle);

    expect(listDuplicatePlayElements(["can-toggle", "can-move"])).toEqual([
      {
        tagType: "can-toggle",
        elementId: "shared-id",
        elements: [firstToggle, secondToggle],
      },
    ]);
  });

  it("renders duplicate IDs as an error callout in dev tools", () => {
    vi.spyOn(console, "table").mockImplementation(() => {});

    const firstToggle = document.createElement("div");
    firstToggle.id = "shared-id";
    firstToggle.setAttribute("can-toggle", "");

    const secondToggle = document.createElement("button");
    secondToggle.id = "shared-id";
    secondToggle.setAttribute("can-toggle", "");

    document.body.append(firstToggle, secondToggle);

    setupDevUI({
      elementHandlers: new Map([
        [
          "can-toggle",
          new Map([
            [
              "shared-id",
              {
                element: firstToggle,
                data: { on: false },
                defaultData: { on: false },
                setData: vi.fn(),
              },
            ],
          ]),
        ],
      ]),
      cursorClient: null,
      roomId: "test-room",
      host: "localhost:1999",
    } as any);

    document.querySelector<HTMLElement>(".ph-trigger")!.click();

    const warning = document.querySelector<HTMLElement>(".ph-duplicate-warning");
    expect(warning).toBeTruthy();
    expect(warning!.textContent).toContain("Duplicate playhtml IDs");
    expect(warning!.textContent).toContain("shared-id");
    expect(warning!.textContent).toContain("can-toggle");
  });
});
