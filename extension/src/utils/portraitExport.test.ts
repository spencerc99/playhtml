// ABOUTME: Covers portrait export on browsers without OffscreenCanvas.
// ABOUTME: Verifies the DOM canvas path composites and downloads a PNG.

import { afterEach, expect, it, vi } from "vitest";
import { compositePagePortrait } from "./portraitExport";

const originalImage = globalThis.Image;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  globalThis.Image = originalImage;
});

it("exports a page portrait with a DOM canvas", async () => {
  const drawImage = vi.fn();
  const portraitBlob = new Blob(["portrait"], { type: "image/png" });
  const canvas = document.createElement("canvas");
  vi.spyOn(canvas, "getContext").mockReturnValue({
    drawImage,
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, "toBlob").mockImplementation((callback) => {
    callback(portraitBlob);
  });

  const createElement = vi.spyOn(document, "createElement");
  createElement.mockImplementation(((tagName: string) => {
    if (tagName === "canvas") return canvas;
    return Document.prototype.createElement.call(document, tagName);
  }) as typeof document.createElement);

  class LoadedImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }

  globalThis.Image = LoadedImage as unknown as typeof Image;
  vi.stubGlobal("OffscreenCanvas", undefined);
  const close = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn().mockResolvedValue({ close }),
  );
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn().mockReturnValue("blob:portrait"),
    revokeObjectURL: vi.fn(),
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  await compositePagePortrait("data:image/png;base64,test", svg, "page.png");

  expect(canvas.width).toBe(window.innerWidth);
  expect(canvas.height).toBe(window.innerHeight);
  expect(drawImage).toHaveBeenCalledTimes(2);
  expect(close).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
});
