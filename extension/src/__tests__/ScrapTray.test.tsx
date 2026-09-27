// ABOUTME: Tests the scrap drawer's filters (including day and time of day), count line, reset, provenance label, and field keys.
// ABOUTME: Studio shortcuts must never fire while someone types in, or steers, the drawer's filters.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import { ScrapTray } from "../entrypoints/scraps/ScrapTray";
import {
  studioCommandFor,
  type KeymapContext,
} from "../entrypoints/scraps/studioKeymap";

const IDLE: KeymapContext = {
  mode: "idle",
  hasSelection: true,
  hasClipboard: false,
};

function scrap(
  id: string,
  pageUrl: string,
  pageTitle: string,
  kind: "image" | "button",
  ts: number,
): ScrapItem {
  const base = {
    id,
    key: id,
    pageUrl,
    pageTitle,
    domain: new URL(pageUrl).hostname,
    ts,
  };
  return kind === "image"
    ? {
        ...base,
        kind,
        src: `https://cdn.example/${id}.jpg`,
        naturalWidth: 400,
        naturalHeight: 300,
      }
    : { ...base, kind, text: pageTitle, styles: {} };
}

const items: ScrapItem[] = [
  scrap("a", "https://are.na/garden", "Garden", "image", 1),
  scrap("b", "https://are.na/shop", "Shop", "button", 2),
  scrap("c", "https://spencer.place/notes", "Notes", "image", 3),
  scrap("d", "https://example.com/", "Garden shop", "button", 4),
];

describe("ScrapTray filters", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <ScrapTray
          items={items}
          width={384}
          collapsed={false}
          slotSize="medium"
          onWidth={vi.fn()}
          onCollapsed={vi.fn()}
          onSlotSize={vi.fn()}
          onPlace={vi.fn()}
          onDragStart={vi.fn()}
        />,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("labels the scrap under focus with where it came from", () => {
    const slot = container.querySelector<HTMLButtonElement>(
      '[aria-label="spencer.place — Notes"]',
    )!;
    const label = () => container.querySelector(".collage-peek--tray");
    expect(label()).toBeNull();

    act(() => slot.focus());
    expect(label()!.textContent).toContain("spencer.place");
    expect(label()!.textContent).toContain("Notes");
    expect(label()!.textContent).toContain("picture · first seen");

    act(() => slot.blur());
    expect(label()).toBeNull();
  });

  const countLine = () =>
    container.querySelector(".collage-tray__count")!.textContent;
  const search = () =>
    container.querySelector<HTMLInputElement>(
      'input[aria-label="Search scraps"]',
    )!;
  const typeInto = (input: HTMLInputElement, value: string) =>
    act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const chip = (label: string) =>
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.startsWith(label),
    )!;

  it("filters by search, site, and type, then resets all three", () => {
    expect(countLine()).toBe("4 to draw from");

    typeInto(search(), "garden");
    expect(countLine()).toBe("2 of 4 · reset");

    act(() => chip("from").click());
    act(() =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(".scrap-filters__option"),
      )
        .find((row) => row.textContent?.includes("are.na"))!
        .click(),
    );
    expect(countLine()).toBe("1 of 4 · reset");

    act(() => chip("type").click());
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-scrap-kind="button"]')!
        .click(),
    );
    expect(countLine()).toBe("0 of 4 · reset");

    act(() =>
      container
        .querySelector<HTMLButtonElement>(".collage-tray__reset")!
        .click(),
    );
    expect(countLine()).toBe("4 to draw from");
    expect(search().value).toBe("");
    expect(chip("from").textContent).toContain("anywhere");
    expect(chip("type").textContent).toContain("all");
  });

  it("opens its popovers below the chips", () => {
    act(() => chip("from").click());
    expect(
      container.querySelector(".scrap-filters__popover--below"),
    ).not.toBeNull();
  });

  it("keeps studio shortcuts from firing while typing in or steering the filters", () => {
    const press = (target: Element, key: string) =>
      studioCommandFor(
        {
          key,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          target: target as HTMLElement,
        },
        IDLE,
      );

    for (const key of ["\\", "r", "s", "Backspace", "Escape", "Tab", "Enter"]) {
      expect(press(search(), key)).toBeNull();
    }

    act(() => chip("from").click());
    const siteInput = container.querySelector<HTMLInputElement>(
      '[aria-label="Find a domain or page"]',
    )!;
    for (const key of ["\\", "c", "Escape"]) {
      expect(press(siteInput, key)).toBeNull();
    }
    // The chips are buttons, not fields, yet Enter, Tab and Escape on them
    // belong to the filters rather than to crop, selection, or deselect.
    for (const key of ["Enter", "Tab", "Escape", "\\"]) {
      expect(press(chip("type"), key)).toBeNull();
    }

    // Outside the filters the drawer's scraps still reach the studio.
    const slot = container.querySelector(".collage-tray__slot");
    expect(slot).not.toBeNull();
    expect(press(slot!, "\\")).toEqual({ kind: "toggleDrawer" });
  });

  it("clears the search on Escape without closing anything else", () => {
    typeInto(search(), "notes");
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
    });
    const reachedWindow = vi.fn();
    window.addEventListener("keydown", reachedWindow);
    act(() => {
      search().dispatchEvent(escape);
    });
    window.removeEventListener("keydown", reachedWindow);
    expect(search().value).toBe("");
    expect(reachedWindow).not.toHaveBeenCalled();
    expect(countLine()).toBe("4 to draw from");
  });
});

describe("ScrapTray day and time-of-day filters", () => {
  let container: HTMLDivElement;
  let root: Root;
  const at = (day: number, hour: number) =>
    new Date(2026, 8, day, hour, 15).getTime();
  const dated: ScrapItem[] = [
    scrap("m1", "https://are.na/a", "Morning one", "image", at(1, 8)),
    scrap("n1", "https://are.na/b", "Night one", "image", at(1, 23)),
    scrap("m2", "https://are.na/c", "Morning two", "image", at(2, 9)),
    scrap("e2", "https://are.na/d", "Evening two", "button", at(2, 19)),
  ];

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        <ScrapTray
          items={dated}
          width={384}
          collapsed={false}
          slotSize="medium"
          onWidth={vi.fn()}
          onCollapsed={vi.fn()}
          onSlotSize={vi.fn()}
          onPlace={vi.fn()}
          onDragStart={vi.fn()}
        />,
      ),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const countLine = () =>
    container.querySelector(".collage-tray__count")!.textContent;
  const chip = (label: string) =>
    Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.startsWith(label),
    )!;
  const slots = () =>
    Array.from(container.querySelectorAll(".collage-tray__slot")).map(
      (slot) => slot.getAttribute("aria-label"),
    );

  it("narrows to a day, then a time of day, and resets both", () => {
    expect(chip("when").textContent).toContain("any time");

    act(() => chip("when").click());
    act(() =>
      container.querySelector<HTMLElement>('[data-day="2026-09-02"]')!.click(),
    );
    expect(countLine()).toBe("2 of 4 · reset");
    expect(chip("when").textContent).toContain("Sep 2");

    act(() =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(".scrap-filters__time"),
      )
        .find((button) => button.textContent === "morning")!
        .click(),
    );
    expect(countLine()).toBe("1 of 4 · reset");
    expect(slots()).toEqual(["are.na — Morning two"]);
    expect(chip("when").textContent).toContain("Sep 2 · morning");

    act(() =>
      container
        .querySelector<HTMLButtonElement>(".collage-tray__reset")!
        .click(),
    );
    expect(countLine()).toBe("4 to draw from");
    expect(chip("when").textContent).toContain("any time");
  });

  it("keeps every seen day in the grid and clears from the popover", () => {
    act(() => chip("when").click());
    const days = () =>
      Array.from(container.querySelectorAll<HTMLElement>("[data-day]")).map(
        (cell) => cell.dataset.day,
      );
    expect(days()).toEqual(["2026-09-01", "2026-09-02"]);

    act(() =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(".scrap-filters__time"),
      )
        .find((button) => button.textContent === "night")!
        .click(),
    );
    // 23:15 sits outside 00:00–06:00, so nothing matches, but both days stay.
    expect(countLine()).toBe("0 of 4 · reset");
    expect(days()).toEqual(["2026-09-01", "2026-09-02"]);

    act(() =>
      Array.from(
        container.querySelectorAll<HTMLButtonElement>(".scrap-filters__link"),
      )
        .find((button) => button.textContent === "clear")!
        .click(),
    );
    expect(countLine()).toBe("4 to draw from");
  });
});
