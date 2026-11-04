// ABOUTME: Tests the labels shown on every piece while the peek key is held.
// ABOUTME: Every piece carries its full label, whether or not it is pointed at.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrapItem } from "@movement/components/ScrapCollage";
import type { CollagePiece } from "../entrypoints/scraps/collageRecord";
import { ProvenancePeek } from "../entrypoints/scraps/ProvenancePeek";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function piece(id: string, domain: string, pageTitle: string, x: number): CollagePiece {
  return {
    id,
    scrapId: `scrap_${id}`,
    scrap: {
      id: `scrap_${id}`,
      key: id,
      kind: "image",
      src: `https://${domain}/${id}.png`,
      naturalWidth: 100,
      naturalHeight: 100,
      pageTitle,
      pageUrl: `https://${domain}/page`,
      domain,
      ts: Date.UTC(2026, 0, 5),
    } as ScrapItem,
    x,
    y: 100,
    width: 100,
    height: 100,
    rotation: 0,
    z: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    flipX: false,
    flipY: false,
  };
}

describe("ProvenancePeek", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("gives every piece the same full label, hovered or not", () => {
    const pieces = [
      piece("a", "spencer.place", "Notes", 0),
      piece("b", "example.test", "Gallery", 300),
    ];
    act(() =>
      root.render(
        <ProvenancePeek
          pieces={pieces}
          hoveredId="a"
          scale={1}
          bounds={{ x: 0, y: 0, width: 1000, height: 600 }}
        />,
      ),
    );

    const tags = [...container.querySelectorAll<HTMLElement>(".collage-peek")];
    expect(tags).toHaveLength(2);
    const [hovered, other] = tags;
    expect(hovered.textContent).toContain("spencer.place");
    expect(hovered.textContent).toContain("Notes");
    expect(hovered.textContent).toContain("picture · first seen");
    expect(other.textContent).toContain("example.test");
    expect(other.textContent).toContain("Gallery");
    expect(other.textContent).toContain("picture · first seen");
    expect(hovered.className).toBe(other.className);
  });
});
