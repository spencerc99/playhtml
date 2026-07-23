// ABOUTME: Tests image scrap capture rules, visibility timing, and collection limits.
// ABOUTME: Exercises ScrapCollector against DOM images with controlled intersection events.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScrapCollector } from "../ScrapCollector";
import type { ScrapEventData } from "../types";

class IntersectionObserverMock {
  static instances: IntersectionObserverMock[] = [];

  readonly root = null;
  readonly rootMargin = "0px";
  readonly thresholds = [0.5];
  readonly observed = new Set<Element>();
  readonly disconnect = vi.fn(() => this.observed.clear());
  readonly unobserve = vi.fn((target: Element) => this.observed.delete(target));

  constructor(private callback: IntersectionObserverCallback) {
    IntersectionObserverMock.instances.push(this);
  }

  observe(target: Element): void {
    this.observed.add(target);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(targets: Element[], intersectionRatio = 1): void {
    const entries = targets.map((target) => ({
      target,
      isIntersecting: intersectionRatio > 0,
      intersectionRatio,
    })) as IntersectionObserverEntry[];
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

interface ImageOptions {
  src: string;
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  complete?: boolean;
}

function createImage({
  src,
  alt = "",
  naturalWidth = 200,
  naturalHeight = 150,
  displayWidth = 160,
  displayHeight = 120,
  complete = true,
}: ImageOptions): HTMLImageElement {
  const image = document.createElement("img");
  image.alt = alt;
  Object.defineProperties(image, {
    currentSrc: { value: src, configurable: true },
    complete: { value: complete, configurable: true },
    naturalWidth: { value: naturalWidth, configurable: true },
    naturalHeight: { value: naturalHeight, configurable: true },
  });
  vi.spyOn(image, "getBoundingClientRect").mockReturnValue({
    width: displayWidth,
    height: displayHeight,
  } as DOMRect);
  document.body.appendChild(image);
  return image;
}

describe("ScrapCollector", () => {
  let collector: ScrapCollector;
  let emitCallback: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", IntersectionObserverMock);
    IntersectionObserverMock.instances = [];
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    document.title = "A page worth keeping";
    emitCallback = vi.fn();
    collector = new ScrapCollector();
    collector.setEmitCallback(emitCallback);
  });

  afterEach(() => {
    collector.disable();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  function observer(): IntersectionObserverMock {
    return IntersectionObserverMock.instances[0];
  }

  function showForCapture(images: HTMLImageElement[]): void {
    observer().trigger(images);
    vi.advanceTimersByTime(1000);
  }

  it("filters images below the displayed or natural size minimums", () => {
    const smallDisplay = createImage({
      src: "https://example.com/small-display.jpg",
      displayWidth: 79,
    });
    const smallNatural = createImage({
      src: "https://example.com/small-natural.jpg",
      naturalWidth: 49,
    });
    const minimumSize = createImage({
      src: "https://example.com/minimum.jpg",
      naturalWidth: 50,
      naturalHeight: 50,
      displayWidth: 80,
      displayHeight: 80,
    });

    collector.enable();
    showForCapture([smallDisplay, smallNatural, minimumSize]);

    expect(emitCallback).toHaveBeenCalledOnce();
    expect((emitCallback.mock.calls[0][0] as ScrapEventData).src).toBe(
      "https://example.com/minimum.jpg",
    );
  });

  it("skips data and blob image sources", () => {
    const dataImage = createImage({ src: "data:image/png;base64,test" });
    const blobImage = createImage({ src: "blob:https://example.com/image" });

    collector.enable();
    showForCapture([dataImage, blobImage]);

    expect(emitCallback).not.toHaveBeenCalled();
  });

  it("captures each resolved source once per page session", () => {
    const first = createImage({ src: "https://cdn.example.com/shared.jpg" });
    const second = createImage({ src: "https://cdn.example.com/shared.jpg" });

    collector.enable();
    showForCapture([first, second]);

    expect(emitCallback).toHaveBeenCalledOnce();
  });

  it("stops at fifty captures on an image-heavy page", () => {
    const images = Array.from({ length: 51 }, (_, index) =>
      createImage({ src: `https://example.com/image-${index}.jpg` }),
    );

    collector.enable();
    showForCapture(images);

    expect(emitCallback).toHaveBeenCalledTimes(50);
    expect(observer().disconnect).toHaveBeenCalled();
  });

  it("emits the image dimensions and page metadata", () => {
    const favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.href = "https://example.com/favicon.png";
    document.head.appendChild(favicon);
    const image = createImage({
      src: "https://example.com/feature.jpg",
      alt: "Sunlight through a window",
      naturalWidth: 1200,
      naturalHeight: 800,
      displayWidth: 300,
      displayHeight: 200,
    });

    collector.enable();
    showForCapture([image]);

    expect(emitCallback).toHaveBeenCalledWith({
      kind: "image",
      src: "https://example.com/feature.jpg",
      alt: "Sunlight through a window",
      naturalWidth: 1200,
      naturalHeight: 800,
      displayWidth: 300,
      displayHeight: 200,
      pageTitle: "A page worth keeping",
      faviconUrl: "https://example.com/favicon.png",
    });
  });

  it("waits for an unloaded image before observing it", () => {
    const image = createImage({
      src: "https://example.com/later.jpg",
      complete: false,
      naturalWidth: 0,
      naturalHeight: 0,
    });

    collector.enable();
    expect(observer().observed.has(image)).toBe(false);

    Object.defineProperties(image, {
      complete: { value: true, configurable: true },
      naturalWidth: { value: 640, configurable: true },
      naturalHeight: { value: 480, configurable: true },
    });
    image.dispatchEvent(new Event("load"));
    expect(observer().observed.has(image)).toBe(true);

    showForCapture([image]);
    expect(emitCallback).toHaveBeenCalledOnce();
  });

  it("requires one continuous second at fifty percent visibility", () => {
    const image = createImage({ src: "https://example.com/brief.jpg" });

    collector.enable();
    observer().trigger([image], 0.5);
    vi.advanceTimersByTime(999);
    observer().trigger([image], 0.4);
    vi.advanceTimersByTime(1);
    expect(emitCallback).not.toHaveBeenCalled();

    observer().trigger([image], 0.5);
    vi.advanceTimersByTime(1000);
    expect(emitCallback).toHaveBeenCalledOnce();
  });
});
