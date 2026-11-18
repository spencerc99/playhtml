// ABOUTME: Verifies satchel item previews render page-derived data as inert content.
// ABOUTME: Covers hostile text, image URLs, CSS values, and malformed source URLs.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Inventory, getSafeColor, getSafeImageSrc } from "./Inventory";
import type { GameInventory, InventoryItem } from "../types";

function renderInventory(items: InventoryItem[]) {
  const inventory: GameInventory = {
    items,
    totalItems: items.length,
    lastUpdated: Date.parse("2026-11-11T00:00:00Z"),
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <Inventory
        inventory={inventory}
        onBack={vi.fn()}
        onRemoveItem={vi.fn()}
        onClearInventory={vi.fn()}
      />,
    ),
  );
  return { container, root };
}

function cleanup(root: Root, container: HTMLDivElement) {
  act(() => root.unmount());
  container.remove();
}

function item(overrides: Partial<InventoryItem>): InventoryItem {
  return {
    id: "item",
    type: "element",
    name: "Thing",
    description: "found on a page",
    collectedAt: Date.parse("2026-11-10T00:00:00Z"),
    sourceUrl: "https://example.com/page",
    ...overrides,
  };
}

describe("Inventory", () => {
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders hostile element text and styles without creating markup", () => {
    const hostileText = '<img src=x onerror="window.__pwned=1">';
    const { container, root } = renderInventory([
      item({
        id: "hostile",
        data: {
          snapshot: {
            metadata: { textContent: hostileText, tagName: "<script>" },
            styles: {
              backgroundColor: "red; background-image: url(https://evil.example/x)",
              color: "url(javascript:alert(1))",
            },
          },
        },
      }),
    ]);
    try {
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector("script")).toBeNull();
      expect(container.textContent).toContain(hostileText.slice(0, 30));
      const preview = Array.from(container.querySelectorAll("div")).find(
        (div) => div.textContent === hostileText.slice(0, 30),
      );
      expect(preview?.style.background).not.toContain("evil");
      expect(preview?.style.color).not.toContain("javascript");
    } finally {
      cleanup(root, container);
    }
  });

  it("drops image previews whose source is not a web or inline image", () => {
    const { container, root } = renderInventory([
      item({
        id: "script-image",
        data: {
          snapshot: {
            metadata: {
              hasImage: true,
              imageUrl: 'javascript:alert(1)" onerror="alert(1)',
              tagName: "IMG",
            },
          },
        },
      }),
    ]);
    try {
      expect(container.querySelector("img")).toBeNull();
      expect(container.textContent).toContain("IMG");
    } finally {
      cleanup(root, container);
    }
  });

  it("renders a site item with a malformed source URL using the fallback icon", () => {
    const { container, root } = renderInventory([
      item({ id: "site", type: "site_signature", sourceUrl: "not a url" }),
    ]);
    try {
      const favicon = container.querySelector<HTMLImageElement>(
        'img[alt="Site favicon"]',
      );
      expect(favicon?.src.startsWith("data:image/svg+xml;base64,")).toBe(true);
    } finally {
      cleanup(root, container);
    }
  });

  it("accepts only web and inline image sources", () => {
    expect(getSafeImageSrc("https://example.com/a.png")).toBe(
      "https://example.com/a.png",
    );
    expect(getSafeImageSrc("data:image/png;base64,AAAA")).toBe(
      "data:image/png;base64,AAAA",
    );
    expect(getSafeImageSrc("javascript:alert(1)")).toBeNull();
    expect(getSafeImageSrc("data:text/html,<script>")).toBeNull();
  });

  it("accepts only plain color values", () => {
    expect(getSafeColor("#fafafa")).toBe("#fafafa");
    expect(getSafeColor("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(getSafeColor("tomato")).toBe("tomato");
    expect(getSafeColor("red; position: fixed")).toBeNull();
    expect(getSafeColor("url(https://evil.example/x)")).toBeNull();
  });
});
