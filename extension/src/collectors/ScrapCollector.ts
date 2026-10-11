// ABOUTME: Captures visible images (including CSS background images), controls, headings, and cursor artwork as internet scraps.
// ABOUTME: Applies per-kind filtering, visibility timing, sanitization, and page-session limits.

import { BaseCollector } from "./BaseCollector";
import {
  colorAlpha,
  getCanonicalScrapKey,
  getScrapEncounterKey,
  isBareTextButton,
  serializeSvg,
} from "./scrapUtils";
import type {
  ButtonScrapData,
  CursorScrapData,
  HeadingScrapData,
  HeadingStyleProperty,
  ScrapEventData,
  ScrapPosition,
} from "./types";
import { getFaviconUrl } from "../utils/pageMetadata";
import { extractDomain } from "../utils/urlNormalization";

const MIN_IMAGE_DISPLAY_SIZE = 80;
const MIN_IMAGE_NATURAL_SIZE = 50;
const MIN_BUTTON_WIDTH = 40;
const MIN_BUTTON_HEIGHT = 20;
const MAX_BUTTON_WIDTH = 480;
const MAX_BUTTON_HEIGHT = 160;
const MIN_BUTTON_TEXT_LENGTH = 1;
const MAX_BUTTON_TEXT_LENGTH = 60;
const MIN_HEADING_TEXT_LENGTH = 2;
const MAX_HEADING_TEXT_LENGTH = 120;
const VISIBILITY_DELAY_MS = 1000;
const CURSOR_CHECK_INTERVAL_MS = 500;
const MAX_IMAGES_PER_PAGE = 50;
/** How many elements painting a background image are watched per page. */
const MAX_BACKGROUND_CANDIDATES_PER_PAGE = 200;
/** Elements whose computed background is read per idle slice. */
const BACKGROUND_SCAN_CHUNK = 400;
/** Elements whose computed background is read per page, across all scans. */
const MAX_BACKGROUND_SCANNED_ELEMENTS = 8000;
/**
 * Elements re-read per page after a `class` or `style` change, kept apart from
 * the first pass so a page that restyles constantly cannot starve it.
 */
const MAX_BACKGROUND_RESCANNED_ELEMENTS = 4000;
/** Times one element's own restyling may trigger a re-read. */
const MAX_BACKGROUND_RESCANS_PER_ELEMENT = 20;
/** Attributes whose change can swap the background an element paints. */
const BACKGROUND_ATTRIBUTES = ["class", "style"];
/** Elements whose background never holds a photo worth keeping. */
const BACKGROUND_SKIP_TAGS = new Set([
  "HEAD",
  "SCRIPT",
  "STYLE",
  "NOSCRIPT",
  "TEMPLATE",
  "LINK",
  "META",
  "IMG",
  "PICTURE",
  "SOURCE",
  "VIDEO",
  "AUDIO",
  "IFRAME",
  "CANVAS",
  "BR",
  "WBR",
]);
const MAX_BUTTONS_PER_PAGE = 20;
const MAX_HEADINGS_PER_PAGE = 20;
const MAX_BUTTON_SVG_BYTES = 8 * 1024;
const BUTTON_SELECTOR =
  'button, input[type="submit"], input[type="button"], [role="button"]';
const HEADING_SELECTOR = "h1, h2, h3";
/** Light-DOM hosts for the extension's own injected UI, whose text is not a scrap. */
const EXTENSION_UI_SELECTOR =
  '[id^="wwo-"], [id^="wewere-"], [id^="we-were-online-"], [id^="playhtml-"]';
/** How far up the tree to look for the color a see-through element sits on. */
const MAX_BACKDROP_DEPTH = 12;
/** How far up the tree to look for an ancestor that hides its whole subtree. */
const MAX_VISIBILITY_DEPTH = 12;
/** A clip rectangle collapsed to nothing, the old way of hiding a label. */
const COLLAPSED_CLIP_PATTERN = /^rect\(\s*0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?[\s,]+0(?:px)?\s*\)$/i;
/** What a page paints over when nothing in the tree supplies a color. */
const CANVAS_BACKDROP_COLOR = "rgb(255, 255, 255)";
const GRADIENT_PATTERN =
  /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;
const BACKGROUND_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;
const CURSOR_URL_PATTERN =
  /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)\s*(?:([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)))?/i;

const BUTTON_STYLE_PROPERTIES = [
  "backgroundColor",
  "color",
  "borderRadius",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "textTransform",
  "boxShadow",
] as const;

const BUTTON_BORDER_PROPERTIES = [
  "borderTopWidth",
  "borderTopStyle",
  "borderTopColor",
  "borderRightWidth",
  "borderRightStyle",
  "borderRightColor",
  "borderBottomWidth",
  "borderBottomStyle",
  "borderBottomColor",
  "borderLeftWidth",
  "borderLeftStyle",
  "borderLeftColor",
] as const;

const HEADING_STYLE_PROPERTIES: readonly HeadingStyleProperty[] = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "color",
  "letterSpacing",
  "textTransform",
  "lineHeight",
];

export interface ImageSize {
  width: number;
  height: number;
}

/** Loads an image URL just to learn its intrinsic size, or undefined if it fails. */
export type ImageMeasurer = (url: string) => Promise<ImageSize | undefined>;

export interface ScrapCollectorOptions {
  measureImage?: ImageMeasurer;
}

interface BackgroundScanItem {
  element: Element;
  /** Re-read even if already scanned, because its styling changed. */
  rescan: boolean;
}

interface CursorImage {
  url: string;
  hotspotX?: number;
  hotspotY?: number;
}

export class ScrapCollector extends BaseCollector<ScrapEventData> {
  readonly type = "element" as const;
  readonly description = "Captures visible page objects as local internet scraps";

  private intersectionObserver?: IntersectionObserver;
  private mutationObserver?: MutationObserver;
  private visibilityTimers = new Map<Element, number>();
  private observedImages = new Set<HTMLImageElement>();
  private observedButtons = new Set<Element>();
  private observedHeadings = new Set<Element>();
  /** Elements painting a background image, with the image they paint. */
  private observedBackgrounds = new Map<Element, string>();
  private scannedBackgroundElements = new WeakSet<Element>();
  private backgroundScanQueue: BackgroundScanItem[] = [];
  private pendingBackgroundRescans = new Set<Element>();
  private backgroundRescanCounts = new WeakMap<Element, number>();
  private backgroundRescannedCount = 0;
  private backgroundScanHandle?: number;
  private backgroundScannedCount = 0;
  private backgroundCandidateCount = 0;
  private loadHandlers = new Map<HTMLImageElement, () => void>();
  private seenCanonicalImageKeys = new Set<string>();
  private seenCanonicalButtonKeys = new Set<string>();
  private seenCanonicalHeadingKeys = new Set<string>();
  private seenCanonicalCursorKeys = new Set<string>();
  private imageCaptureCount = 0;
  private buttonCaptureCount = 0;
  private headingCaptureCount = 0;
  private lastCursorCheckAt = Number.NEGATIVE_INFINITY;
  private readonly measureImage: ImageMeasurer;

  constructor(options: ScrapCollectorOptions = {}) {
    super();
    this.measureImage = options.measureImage ?? measureImageUrl;
  }

  start(): void {
    this.intersectionObserver = new IntersectionObserver(
      (entries) => this.handleIntersections(entries),
      { threshold: 0.5 },
    );

    document.querySelectorAll("img").forEach((image) => {
      this.observeImageCandidate(image);
    });
    document.querySelectorAll(BUTTON_SELECTOR).forEach((button) => {
      this.observeButtonCandidate(button);
    });
    document.querySelectorAll(HEADING_SELECTOR).forEach((heading) => {
      this.observeHeadingCandidate(heading);
    });

    if (document.body) this.queueBackgroundScan(document.body);

    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "attributes") {
          if (mutation.target instanceof Element) {
            this.queueBackgroundRescan(mutation.target);
          }
          continue;
        }
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          this.discoverCandidates(node);
        }
      }
    });

    if (document.body) {
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        // A lazy loader or carousel often swaps a background by changing an
        // existing element's class or style rather than adding a node.
        attributes: true,
        attributeFilter: BACKGROUND_ATTRIBUTES,
      });
    }

    document.addEventListener("mouseover", this.handleMouseover, {
      passive: true,
    });
  }

  stop(): void {
    this.intersectionObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.intersectionObserver = undefined;
    this.mutationObserver = undefined;
    document.removeEventListener("mouseover", this.handleMouseover);

    for (const timer of this.visibilityTimers.values()) {
      clearTimeout(timer);
    }
    this.visibilityTimers.clear();
    this.cancelBackgroundScan();

    for (const [image, handler] of this.loadHandlers) {
      image.removeEventListener("load", handler);
    }
    this.loadHandlers.clear();
    this.observedImages.clear();
    this.observedButtons.clear();
    this.observedHeadings.clear();
    this.observedBackgrounds.clear();
    this.scannedBackgroundElements = new WeakSet();
    this.backgroundScannedCount = 0;
    this.backgroundRescannedCount = 0;
    this.backgroundRescanCounts = new WeakMap();
    this.backgroundCandidateCount = 0;
    this.seenCanonicalImageKeys.clear();
    this.seenCanonicalButtonKeys.clear();
    this.seenCanonicalHeadingKeys.clear();
    this.seenCanonicalCursorKeys.clear();
    this.imageCaptureCount = 0;
    this.buttonCaptureCount = 0;
    this.headingCaptureCount = 0;
    this.lastCursorCheckAt = Number.NEGATIVE_INFINITY;
  }

  private discoverCandidates(node: Element): void {
    if (node instanceof HTMLImageElement) {
      this.observeImageCandidate(node);
    }
    if (node.matches(BUTTON_SELECTOR)) {
      this.observeButtonCandidate(node);
    }
    if (node.matches(HEADING_SELECTOR)) {
      this.observeHeadingCandidate(node);
    }

    node.querySelectorAll("img").forEach((image) => {
      this.observeImageCandidate(image);
    });
    node.querySelectorAll(BUTTON_SELECTOR).forEach((button) => {
      this.observeButtonCandidate(button);
    });
    node.querySelectorAll(HEADING_SELECTOR).forEach((heading) => {
      this.observeHeadingCandidate(heading);
    });
    this.queueBackgroundScan(node);
  }

  /**
   * CSS background images cannot be found with a selector, so each element's
   * computed `background-image` is read in idle slices, bounded per page so a
   * huge document costs a fixed number of style reads.
   */
  private queueBackgroundScan(root: Element): void {
    if (!this.backgroundScanEnabled()) return;
    this.backgroundScanQueue.push({ element: root, rescan: false });
    this.scheduleBackgroundScan();
  }

  /**
   * Re-reads an element whose `class` or `style` changed, and its subtree,
   * since an ancestor's class can decide its descendants' backgrounds.
   */
  private queueBackgroundRescan(element: Element): void {
    if (
      !this.backgroundScanEnabled() ||
      this.backgroundRescannedCount >= MAX_BACKGROUND_RESCANNED_ELEMENTS ||
      this.pendingBackgroundRescans.has(element)
    ) {
      return;
    }
    const rescans = this.backgroundRescanCounts.get(element) ?? 0;
    if (rescans >= MAX_BACKGROUND_RESCANS_PER_ELEMENT) return;
    this.backgroundRescanCounts.set(element, rescans + 1);
    this.pendingBackgroundRescans.add(element);
    this.backgroundScanQueue.push({ element, rescan: true });
    this.scheduleBackgroundScan();
  }

  private backgroundScanEnabled(): boolean {
    return (
      this.imageCaptureCount < MAX_IMAGES_PER_PAGE &&
      this.backgroundCandidateCount < MAX_BACKGROUND_CANDIDATES_PER_PAGE &&
      this.backgroundScannedCount < MAX_BACKGROUND_SCANNED_ELEMENTS
    );
  }

  private scheduleBackgroundScan(): void {
    if (this.backgroundScanHandle !== undefined) return;
    const run = () => {
      this.backgroundScanHandle = undefined;
      this.runBackgroundScan();
    };
    this.backgroundScanHandle =
      typeof window.requestIdleCallback === "function"
        ? window.requestIdleCallback(run, { timeout: 2000 })
        : window.setTimeout(run, 50);
  }

  private cancelBackgroundScan(): void {
    if (this.backgroundScanHandle !== undefined) {
      if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(this.backgroundScanHandle);
      } else {
        clearTimeout(this.backgroundScanHandle);
      }
      this.backgroundScanHandle = undefined;
    }
    this.backgroundScanQueue = [];
    this.pendingBackgroundRescans.clear();
  }

  private runBackgroundScan(): void {
    if (!this.enabled) {
      this.backgroundScanQueue = [];
      this.pendingBackgroundRescans.clear();
      return;
    }
    let budget = BACKGROUND_SCAN_CHUNK;
    while (budget > 0 && this.backgroundScanQueue.length > 0) {
      if (!this.backgroundScanEnabled()) {
        this.backgroundScanQueue = [];
        this.pendingBackgroundRescans.clear();
        return;
      }
      const { element, rescan } = this.backgroundScanQueue.pop()!;
      if (rescan) {
        this.pendingBackgroundRescans.delete(element);
        if (this.backgroundRescannedCount >= MAX_BACKGROUND_RESCANNED_ELEMENTS) {
          continue;
        }
      } else if (this.scannedBackgroundElements.has(element)) {
        continue;
      }
      this.scannedBackgroundElements.add(element);
      if (!element.isConnected || BACKGROUND_SKIP_TAGS.has(element.tagName)) {
        continue;
      }
      if (element.matches(EXTENSION_UI_SELECTOR)) continue;
      // An SVG paints its own pictures, which the icon path handles.
      if (element instanceof SVGElement) continue;

      budget--;
      if (rescan) {
        this.backgroundRescannedCount++;
      } else {
        this.backgroundScannedCount++;
      }
      this.observeBackgroundCandidate(element);

      for (let index = element.children.length - 1; index >= 0; index--) {
        this.backgroundScanQueue.push({ element: element.children[index], rescan });
      }
    }
    if (this.backgroundScanQueue.length > 0) this.scheduleBackgroundScan();
  }

  private observeBackgroundCandidate(element: Element): void {
    const url = backgroundImageUrl(getComputedStyle(element).backgroundImage);
    if (!url) {
      if (this.observedBackgrounds.delete(element)) this.releaseBackground(element);
      return;
    }
    if (this.observedBackgrounds.has(element)) {
      this.observedBackgrounds.set(element, url);
      return;
    }
    if (this.backgroundCandidateCount >= MAX_BACKGROUND_CANDIDATES_PER_PAGE) return;
    this.observedBackgrounds.set(element, url);
    this.backgroundCandidateCount++;
    this.intersectionObserver?.observe(element);
  }

  /** Stops watching an element that no longer paints a background, unless it is also another kind of candidate. */
  private releaseBackground(element: Element): void {
    if (
      this.observedImages.has(element as HTMLImageElement) ||
      this.observedButtons.has(element) ||
      this.observedHeadings.has(element)
    ) {
      return;
    }
    this.clearVisibilityTimer(element);
    this.intersectionObserver?.unobserve(element);
  }

  private observeImageCandidate(image: HTMLImageElement): void {
    if (
      this.imageCaptureCount >= MAX_IMAGES_PER_PAGE ||
      this.observedImages.has(image) ||
      this.loadHandlers.has(image)
    ) {
      return;
    }

    if (!image.complete) {
      const handleLoad = () => {
        this.loadHandlers.delete(image);
        if (this.enabled) {
          this.observeImageCandidate(image);
        }
      };
      this.loadHandlers.set(image, handleLoad);
      image.addEventListener("load", handleLoad, { once: true });
      return;
    }

    this.observedImages.add(image);
    this.intersectionObserver?.observe(image);
  }

  private observeButtonCandidate(button: Element): void {
    if (
      this.buttonCaptureCount >= MAX_BUTTONS_PER_PAGE ||
      this.observedButtons.has(button)
    ) {
      return;
    }
    this.observedButtons.add(button);
    this.intersectionObserver?.observe(button);
  }

  private observeHeadingCandidate(heading: Element): void {
    if (
      this.headingCaptureCount >= MAX_HEADINGS_PER_PAGE ||
      this.observedHeadings.has(heading) ||
      heading.closest(EXTENSION_UI_SELECTOR)
    ) {
      return;
    }
    this.observedHeadings.add(heading);
    this.intersectionObserver?.observe(heading);
  }

  private handleIntersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const candidate = entry.target;
      const isVisible =
        entry.isIntersecting &&
        (entry.intersectionRatio >= 0.5 || fillsHalfTheViewport(entry));

      if (!isVisible) {
        this.clearVisibilityTimer(candidate);
        continue;
      }
      if (this.visibilityTimers.has(candidate)) continue;

      const timer = window.setTimeout(() => {
        this.visibilityTimers.delete(candidate);
        this.captureCandidate(candidate);
        this.intersectionObserver?.unobserve(candidate);
        this.observedImages.delete(candidate as HTMLImageElement);
        this.observedButtons.delete(candidate);
        this.observedHeadings.delete(candidate);
        this.observedBackgrounds.delete(candidate);
      }, VISIBILITY_DELAY_MS);
      this.visibilityTimers.set(candidate, timer);
    }
  }

  private clearVisibilityTimer(candidate: Element): void {
    const timer = this.visibilityTimers.get(candidate);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.visibilityTimers.delete(candidate);
  }

  private captureCandidate(candidate: Element): void {
    // A button or heading can also paint a background image; both are kept.
    if (this.observedBackgrounds.has(candidate)) {
      void this.captureBackgroundImage(candidate);
    }

    if (this.observedImages.has(candidate as HTMLImageElement)) {
      this.captureImage(candidate as HTMLImageElement);
      return;
    }
    if (this.observedButtons.has(candidate)) {
      this.captureButton(candidate);
      return;
    }
    if (this.observedHeadings.has(candidate)) {
      this.captureHeading(candidate);
    }
  }

  private pageDomain(): string {
    return extractDomain(window.location.href);
  }

  /**
   * The color to paint behind a reconstructed element, for elements whose own
   * background does not cover their box. A solid background needs nothing; a
   * see-through one gets the color it was read against, so light text stays
   * legible away from the page that supplied the contrast.
   */
  private backdropFor(
    element: Element,
    ownBackgroundColor: string,
    hasGradient: boolean,
  ): string | undefined {
    if (hasGradient) return undefined;
    const ownAlpha = colorAlpha(ownBackgroundColor);
    // A background this reader cannot parse might let the page through, so the
    // backdrop is recorded rather than assumed away.
    return ownAlpha === undefined || ownAlpha < 1
      ? resolveBackdropColor(element)
      : undefined;
  }

  /**
   * The element's centre in document coordinates, alongside the document's
   * scroll size, so the scrap can be placed back on a map of its page.
   */
  private elementPosition(bounds: DOMRect): ScrapPosition {
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    return {
      pageX: Math.round(bounds.left + bounds.width / 2 + window.scrollX),
      pageY: Math.round(bounds.top + bounds.height / 2 + window.scrollY),
      pageWidth: Math.round(scrollingElement.scrollWidth),
      pageHeight: Math.round(scrollingElement.scrollHeight),
    };
  }

  private captureImage(image: HTMLImageElement): void {
    if (!this.enabled || this.imageCaptureCount >= MAX_IMAGES_PER_PAGE) return;

    const src = image.currentSrc || image.src;
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;

    const bounds = image.getBoundingClientRect();
    if (
      bounds.width < MIN_IMAGE_DISPLAY_SIZE ||
      bounds.height < MIN_IMAGE_DISPLAY_SIZE
    ) {
      return;
    }
    if (
      image.naturalWidth < MIN_IMAGE_NATURAL_SIZE ||
      image.naturalHeight < MIN_IMAGE_NATURAL_SIZE
    ) {
      return;
    }
    if (!isEffectivelyVisible(image, getComputedStyle(image))) return;

    const data: ScrapEventData = {
      kind: "image",
      src,
      ...(image.alt ? { alt: image.alt } : {}),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      displayWidth: bounds.width,
      displayHeight: bounds.height,
      pageTitle: document.title,
      position: this.elementPosition(bounds),
    };
    const canonicalKey = getScrapEncounterKey(
      this.pageDomain(),
      data,
      window.location.href,
      Date.now(),
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    )!;
    if (this.seenCanonicalImageKeys.has(canonicalKey)) return;

    const faviconUrl = getFaviconUrl();
    this.seenCanonicalImageKeys.add(canonicalKey);
    this.imageCaptureCount++;
    this.emit({
      ...data,
      ...(faviconUrl ? { faviconUrl } : {}),
    });

    if (this.imageCaptureCount >= MAX_IMAGES_PER_PAGE) {
      this.stopObservingImages();
    }
  }

  /**
   * A CSS background image kept as an image scrap, under the same size, visibility
   * and identity rules as an `<img>`, so the same picture seen both ways is one
   * scrap. Its intrinsic size is not on the element, so the image is loaded
   * (normally from cache) to learn it.
   */
  private async captureBackgroundImage(element: Element): Promise<void> {
    if (!this.enabled || this.imageCaptureCount >= MAX_IMAGES_PER_PAGE) return;

    // Read now rather than trusting the scan, so the scrap is the picture that
    // was actually on screen if the page swapped it in the meantime.
    const computedStyle = getComputedStyle(element);
    const url = backgroundImageUrl(computedStyle.backgroundImage);
    if (!url) return;

    const bounds = element.getBoundingClientRect();
    if (
      bounds.width < MIN_IMAGE_DISPLAY_SIZE ||
      bounds.height < MIN_IMAGE_DISPLAY_SIZE
    ) {
      return;
    }
    if (!isEffectivelyVisible(element, computedStyle)) return;

    // Identity rests on the source alone, so a picture already kept on this
    // page skips the load.
    const encounterKey = (data: ScrapEventData) =>
      getScrapEncounterKey(
        this.pageDomain(),
        data,
        window.location.href,
        Date.now(),
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      )!;
    const sourceOnly: ScrapEventData = {
      kind: "image",
      src: url,
      naturalWidth: 0,
      naturalHeight: 0,
      displayWidth: 0,
      displayHeight: 0,
      pageTitle: "",
    };
    if (this.seenCanonicalImageKeys.has(encounterKey(sourceOnly))) return;

    const size = await this.measureImage(url);
    if (
      !size ||
      size.width < MIN_IMAGE_NATURAL_SIZE ||
      size.height < MIN_IMAGE_NATURAL_SIZE
    ) {
      return;
    }
    if (!this.enabled || this.imageCaptureCount >= MAX_IMAGES_PER_PAGE) return;

    const alt = backgroundAlt(element);
    const data: ScrapEventData = {
      kind: "image",
      src: url,
      ...(alt ? { alt } : {}),
      naturalWidth: size.width,
      naturalHeight: size.height,
      displayWidth: bounds.width,
      displayHeight: bounds.height,
      pageTitle: document.title,
      position: this.elementPosition(bounds),
    };
    const canonicalKey = encounterKey(data);
    if (this.seenCanonicalImageKeys.has(canonicalKey)) return;

    const faviconUrl = getFaviconUrl();
    this.seenCanonicalImageKeys.add(canonicalKey);
    this.imageCaptureCount++;
    this.emit({
      ...data,
      ...(faviconUrl ? { faviconUrl } : {}),
    });

    if (this.imageCaptureCount >= MAX_IMAGES_PER_PAGE) {
      this.stopObservingImages();
    }
  }

  private captureButton(button: Element): void {
    if (!this.enabled || this.buttonCaptureCount >= MAX_BUTTONS_PER_PAGE) return;

    const bounds = button.getBoundingClientRect();
    if (
      bounds.width < MIN_BUTTON_WIDTH ||
      bounds.width > MAX_BUTTON_WIDTH ||
      bounds.height < MIN_BUTTON_HEIGHT ||
      bounds.height > MAX_BUTTON_HEIGHT
    ) {
      return;
    }

    const inlineSvg = button.querySelector("svg");
    const text = this.getButtonText(button);
    if (
      (!inlineSvg && text.length < MIN_BUTTON_TEXT_LENGTH) ||
      text.length > MAX_BUTTON_TEXT_LENGTH
    ) {
      return;
    }

    const computedStyle = getComputedStyle(button);
    if (!isEffectivelyVisible(button, computedStyle)) return;

    const styles = this.pickButtonStyles(computedStyle);
    const innerSvg = inlineSvg
      ? this.serializeButtonSvg(inlineSvg as SVGSVGElement)
      : undefined;
    if (!text && !innerSvg) return;
    // Plain text a site merely tagged as a button is prose, not an object.
    // Checked before the cap so a page of them still leaves room for real ones.
    if (isBareTextButton(styles, innerSvg !== undefined)) return;

    const backdropColor = this.backdropFor(
      button,
      computedStyle.backgroundColor,
      styles.backgroundImage !== undefined,
    );
    const data: ButtonScrapData = {
      kind: "button",
      text,
      styles,
      ...(innerSvg ? { innerSvg } : {}),
      ...(backdropColor ? { backdropColor } : {}),
      pageTitle: document.title,
      position: this.elementPosition(bounds),
    };
    const canonicalKey = getCanonicalScrapKey(this.pageDomain(), data);
    if (this.seenCanonicalButtonKeys.has(canonicalKey)) return;

    const faviconUrl = getFaviconUrl();
    this.seenCanonicalButtonKeys.add(canonicalKey);
    this.buttonCaptureCount++;
    this.emit({
      ...data,
      ...(faviconUrl ? { faviconUrl } : {}),
    });

    if (this.buttonCaptureCount >= MAX_BUTTONS_PER_PAGE) {
      this.stopObservingButtons();
    }
  }

  private getButtonText(button: Element): string {
    const rawText =
      button instanceof HTMLInputElement
        ? button.getAttribute("value") ?? ""
        : "innerText" in button && typeof button.innerText === "string"
          ? button.innerText
          : button.textContent ?? "";
    return rawText.replace(/\s+/g, " ").trim();
  }

  private pickButtonStyles(computedStyle: CSSStyleDeclaration): Record<string, string> {
    const styles: Record<string, string> = {};
    for (const property of BUTTON_STYLE_PROPERTIES) {
      const value = computedStyle[property];
      if (value) styles[property] = value;
    }

    if (computedStyle.border) {
      styles.border = computedStyle.border;
    } else {
      for (const property of BUTTON_BORDER_PROPERTIES) {
        const value = computedStyle[property];
        if (value) styles[property] = value;
      }
    }

    if (GRADIENT_PATTERN.test(computedStyle.backgroundImage.trim())) {
      styles.backgroundImage = computedStyle.backgroundImage;
    }
    return styles;
  }

  private serializeButtonSvg(svg: SVGSVGElement): string | undefined {
    const bounds = svg.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return undefined;
    return serializeSvg(svg, {
      width: bounds.width,
      height: bounds.height,
      color: getComputedStyle(svg).color,
      maxBytes: MAX_BUTTON_SVG_BYTES,
    });
  }

  private captureHeading(heading: Element): void {
    if (
      !this.enabled ||
      this.headingCaptureCount >= MAX_HEADINGS_PER_PAGE ||
      heading.closest(EXTENSION_UI_SELECTOR)
    ) {
      return;
    }

    const level = headingLevel(heading);
    if (level === undefined) return;

    const text = normalizeHeadingText(heading);
    if (
      text.length < MIN_HEADING_TEXT_LENGTH ||
      text.length > MAX_HEADING_TEXT_LENGTH
    ) {
      return;
    }

    const bounds = heading.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;

    const computedStyle = getComputedStyle(heading);
    if (!isEffectivelyVisible(heading, computedStyle)) return;

    const data: HeadingScrapData = {
      kind: "heading",
      text,
      level,
      styles: pickHeadingStyles(computedStyle),
      pageTitle: document.title,
      position: this.elementPosition(bounds),
    };
    const canonicalKey = getCanonicalScrapKey(this.pageDomain(), data);
    if (this.seenCanonicalHeadingKeys.has(canonicalKey)) return;

    const faviconUrl = getFaviconUrl();
    this.seenCanonicalHeadingKeys.add(canonicalKey);
    this.headingCaptureCount++;
    this.emit({
      ...data,
      ...(faviconUrl ? { faviconUrl } : {}),
    });

    if (this.headingCaptureCount >= MAX_HEADINGS_PER_PAGE) {
      this.stopObservingHeadings();
    }
  }

  private handleMouseover = (event: MouseEvent): void => {
    if (!this.enabled || !(event.target instanceof Element)) return;
    const now = Date.now();
    if (now - this.lastCursorCheckAt < CURSOR_CHECK_INTERVAL_MS) return;
    this.lastCursorCheckAt = now;

    const cursorImage = this.parseCursorImage(getComputedStyle(event.target).cursor);
    if (!cursorImage || cursorImage.url.startsWith("blob:")) return;

    const data: CursorScrapData = {
      kind: "cursor",
      url: cursorImage.url,
      ...(cursorImage.hotspotX !== undefined
        ? { hotspotX: cursorImage.hotspotX }
        : {}),
      ...(cursorImage.hotspotY !== undefined
        ? { hotspotY: cursorImage.hotspotY }
        : {}),
      pageTitle: document.title,
      position: this.pointerPosition(event),
    };
    const canonicalKey = getCanonicalScrapKey(this.pageDomain(), data);
    if (this.seenCanonicalCursorKeys.has(canonicalKey)) return;

    const faviconUrl = getFaviconUrl();
    this.seenCanonicalCursorKeys.add(canonicalKey);
    this.emit({
      ...data,
      ...(faviconUrl ? { faviconUrl } : {}),
    });
  };

  /** Where the pointer was, in the same document coordinates as element scraps. */
  private pointerPosition(event: MouseEvent): ScrapPosition {
    const scrollingElement = document.scrollingElement ?? document.documentElement;
    return {
      pageX: Math.round(event.pageX),
      pageY: Math.round(event.pageY),
      pageWidth: Math.round(scrollingElement.scrollWidth),
      pageHeight: Math.round(scrollingElement.scrollHeight),
    };
  }

  private parseCursorImage(cursor: string): CursorImage | undefined {
    const match = CURSOR_URL_PATTERN.exec(cursor);
    if (!match) return undefined;
    const url = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!url) return undefined;

    const hotspotX = match[4] === undefined ? undefined : Number(match[4]);
    const hotspotY = match[5] === undefined ? undefined : Number(match[5]);
    return {
      url,
      ...(hotspotX !== undefined ? { hotspotX } : {}),
      ...(hotspotY !== undefined ? { hotspotY } : {}),
    };
  }

  private stopObservingImages(): void {
    for (const image of this.observedImages) {
      this.clearVisibilityTimer(image);
      this.intersectionObserver?.unobserve(image);
    }
    for (const [image, handler] of this.loadHandlers) {
      image.removeEventListener("load", handler);
    }
    this.loadHandlers.clear();
    this.observedImages.clear();
    for (const element of this.observedBackgrounds.keys()) {
      // A button or heading painting a background keeps its own observation.
      if (this.observedButtons.has(element) || this.observedHeadings.has(element)) {
        continue;
      }
      this.clearVisibilityTimer(element);
      this.intersectionObserver?.unobserve(element);
    }
    this.observedBackgrounds.clear();
    this.cancelBackgroundScan();
  }

  private stopObservingButtons(): void {
    for (const button of this.observedButtons) {
      this.clearVisibilityTimer(button);
      this.intersectionObserver?.unobserve(button);
    }
    this.observedButtons.clear();
  }

  private stopObservingHeadings(): void {
    for (const heading of this.observedHeadings) {
      this.clearVisibilityTimer(heading);
      this.intersectionObserver?.unobserve(heading);
    }
    this.observedHeadings.clear();
  }
}

/**
 * The topmost image layer of a computed `background-image`, or undefined when
 * it paints only gradients or an inline data/blob image, which `<img>` capture
 * skips too.
 */
export function backgroundImageUrl(backgroundImage: string): string | undefined {
  if (!backgroundImage || !backgroundImage.includes("url(")) return undefined;
  BACKGROUND_URL_PATTERN.lastIndex = 0;
  const match = BACKGROUND_URL_PATTERN.exec(backgroundImage);
  BACKGROUND_URL_PATTERN.lastIndex = 0;
  if (!match) return undefined;
  const url = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return undefined;
  return url;
}

/** The label a site gave an element standing in for a picture, if any. */
function backgroundAlt(element: Element): string | undefined {
  const label = element.getAttribute("aria-label") ?? element.getAttribute("title");
  const trimmed = label?.replace(/\s+/g, " ").trim();
  return trimmed || undefined;
}

/**
 * Whether a visible element covers at least half the viewport. A hero or page
 * background taller than the screen can never be half on screen, but filling
 * the screen is plainly seen.
 */
function fillsHalfTheViewport(entry: IntersectionObserverEntry): boolean {
  const visible = entry.intersectionRect;
  if (!visible) return false;
  const root = entry.rootBounds;
  const viewportArea =
    (root?.width ?? window.innerWidth) * (root?.height ?? window.innerHeight);
  return viewportArea > 0 && visible.width * visible.height >= viewportArea * 0.5;
}

/** Loads an image off-page to read its intrinsic size; the cache usually has it. */
function measureImageUrl(url: string): Promise<ImageSize | undefined> {
  return new Promise((resolve) => {
    const image = new Image();
    const finish = (size: ImageSize | undefined) => {
      image.onload = null;
      image.onerror = null;
      resolve(size);
    };
    image.onload = () =>
      finish({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => finish(undefined);
    image.src = url;
  });
}

/** A heading keeps its type and text color only; it saves no background. */
function pickHeadingStyles(
  computedStyle: CSSStyleDeclaration,
): Partial<Record<HeadingStyleProperty, string>> {
  const styles: Partial<Record<HeadingStyleProperty, string>> = {};
  for (const property of HEADING_STYLE_PROPERTIES) {
    const value = computedStyle[property];
    if (value) styles[property] = value;
  }
  return styles;
}

function headingLevel(heading: Element): 1 | 2 | 3 | undefined {
  switch (heading.tagName.toLowerCase()) {
    case "h1":
      return 1;
    case "h2":
      return 2;
    case "h3":
      return 3;
    default:
      return undefined;
  }
}

/**
 * The heading's own words, from `textContent` rather than `innerText`, because
 * `innerText` returns text with `text-transform` already applied and the
 * captured `textTransform` applies it again at render.
 */
function normalizeHeadingText(heading: Element): string {
  return (heading.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Whether a computed style hides the element it belongs to and its subtree. */
function styleHides(style: CSSStyleDeclaration): boolean {
  if (style.display === "none") return true;
  if (style.visibility === "hidden" || style.visibility === "collapse") {
    return true;
  }
  if (Number.parseFloat(style.opacity) === 0) return true;
  if (COLLAPSED_CLIP_PATTERN.test(style.clip.trim())) return true;
  return style.clipPath.trim().toLowerCase() === "inset(100%)";
}

/**
 * Whether a reader could actually see the element. Its own computed style is
 * not enough: `display`, `opacity`, `clip` and `clip-path` do not inherit, so
 * a heading inside an `opacity: 0` wrapper still reports `opacity: 1` of its
 * own. Walking the ancestors catches the wrapper, capped in depth like the
 * backdrop walk so a deep tree costs a bounded number of style reads.
 *
 * `visibility` needs no walk: it inherits, and a descendant that sets
 * `visibility: visible` genuinely shows through a hidden parent, so the
 * element's own computed value is already the answer.
 */
function isEffectivelyVisible(
  element: Element,
  ownStyle: CSSStyleDeclaration,
): boolean {
  if (styleHides(ownStyle)) return false;

  let ancestor = element.parentElement;
  for (let depth = 0; ancestor && depth < MAX_VISIBILITY_DEPTH; depth++) {
    const style = getComputedStyle(ancestor);
    if (style.display === "none") return false;
    if (Number.parseFloat(style.opacity) === 0) return false;
    if (COLLAPSED_CLIP_PATTERN.test(style.clip.trim())) return false;
    if (style.clipPath.trim().toLowerCase() === "inset(100%)") return false;
    ancestor = ancestor.parentElement;
  }
  return true;
}

/**
 * The flat color a see-through element is seen against: the nearest ancestor
 * that actually paints one. An ancestor carrying only an image or gradient is
 * skipped rather than guessed at, as is one whose background this reader
 * cannot parse, and a tree that paints nothing leaves the page canvas, which
 * is white.
 */
function resolveBackdropColor(element: Element): string | undefined {
  let ancestor = element.parentElement;
  for (let depth = 0; ancestor && depth < MAX_BACKDROP_DEPTH; depth++) {
    const background = getComputedStyle(ancestor).backgroundColor;
    // Only a color read as fully solid can stand in as the backdrop.
    if (colorAlpha(background) === 1) return background;
    if (ancestor === document.documentElement) return CANVAS_BACKDROP_COLOR;
    ancestor = ancestor.parentElement;
  }
  return ancestor ? undefined : CANVAS_BACKDROP_COLOR;
}
