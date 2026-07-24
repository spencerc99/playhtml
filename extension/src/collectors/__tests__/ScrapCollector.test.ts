// ABOUTME: Tests internet scrap capture rules, visibility timing, sanitization, and limits.
// ABOUTME: Exercises image, button, SVG icon, and cursor pipelines against real DOM nodes.

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

interface ElementSize {
  width?: number;
  height?: number;
}

interface ImageOptions extends ElementSize {
  src: string;
  alt?: string;
  naturalWidth?: number;
  naturalHeight?: number;
  complete?: boolean;
}

function setRenderedSize(
  element: Element,
  { width = 160, height = 120 }: ElementSize = {},
): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    width,
    height,
  } as DOMRect);
}

function createImage({
  src,
  alt = "",
  naturalWidth = 200,
  naturalHeight = 150,
  width = 160,
  height = 120,
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
  setRenderedSize(image, { width, height });
  document.body.appendChild(image);
  return image;
}

interface ButtonOptions extends ElementSize {
  text?: string;
  value?: string;
  role?: boolean;
}

function createButton({
  text = "Keep this",
  value,
  role = false,
  width = 160,
  height = 40,
}: ButtonOptions = {}): HTMLElement {
  const element = value === undefined
    ? document.createElement(role ? "div" : "button")
    : document.createElement("input");
  if (element instanceof HTMLInputElement) {
    element.type = "button";
    element.setAttribute("value", value ?? "");
  } else {
    element.textContent = text;
  }
  if (role) element.setAttribute("role", "button");
  setRenderedSize(element, { width, height });
  document.body.appendChild(element);
  return element;
}

function createSvg(
  { width = 24, height = 24 }: ElementSize = {},
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  setRenderedSize(svg, { width, height });
  document.body.appendChild(svg);
  return svg;
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
    vi.stubGlobal("getComputedStyle", (element: Element) => ({
      backgroundColor: element.getAttribute("data-background") ?? "rgb(20, 30, 40)",
      backgroundImage: element.getAttribute("data-background-image") ?? "none",
      color: element.getAttribute("data-color") ?? "rgb(10, 20, 30)",
      border: "1px solid rgb(1, 2, 3)",
      borderRadius: "4px",
      paddingTop: "4px",
      paddingRight: "8px",
      paddingBottom: "4px",
      paddingLeft: "8px",
      fontFamily: "sans-serif",
      fontSize: "14px",
      fontWeight: "400",
      fontStyle: "normal",
      letterSpacing: "normal",
      textTransform: "none",
      boxShadow: "none",
      cursor: element.getAttribute("data-cursor") ?? "auto",
    } as CSSStyleDeclaration));
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

  function showForCapture(elements: Element[]): void {
    observer().trigger(elements);
    vi.advanceTimersByTime(1000);
  }

  function emitted(kind: ScrapEventData["kind"]): ScrapEventData[] {
    return emitCallback.mock.calls
      .map(([data]) => data as ScrapEventData)
      .filter((data) => data.kind === kind);
  }

  it("keeps the existing image filters and dimensions", () => {
    const smallDisplay = createImage({
      src: "https://example.com/small-display.jpg",
      width: 79,
    });
    const smallNatural = createImage({
      src: "https://example.com/small-natural.jpg",
      naturalWidth: 49,
    });
    const minimumSize = createImage({
      src: "https://example.com/minimum.jpg",
      naturalWidth: 50,
      naturalHeight: 50,
      width: 80,
      height: 80,
    });
    const dataImage = createImage({ src: "data:image/png;base64,test" });
    const blobImage = createImage({ src: "blob:https://example.com/image" });

    collector.enable();
    showForCapture([
      smallDisplay,
      smallNatural,
      minimumSize,
      dataImage,
      blobImage,
    ]);

    expect(emitted("image")).toEqual([expect.objectContaining({
      kind: "image",
      src: "https://example.com/minimum.jpg",
      naturalWidth: 50,
      naturalHeight: 50,
      displayWidth: 80,
      displayHeight: 80,
    })]);
  });

  it("captures each image source once and stops images at fifty", () => {
    const first = createImage({ src: "https://cdn.example.com/shared.jpg" });
    const second = createImage({ src: "https://cdn.example.com/shared.jpg" });
    const images = Array.from({ length: 50 }, (_, index) =>
      createImage({ src: `https://example.com/image-${index}.jpg` }),
    );

    collector.enable();
    showForCapture([first, second, ...images]);

    expect(emitted("image")).toHaveLength(50);
    expect(observer().observed.has(images[49])).toBe(false);

    const button = createButton();
    return Promise.resolve().then(() => {
      expect(observer().observed.has(button)).toBe(true);
    });
  });

  it("emits image page metadata after a continuous visible second", () => {
    const favicon = document.createElement("link");
    favicon.rel = "icon";
    favicon.href = "https://example.com/favicon.png";
    document.head.appendChild(favicon);
    const image = createImage({
      src: "https://example.com/feature.jpg",
      alt: "Sunlight through a window",
      naturalWidth: 1200,
      naturalHeight: 800,
      width: 300,
      height: 200,
    });

    collector.enable();
    observer().trigger([image], 0.5);
    vi.advanceTimersByTime(999);
    observer().trigger([image], 0.4);
    vi.advanceTimersByTime(1);
    expect(emitCallback).not.toHaveBeenCalled();

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
    expect(emitted("image")).toHaveLength(1);
  });

  it("filters button text and displayed-size bounds", () => {
    const noText = createButton({ text: "" });
    const tooLong = createButton({ text: "x".repeat(61) });
    const tooNarrow = createButton({ text: "Narrow", width: 39 });
    const tooShort = createButton({ text: "Short", height: 19 });
    const tooWide = createButton({ text: "Wide", width: 481 });
    const tooTall = createButton({ text: "Tall", height: 161 });
    const minimum = createButton({ text: "M", width: 40, height: 20 });
    const maximum = createButton({
      text: "x".repeat(60),
      width: 480,
      height: 160,
    });

    collector.enable();
    showForCapture([
      noText,
      tooLong,
      tooNarrow,
      tooShort,
      tooWide,
      tooTall,
      minimum,
      maximum,
    ]);

    expect(emitted("button").map((data) => data.kind === "button" && data.text))
      .toEqual(["M", "x".repeat(60)]);
  });

  it("uses input value labels and reconstructs a safe style subset", () => {
    const input = createButton({ value: "Submit form" });
    input.setAttribute(
      "data-background-image",
      "linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))",
    );
    const remoteBackground = createButton({ text: "Remote background" });
    remoteBackground.setAttribute(
      "data-background-image",
      'url("https://example.com/button.png")',
    );

    collector.enable();
    showForCapture([input, remoteBackground]);

    const buttons = emitted("button");
    expect(buttons[0]).toMatchObject({
      kind: "button",
      text: "Submit form",
      styles: {
        backgroundColor: "rgb(20, 30, 40)",
        backgroundImage: "linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))",
        color: "rgb(10, 20, 30)",
        border: "1px solid rgb(1, 2, 3)",
      },
    });
    expect(buttons[1]).toMatchObject({
      kind: "button",
      text: "Remote background",
    });
    expect(
      buttons[1].kind === "button" && buttons[1].styles.backgroundImage,
    ).toBeUndefined();
  });

  it("deduplicates reconstructed buttons and caps them at twenty", () => {
    const duplicateOne = createButton({ text: "Same button" });
    const duplicateTwo = createButton({ text: "Same button" });
    const uniqueButtons = Array.from({ length: 20 }, (_, index) =>
      createButton({ text: `Button ${index}` }),
    );

    collector.enable();
    showForCapture([duplicateOne, duplicateTwo, ...uniqueButtons]);

    expect(emitted("button")).toHaveLength(20);
    expect(
      emitted("button").filter(
        (data) => data.kind === "button" && data.text === "Same button",
      ),
    ).toHaveLength(1);
    expect(observer().observed.has(uniqueButtons[19])).toBe(false);
  });

  it("discovers added submit and role buttons through DOM mutations", async () => {
    collector.enable();
    const submit = document.createElement("input");
    submit.type = "submit";
    submit.setAttribute("value", "Send");
    setRenderedSize(submit, { width: 80, height: 32 });
    const roleButton = createButton({ text: "Open", role: true });
    document.body.appendChild(submit);

    await Promise.resolve();
    expect(observer().observed.has(submit)).toBe(true);
    expect(observer().observed.has(roleButton)).toBe(true);

    showForCapture([submit, roleButton]);
    expect(emitted("button").map(
      (data) => data.kind === "button" && data.text,
    )).toEqual(["Send", "Open"]);
  });

  it("excludes button-owned SVG icons and captures icon-only buttons safely", () => {
    const button = createButton({ text: "" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("onclick", "alert(1)");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M0 0h10v10z");
    svg.appendChild(path);
    setRenderedSize(svg, { width: 24, height: 24 });
    button.appendChild(svg);

    collector.enable();
    expect(observer().observed.has(button)).toBe(true);
    expect(observer().observed.has(svg)).toBe(false);
    showForCapture([button]);

    const scraps = emitted("button");
    expect(scraps).toHaveLength(1);
    expect(scraps[0]).toMatchObject({ kind: "button", text: "" });
    expect(scraps[0].kind === "button" && scraps[0].innerSvg).toContain("<svg");
    expect(scraps[0].kind === "button" && scraps[0].innerSvg).not.toContain(
      "onclick",
    );
  });

  it("omits oversized inline SVG markup from text buttons", () => {
    const button = createButton({ text: "Text survives" });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M0 0${"h1".repeat(5 * 1024)}`);
    svg.appendChild(path);
    setRenderedSize(svg, { width: 24, height: 24 });
    button.appendChild(svg);

    collector.enable();
    showForCapture([button]);

    const buttons = emitted("button");
    expect(buttons).toEqual([expect.objectContaining({
      kind: "button",
      text: "Text survives",
    })]);
    const buttonScrap = buttons[0];
    expect(buttonScrap.kind).toBe("button");
    if (buttonScrap.kind !== "button") {
      throw new Error("Expected a button scrap");
    }
    expect(buttonScrap.innerSvg).toBeUndefined();
  });

  it("skips SVG icons with unresolvable use references or oversized markup", () => {
    const unresolved = createSvg();
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#missing");
    unresolved.appendChild(use);
    const oversized = createSvg();
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.textContent = "x".repeat(21 * 1024);
    oversized.appendChild(text);
    const tooSmall = createSvg({ width: 11, height: 24 });
    const tooLarge = createSvg({ width: 401, height: 24 });

    collector.enable();
    showForCapture([unresolved, oversized, tooSmall, tooLarge]);

    expect(emitted("svg-icon")).toHaveLength(0);
  });

  it("embeds in-document references used by captured SVG icons", () => {
    const definitions = createSvg({ width: 0, height: 0 });
    const symbol = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "symbol",
    );
    symbol.id = "saved-shape";
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M0 0h8v8z");
    symbol.appendChild(path);
    definitions.appendChild(symbol);

    const svg = createSvg();
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#saved-shape");
    svg.appendChild(use);

    collector.enable();
    showForCapture([svg]);

    const scraps = emitted("svg-icon");
    expect(scraps).toHaveLength(1);
    const markup = scraps[0].kind === "svg-icon" ? scraps[0].markup : "";
    expect(markup).toContain('id="saved-shape"');
    expect(markup).toContain('d="M0 0h8v8z"');
    expect(markup).toContain('href="#saved-shape"');
  });

  it("sanitizes SVG icons and bakes currentColor into their markup", () => {
    const svg = createSvg({ width: 32, height: 36 });
    svg.setAttribute("data-color", "rgb(12, 34, 56)");
    svg.setAttribute("onload", "alert(1)");
    const script = document.createElementNS("http://www.w3.org/2000/svg", "script");
    script.textContent = "alert(1)";
    const foreignObject = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "foreignObject",
    );
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("fill", "currentColor");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("onclick", "alert(1)");
    path.setAttribute("d", "M0 0h10v10z");
    const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
    image.setAttribute("href", "https://example.com/tracker.png");
    svg.append(script, foreignObject, path, image);

    collector.enable();
    showForCapture([svg]);

    const scraps = emitted("svg-icon");
    expect(scraps).toHaveLength(1);
    const markup = scraps[0].kind === "svg-icon" ? scraps[0].markup : "";
    expect(markup).toContain('width="32"');
    expect(markup).toContain('height="36"');
    expect(markup).toContain('viewBox="0 0 32 36"');
    expect(markup).toContain('fill="rgb(12, 34, 56)"');
    expect(markup).toContain('stroke="rgb(12, 34, 56)"');
    expect(markup).not.toMatch(
      /currentColor|script|foreignObject|onload|onclick|tracker\.png/i,
    );
  });

  it("deduplicates serialized SVG icons and caps them at twenty", () => {
    const duplicateOne = createSvg();
    const duplicateTwo = createSvg();
    for (const svg of [duplicateOne, duplicateTwo]) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M0 0h1v1z");
      svg.appendChild(path);
    }
    const uniqueIcons = Array.from({ length: 20 }, (_, index) => {
      const svg = createSvg();
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${index + 1} 0h1v1z`);
      svg.appendChild(path);
      return svg;
    });

    collector.enable();
    showForCapture([duplicateOne, duplicateTwo, ...uniqueIcons]);

    expect(emitted("svg-icon")).toHaveLength(20);
    const duplicateMarkup = emitted("svg-icon").filter(
      (data) =>
        data.kind === "svg-icon" && data.markup.includes("M0 0h1v1z"),
    );
    expect(duplicateMarkup).toHaveLength(1);
    expect(observer().observed.has(uniqueIcons[19])).toBe(false);
  });

  it("captures cursor URLs and hotspots while ignoring fallback-only cursors", () => {
    const fallback = document.createElement("div");
    fallback.setAttribute("data-cursor", "pointer");
    const custom = document.createElement("div");
    custom.setAttribute(
      "data-cursor",
      'url("https://example.com/cursor.cur") 4 7, url("fallback.cur"), pointer',
    );
    document.body.append(fallback, custom);

    collector.enable();
    fallback.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(500);
    custom.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(emitted("cursor")).toEqual([expect.objectContaining({
      kind: "cursor",
      url: "https://example.com/cursor.cur",
      hotspotX: 4,
      hotspotY: 7,
    })]);
  });

  it("allows data cursors, skips blob cursors, and deduplicates by URL", () => {
    const blob = document.createElement("div");
    blob.setAttribute(
      "data-cursor",
      'url("blob:https://example.com/cursor") 1 2, auto',
    );
    const dataFirst = document.createElement("div");
    dataFirst.setAttribute(
      "data-cursor",
      'url("data:image/png;base64,AAAA") 3 5, auto',
    );
    const dataSecond = document.createElement("div");
    dataSecond.setAttribute(
      "data-cursor",
      'url("data:image/png;base64,AAAA") 9 9, pointer',
    );
    document.body.append(blob, dataFirst, dataSecond);

    collector.enable();
    blob.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(500);
    dataFirst.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    vi.advanceTimersByTime(500);
    dataSecond.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

    expect(emitted("cursor")).toEqual([expect.objectContaining({
      kind: "cursor",
      url: "data:image/png;base64,AAAA",
      hotspotX: 3,
      hotspotY: 5,
    })]);
  });

  it("throttles cursor style checks to one every five hundred milliseconds", () => {
    const first = document.createElement("div");
    first.setAttribute("data-cursor", 'url("https://example.com/one.cur"), auto');
    const second = document.createElement("div");
    second.setAttribute("data-cursor", 'url("https://example.com/two.cur"), auto');
    document.body.append(first, second);

    collector.enable();
    first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    second.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(emitted("cursor")).toHaveLength(1);

    vi.advanceTimersByTime(499);
    second.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(emitted("cursor")).toHaveLength(1);

    vi.advanceTimersByTime(1);
    second.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(emitted("cursor")).toHaveLength(2);
  });
});
