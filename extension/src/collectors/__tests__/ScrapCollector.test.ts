// ABOUTME: Tests internet scrap capture rules, visibility timing, sanitization, and limits.
// ABOUTME: Exercises image, button, SVG icon, heading, and cursor pipelines against real DOM nodes.

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
  left?: number;
  top?: number;
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
  { width = 160, height = 120, left = 0, top = 0 }: ElementSize = {},
): void {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    width,
    height,
    left,
    top,
  } as DOMRect);
}

interface HeadingOptions extends ElementSize {
  text?: string;
  level?: 1 | 2 | 3;
  styles?: Record<string, string>;
}

function createHeading({
  text = "What the tide left behind",
  level = 2,
  styles,
  width = 320,
  height = 44,
  left = 0,
  top = 0,
}: HeadingOptions = {}): HTMLElement {
  const heading = document.createElement(`h${level}`);
  heading.textContent = text;
  if (styles) heading.setAttribute("data-styles", JSON.stringify(styles));
  setRenderedSize(heading, { width, height, left, top });
  document.body.appendChild(heading);
  return heading;
}

function createImage({
  src,
  alt = "",
  naturalWidth = 200,
  naturalHeight = 150,
  width = 160,
  height = 120,
  left = 0,
  top = 0,
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
  setRenderedSize(image, { width, height, left, top });
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
  left = 0,
  top = 0,
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
  setRenderedSize(element, { width, height, left, top });
  document.body.appendChild(element);
  return element;
}

function createSvg(
  { width = 24, height = 24, left = 0, top = 0 }: ElementSize = {},
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  setRenderedSize(svg, { width, height, left, top });
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
    vi.stubGlobal("getComputedStyle", (element: Element) => {
      const overrides = JSON.parse(
        element.getAttribute("data-styles") ?? "{}",
      ) as Record<string, string>;
      return {
        backgroundColor:
          element.getAttribute("data-background") ?? "rgb(20, 30, 40)",
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
        lineHeight: "20px",
        visibility: "visible",
        opacity: "1",
        boxShadow: "none",
        cursor: element.getAttribute("data-cursor") ?? "auto",
        ...overrides,
      } as CSSStyleDeclaration;
    });
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
      position: {
        pageX: 150,
        pageY: 100,
        pageWidth: 1024,
        pageHeight: 2000,
      },
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

  describe("bare text buttons", () => {
    /** The computed style a plain text control tagged `role="button"` reports. */
    const BARE = JSON.stringify({
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      border: "0px none rgb(6, 6, 6)",
      boxShadow: "none",
    });

    it("skips prose a site merely tagged as a button", () => {
      const bare = createButton({
        text: "willhess17 4 years ago (edited)",
        role: true,
      });
      bare.setAttribute("data-styles", BARE);

      collector.enable();
      showForCapture([bare]);

      expect(emitted("button")).toHaveLength(0);
    });

    it("keeps a bordered control that paints nothing else", () => {
      const bordered = createButton({ text: "Learn more", role: true });
      bordered.setAttribute(
        "data-styles",
        JSON.stringify({
          backgroundColor: "rgba(0, 0, 0, 0)",
          backgroundImage: "none",
          border: "1.5px solid rgb(91, 141, 184)",
          boxShadow: "none",
        }),
      );

      collector.enable();
      showForCapture([bordered]);

      expect(
        emitted("button").map((data) => data.kind === "button" && data.text),
      ).toEqual(["Learn more"]);
    });

    it("keeps an icon-only control that paints nothing else", () => {
      const iconOnly = createButton({ text: "" });
      iconOnly.setAttribute("data-styles", BARE);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", "M0 0h10v10z");
      svg.appendChild(path);
      setRenderedSize(svg, { width: 20, height: 20 });
      iconOnly.appendChild(svg);

      collector.enable();
      showForCapture([iconOnly]);

      const scraps = emitted("button");
      expect(scraps).toHaveLength(1);
      expect(scraps[0].kind === "button" && scraps[0].innerSvg).toContain(
        "<svg",
      );
    });

    it("does not let skipped prose consume the per-page button cap", () => {
      const prose = Array.from({ length: 30 }, (_, index) => {
        const bare = createButton({ text: `Commenter ${index}`, role: true });
        bare.setAttribute("data-styles", BARE);
        return bare;
      });
      const real = Array.from({ length: 20 }, (_, index) =>
        createButton({ text: `Real button ${index}` }),
      );

      collector.enable();
      showForCapture([...prose, ...real]);

      expect(emitted("button")).toHaveLength(20);
      expect(
        emitted("button").every(
          (data) => data.kind === "button" && data.text.startsWith("Real"),
        ),
      ).toBe(true);
    });
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

  it("captures a same-geometry icon rendered at different sizes once per page", () => {
    const small = createSvg({ width: 24, height: 24 });
    small.setAttribute("viewBox", "0 0 24 24");
    const large = createSvg({ width: 40, height: 40 });
    large.setAttribute("viewBox", "0 0 24 24");
    for (const svg of [small, large]) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M2 2h20v20z");
      svg.appendChild(path);
    }

    collector.enable();
    showForCapture([small, large]);

    expect(emitted("svg-icon")).toHaveLength(1);
    expect(emitted("svg-icon")[0]).toMatchObject({
      kind: "svg-icon",
      width: 24,
      height: 24,
    });
  });

  it("captures h1 through h3 with their level and normalized text", () => {
    const headings = ([1, 2, 3] as const).map((level) =>
      createHeading({ level, text: `  Level\n\n ${level}  heading ` }),
    );
    const notAHeading = document.createElement("h4");
    notAHeading.textContent = "Fourth level";
    setRenderedSize(notAHeading);
    document.body.appendChild(notAHeading);

    collector.enable();
    expect(observer().observed.has(notAHeading)).toBe(false);
    showForCapture([...headings, notAHeading]);

    expect(
      emitted("heading").map((data) =>
        data.kind === "heading" ? [data.level, data.text] : undefined,
      ),
    ).toEqual([
      [1, "Level 1 heading"],
      [2, "Level 2 heading"],
      [3, "Level 3 heading"],
    ]);
  });

  it("stores the heading's own wording, leaving text-transform to the renderer", () => {
    const shouting = createHeading({
      text: "Enter the guildhall",
      styles: { textTransform: "uppercase" },
    });

    collector.enable();
    showForCapture([shouting]);

    const scraps = emitted("heading");
    expect(scraps).toHaveLength(1);
    expect(scraps[0].kind === "heading" && scraps[0].text).toBe(
      "Enter the guildhall",
    );
    expect(scraps[0].kind === "heading" && scraps[0].styles.textTransform).toBe(
      "uppercase",
    );
  });

  it("skips empty, too-short, too-long, and invisible headings", () => {
    const empty = createHeading({ text: "   " });
    const tooShort = createHeading({ text: "a" });
    const tooLong = createHeading({ text: "x".repeat(121) });
    const zeroSized = createHeading({ text: "No box at all", width: 0 });
    const invisible = createHeading({
      text: "Visibility hidden",
      styles: { visibility: "hidden" },
    });
    const transparent = createHeading({
      text: "Fully transparent",
      styles: { opacity: "0" },
    });
    const shortestKept = createHeading({ text: "Hi" });
    const longestKept = createHeading({ text: "y".repeat(120) });

    collector.enable();
    showForCapture([
      empty,
      tooShort,
      tooLong,
      zeroSized,
      invisible,
      transparent,
      shortestKept,
      longestKept,
    ]);

    expect(
      emitted("heading").map((data) => (data.kind === "heading" ? data.text : "")),
    ).toEqual(["Hi", "y".repeat(120)]);
  });

  it("ignores headings inside the extension's own injected UI", () => {
    const extensionHost = document.createElement("div");
    extensionHost.id = "wewere-announcement-toast-host";
    document.body.appendChild(extensionHost);
    const ourHeading = document.createElement("h2");
    ourHeading.textContent = "Internet scraps are here";
    setRenderedSize(ourHeading);
    extensionHost.appendChild(ourHeading);
    const pageHeading = createHeading({ text: "The page's own heading" });

    collector.enable();
    expect(observer().observed.has(ourHeading)).toBe(false);
    showForCapture([ourHeading, pageHeading]);

    expect(
      emitted("heading").map((data) => (data.kind === "heading" ? data.text : "")),
    ).toEqual(["The page's own heading"]);
  });

  it("reconstructs only allowlisted typographic styles for a heading", () => {
    const heading = createHeading({
      text: "Typeset heading",
      styles: {
        fontFamily: "Georgia, serif",
        fontSize: "42px",
        fontWeight: "700",
        fontStyle: "italic",
        color: "rgb(61, 56, 51)",
        letterSpacing: "-0.01em",
        textTransform: "uppercase",
        lineHeight: "48px",
        backgroundColor: "rgba(0, 0, 0, 0)",
        boxShadow: "0 2px 4px rgb(0, 0, 0)",
        borderRadius: "12px",
      },
    });

    collector.enable();
    showForCapture([heading]);

    const scraps = emitted("heading");
    expect(scraps).toHaveLength(1);
    expect(scraps[0].kind === "heading" && scraps[0].styles).toEqual({
      fontFamily: "Georgia, serif",
      fontSize: "42px",
      fontWeight: "700",
      fontStyle: "italic",
      color: "rgb(61, 56, 51)",
      letterSpacing: "-0.01em",
      textTransform: "uppercase",
      lineHeight: "48px",
    });
  });

  it("saves no background for a heading, however its page painted one", () => {
    const opaque = createHeading({
      text: "Banner heading",
      styles: { backgroundColor: "rgb(34, 51, 59)" },
    });
    const keyword = createHeading({
      text: "Keyword transparent",
      styles: { backgroundColor: "transparent" },
    });
    const tinted = createHeading({
      text: "Tinted background",
      styles: { backgroundColor: "rgba(12, 34, 56, 0.4)" },
    });

    collector.enable();
    showForCapture([opaque, keyword, tinted]);

    const scraps = emitted("heading");
    expect(scraps).toHaveLength(3);
    for (const scrap of scraps) {
      expect(Object.keys(scrap.kind === "heading" ? scrap.styles : {})).not.toContain(
        "backgroundColor",
      );
      expect(scrap.kind === "heading" && scrap.backdropColor).toBeUndefined();
    }
  });

  it("keeps a heading's own text color", () => {
    const heading = createHeading({
      text: "Pale type on a dark bar",
      styles: { color: "rgb(245, 240, 232)" },
    });

    collector.enable();
    showForCapture([heading]);

    const colored = emitted("heading")[0];
    expect(colored.kind === "heading" && colored.styles.color).toBe(
      "rgb(245, 240, 232)",
    );
  });

  it("deduplicates headings by wording regardless of level and caps them at twenty", () => {
    const asH1 = createHeading({ level: 1, text: "Same Wording" });
    const asH3 = createHeading({ level: 3, text: "same wording" });
    const uniqueHeadings = Array.from({ length: 20 }, (_, index) =>
      createHeading({ text: `Heading number ${index}` }),
    );

    collector.enable();
    showForCapture([asH1, asH3, ...uniqueHeadings]);

    expect(emitted("heading")).toHaveLength(20);
    expect(
      emitted("heading").filter(
        (data) =>
          data.kind === "heading" &&
          data.text.toLowerCase() === "same wording",
      ),
    ).toHaveLength(1);
    expect(observer().observed.has(uniqueHeadings[19])).toBe(false);
  });

  it("discovers headings added to the page after collection starts", async () => {
    collector.enable();
    const container = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = "Loaded in later";
    setRenderedSize(heading, { width: 240, height: 40 });
    container.appendChild(heading);
    document.body.appendChild(container);

    await Promise.resolve();
    expect(observer().observed.has(heading)).toBe(true);

    showForCapture([heading]);
    expect(
      emitted("heading").map((data) => (data.kind === "heading" ? data.text : "")),
    ).toEqual(["Loaded in later"]);
  });

  describe("backdrop color", () => {
    /** An outlined control: see-through, but chromed enough to still be a button. */
    const OUTLINED = JSON.stringify({
      backgroundColor: "rgba(0, 0, 0, 0)",
      backgroundImage: "none",
      border: "1px solid rgb(245, 240, 232)",
      boxShadow: "none",
    });

    /** Wraps the element in ancestors painting the given backgrounds, innermost first. */
    function nest(element: Element, ancestorBackgrounds: string[]): void {
      const anchor = element.parentElement;
      let child: Element = element;
      element.remove();
      for (const backgroundColor of ancestorBackgrounds) {
        const parent = document.createElement("div");
        parent.setAttribute(
          "data-styles",
          JSON.stringify({ backgroundColor }),
        );
        parent.appendChild(child);
        child = parent;
      }
      (anchor ?? document.body).appendChild(child);
    }

    function outlinedButton(text: string, ancestors: string[]): HTMLElement {
      const button = createButton({ text });
      button.setAttribute("data-styles", OUTLINED);
      nest(button, ancestors);
      return button;
    }

    it("records the nearest painted ancestor for a see-through control", () => {
      const button = outlinedButton("Sign in", [
        "rgba(0, 0, 0, 0)",
        "rgb(28, 32, 38)",
      ]);

      collector.enable();
      showForCapture([button]);

      const scraps = emitted("button");
      expect(scraps).toHaveLength(1);
      expect(scraps[0].kind === "button" && scraps[0].backdropColor).toBe(
        "rgb(28, 32, 38)",
      );
    });

    it("records a backdrop for a semi-transparent background too", () => {
      const button = createButton({ text: "Tinted over a dark bar" });
      button.setAttribute(
        "data-styles",
        JSON.stringify({
          backgroundColor: "rgba(255, 255, 255, 0.2)",
          backgroundImage: "none",
          border: "0px none",
          boxShadow: "none",
        }),
      );
      nest(button, ["rgb(28, 32, 38)"]);

      collector.enable();
      showForCapture([button]);

      const scrap = emitted("button")[0];
      expect(scrap.kind === "button" && scrap.backdropColor).toBe(
        "rgb(28, 32, 38)",
      );
      expect(scrap.kind === "button" && scrap.styles.backgroundColor).toBe(
        "rgba(255, 255, 255, 0.2)",
      );
    });

    it("records no backdrop when the control paints its own background", () => {
      const button = createButton({ text: "Opaque of its own" });
      button.setAttribute("data-background", "rgb(34, 51, 59)");
      nest(button, ["rgb(200, 0, 0)"]);

      collector.enable();
      showForCapture([button]);

      const scrap = emitted("button")[0];
      expect(scrap.kind === "button" && scrap.backdropColor).toBeUndefined();
      expect(scrap.kind === "button" && scrap.styles.backgroundColor).toBe(
        "rgb(34, 51, 59)",
      );
    });

    it("falls back to the page canvas when nothing up the tree paints", () => {
      const clear = JSON.stringify({ backgroundColor: "rgba(0, 0, 0, 0)" });
      document.body.setAttribute("data-styles", clear);
      document.documentElement.setAttribute("data-styles", clear);
      const button = outlinedButton("Nothing painted behind", [
        "rgba(0, 0, 0, 0)",
      ]);

      collector.enable();
      showForCapture([button]);

      const canvasScrap = emitted("button")[0];
      expect(canvasScrap.kind === "button" && canvasScrap.backdropColor).toBe(
        "rgb(255, 255, 255)",
      );
      document.body.removeAttribute("data-styles");
      document.documentElement.removeAttribute("data-styles");
    });

    it("stops climbing after a bounded number of ancestors", () => {
      const clear = JSON.stringify({ backgroundColor: "rgba(0, 0, 0, 0)" });
      document.body.setAttribute("data-styles", clear);
      document.documentElement.setAttribute("data-styles", clear);
      // 11 clear ancestors, then the painted one: the 12th step still sees it.
      const nearby = outlinedButton("Painted just within reach", [
        ...Array.from({ length: 11 }, () => "rgba(0, 0, 0, 0)"),
        "rgb(10, 20, 30)",
      ]);
      const tooFar = outlinedButton("Painted beyond the cap", [
        ...Array.from({ length: 12 }, () => "rgba(0, 0, 0, 0)"),
        "rgb(10, 20, 30)",
      ]);

      collector.enable();
      showForCapture([nearby, tooFar]);

      const backdrops = emitted("button").map((data) =>
        data.kind === "button" ? data.backdropColor : undefined,
      );
      // Past the cap the walk gives up rather than reporting a guess.
      expect(backdrops).toEqual(["rgb(10, 20, 30)", undefined]);
      document.body.removeAttribute("data-styles");
      document.documentElement.removeAttribute("data-styles");
    });

    it("never records a backdrop for a heading, whatever it sits on", () => {
      const heading = createHeading({
        text: "Pale type on a dark bar",
        styles: { color: "rgb(245, 240, 232)" },
      });
      nest(heading, ["rgb(28, 32, 38)"]);

      collector.enable();
      showForCapture([heading]);

      const scrap = emitted("heading")[0];
      expect(scrap.kind === "heading" && scrap.backdropColor).toBeUndefined();
      expect(
        Object.keys(scrap.kind === "heading" ? scrap.styles : {}),
      ).not.toContain("backgroundColor");
    });

    it("leaves a gradient button to its own background", () => {
      const button = createButton({ text: "Gradient" });
      button.setAttribute("data-background", "rgba(0, 0, 0, 0)");
      button.setAttribute(
        "data-background-image",
        "linear-gradient(rgb(1, 2, 3), rgb(4, 5, 6))",
      );
      nest(button, ["rgb(28, 32, 38)"]);

      collector.enable();
      showForCapture([button]);

      const gradientButton = emitted("button")[0];
      expect(
        gradientButton.kind === "button" && gradientButton.backdropColor,
      ).toBeUndefined();
    });

    it("does not let the backdrop change a scrap's identity", () => {
      const onDark = outlinedButton("Same label either way", [
        "rgb(28, 32, 38)",
      ]);
      const onLight = outlinedButton("Same label either way", [
        "rgb(250, 249, 246)",
      ]);

      collector.enable();
      showForCapture([onDark, onLight]);

      expect(emitted("button")).toHaveLength(1);
    });
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

  describe("page position", () => {
    afterEach(() => {
      (window as { scrollX: number }).scrollX = 0;
      (window as { scrollY: number }).scrollY = 0;
    });

    it("records each element scrap's centre in document coordinates", () => {
      (window as { scrollX: number }).scrollX = 40;
      (window as { scrollY: number }).scrollY = 600;
      const image = createImage({
        src: "https://example.com/placed.jpg",
        width: 300,
        height: 200,
        left: 100,
        top: 50,
      });
      const button = createButton({
        text: "Placed button",
        width: 120,
        height: 40,
        left: 20,
        top: 10,
      });
      const heading = createHeading({
        text: "Placed heading",
        width: 400,
        height: 60,
        left: 12,
        top: 30,
      });
      const svg = createSvg({ width: 24, height: 24, left: 8, top: 4 });
      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path",
      );
      path.setAttribute("d", "M0 0h4v4z");
      svg.appendChild(path);

      collector.enable();
      showForCapture([image, button, heading, svg]);

      expect(emitted("image")[0].position).toEqual({
        pageX: 290,
        pageY: 750,
        pageWidth: 1024,
        pageHeight: 2000,
      });
      expect(emitted("button")[0].position).toEqual({
        pageX: 120,
        pageY: 630,
        pageWidth: 1024,
        pageHeight: 2000,
      });
      expect(emitted("heading")[0].position).toEqual({
        pageX: 252,
        pageY: 660,
        pageWidth: 1024,
        pageHeight: 2000,
      });
      expect(emitted("svg-icon")[0].position).toEqual({
        pageX: 60,
        pageY: 616,
        pageWidth: 1024,
        pageHeight: 2000,
      });
    });

    it("records a cursor scrap's position from the pointer event", () => {
      const target = document.createElement("div");
      target.setAttribute(
        "data-cursor",
        'url("https://example.com/placed.cur") 1 1, auto',
      );
      document.body.appendChild(target);

      collector.enable();
      const event = new MouseEvent("mouseover", { bubbles: true });
      Object.defineProperties(event, {
        pageX: { value: 317, configurable: true },
        pageY: { value: 1284, configurable: true },
      });
      target.dispatchEvent(event);

      expect(emitted("cursor")[0].position).toEqual({
        pageX: 317,
        pageY: 1284,
        pageWidth: 1024,
        pageHeight: 2000,
      });
    });

    it("does not let position distinguish two captures of the same scrap", () => {
      const first = createHeading({
        text: "Repeated wording",
        left: 0,
        top: 0,
      });
      const second = createHeading({
        text: "Repeated wording",
        left: 500,
        top: 900,
      });

      collector.enable();
      showForCapture([first, second]);

      const scraps = emitted("heading");
      expect(scraps).toHaveLength(1);
      expect(scraps[0].position).toEqual({
        pageX: 160,
        pageY: 22,
        pageWidth: 1024,
        pageHeight: 2000,
      });
    });
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
