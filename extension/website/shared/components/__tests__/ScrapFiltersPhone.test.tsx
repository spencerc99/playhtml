// ABOUTME: Verifies the scrap filters fold their chips behind one "filters" chip on a phone.
// ABOUTME: Wider or mouse-driven screens keep every chip in view.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapFilters } from "../ScrapFilters";
import { ANY_TIME } from "../../utils/scrapFilters";

function mockPhone(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function renderFilters(root: Root, places: { label: string }[] = []) {
  act(() => {
    root.render(
      <ScrapFilters
        items={[]}
        places={places as never}
        onPlaces={() => {}}
        kind={[]}
        onKind={() => {}}
        shape={[]}
        onShape={() => {}}
        search=""
        onSearch={() => {}}
        when={ANY_TIME}
        onWhen={() => {}}
      />,
    );
  });
}

const chipLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll(".scrap-filters__chip")).map((chip) =>
    chip.querySelector(".scrap-filters__key")?.textContent,
  );

describe("ScrapFilters on a phone", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("shows only search and a filters chip until the chips are asked for", () => {
    mockPhone(true);
    renderFilters(root);
    expect(chipLabels(container)).toEqual(["filters"]);

    const toggle = container.querySelector<HTMLButtonElement>(
      ".scrap-filters__toggle",
    )!;
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(chipLabels(container)).toEqual([
      "filters",
      "from",
      "type",
      "shape",
      "when",
    ]);
  });

  it("counts the filters in use on the folded chip", () => {
    mockPhone(true);
    renderFilters(root, [{ label: "example.com" }]);
    const toggle = container.querySelector(".scrap-filters__toggle")!;
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.querySelector(".scrap-filters__value")?.textContent).toBe(
      "1",
    );
  });

  it("keeps every chip in view off a phone", () => {
    mockPhone(false);
    renderFilters(root);
    expect(chipLabels(container)).toEqual(["from", "type", "shape", "when"]);
  });
});
