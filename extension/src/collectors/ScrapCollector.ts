// ABOUTME: Captures visible images, controls, icons, headings, and cursor artwork as internet scraps.
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
  ScrapEventData,
  ScrapPosition,
  SvgIconScrapData,
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
const MIN_SVG_SIZE = 12;
const MAX_SVG_SIZE = 400;
const MIN_HEADING_TEXT_LENGTH = 2;
const MAX_HEADING_TEXT_LENGTH = 120;
const VISIBILITY_DELAY_MS = 1000;
const CURSOR_CHECK_INTERVAL_MS = 500;
const MAX_IMAGES_PER_PAGE = 50;
const MAX_BUTTONS_PER_PAGE = 20;
const MAX_SVG_ICONS_PER_PAGE = 20;
const MAX_HEADINGS_PER_PAGE = 20;
const MAX_SVG_MARKUP_BYTES = 20 * 1024;
const MAX_BUTTON_SVG_BYTES = 8 * 1024;
const BUTTON_SELECTOR =
  'button, input[type="submit"], input[type="button"], [role="button"]';
const HEADING_SELECTOR = "h1, h2, h3";
/** Light-DOM hosts for the extension's own injected UI, whose text is not a scrap. */
const EXTENSION_UI_SELECTOR =
  '[id^="wwo-"], [id^="wewere-"], [id^="we-were-online-"], [id^="playhtml-"]';
/** How far up the tree to look for the color a see-through element sits on. */
const MAX_BACKDROP_DEPTH = 12;
/** What a page paints over when nothing in the tree supplies a color. */
const CANVAS_BACKDROP_COLOR = "rgb(255, 255, 255)";
const GRADIENT_PATTERN =
  /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;
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

const HEADING_STYLE_PROPERTIES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "color",
  "letterSpacing",
  "textTransform",
  "lineHeight",
] as const;

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
  private observedSvgIcons = new Set<SVGSVGElement>();
  private observedHeadings = new Set<Element>();
  private loadHandlers = new Map<HTMLImageElement, () => void>();
  private seenCanonicalImageKeys = new Set<string>();
  private seenCanonicalButtonKeys = new Set<string>();
  private seenCanonicalSvgKeys = new Set<string>();
  private seenCanonicalHeadingKeys = new Set<string>();
  private seenCanonicalCursorKeys = new Set<string>();
  private imageCaptureCount = 0;
  private buttonCaptureCount = 0;
  private svgCaptureCount = 0;
  private headingCaptureCount = 0;
  private lastCursorCheckAt = Number.NEGATIVE_INFINITY;

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
    document.querySelectorAll("svg").forEach((svg) => {
      this.observeSvgCandidate(svg as SVGSVGElement);
    });
    document.querySelectorAll(HEADING_SELECTOR).forEach((heading) => {
      this.observeHeadingCandidate(heading);
    });

    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
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

    for (const [image, handler] of this.loadHandlers) {
      image.removeEventListener("load", handler);
    }
    this.loadHandlers.clear();
    this.observedImages.clear();
    this.observedButtons.clear();
    this.observedSvgIcons.clear();
    this.observedHeadings.clear();
    this.seenCanonicalImageKeys.clear();
    this.seenCanonicalButtonKeys.clear();
    this.seenCanonicalSvgKeys.clear();
    this.seenCanonicalHeadingKeys.clear();
    this.seenCanonicalCursorKeys.clear();
    this.imageCaptureCount = 0;
    this.buttonCaptureCount = 0;
    this.svgCaptureCount = 0;
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
    if (node instanceof SVGSVGElement) {
      this.observeSvgCandidate(node);
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
    node.querySelectorAll("svg").forEach((svg) => {
      this.observeSvgCandidate(svg as SVGSVGElement);
    });
    node.querySelectorAll(HEADING_SELECTOR).forEach((heading) => {
      this.observeHeadingCandidate(heading);
    });
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

  private observeSvgCandidate(svg: SVGSVGElement): void {
    if (
      this.svgCaptureCount >= MAX_SVG_ICONS_PER_PAGE ||
      this.observedSvgIcons.has(svg) ||
      svg.closest(BUTTON_SELECTOR)
    ) {
      return;
    }
    this.observedSvgIcons.add(svg);
    this.intersectionObserver?.observe(svg);
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
      const isVisible = entry.isIntersecting && entry.intersectionRatio >= 0.5;

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
        this.observedSvgIcons.delete(candidate as SVGSVGElement);
        this.observedHeadings.delete(candidate);
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
    if (this.observedImages.has(candidate as HTMLImageElement)) {
      this.captureImage(candidate as HTMLImageElement);
      return;
    }
    if (this.observedButtons.has(candidate)) {
      this.captureButton(candidate);
      return;
    }
    if (this.observedSvgIcons.has(candidate as SVGSVGElement)) {
      this.captureSvgIcon(candidate as SVGSVGElement);
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
    return colorAlpha(ownBackgroundColor) < 1
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

  private captureSvgIcon(svg: SVGSVGElement): void {
    if (
      !this.enabled ||
      this.svgCaptureCount >= MAX_SVG_ICONS_PER_PAGE ||
      svg.closest(BUTTON_SELECTOR)
    ) {
      return;
    }

    const bounds = svg.getBoundingClientRect();
    if (
      bounds.width < MIN_SVG_SIZE ||
      bounds.width > MAX_SVG_SIZE ||
      bounds.height < MIN_SVG_SIZE ||
      bounds.height > MAX_SVG_SIZE
    ) {
      return;
    }

    const markup = serializeSvg(svg, {
      width: bounds.width,
      height: bounds.height,
      color: getComputedStyle(svg).color,
      maxBytes: MAX_SVG_MARKUP_BYTES,
    });
    if (!markup) return;

    const data: SvgIconScrapData = {
      kind: "svg-icon",
      markup,
      width: bounds.width,
      height: bounds.height,
      pageTitle: document.title,
      position: this.elementPosition(bounds),
    };
    const canonicalKey = getCanonicalScrapKey(this.pageDomain(), data);
    if (this.seenCanonicalSvgKeys.has(canonicalKey)) return;

    const faviconUrl = getFaviconUrl();
    this.seenCanonicalSvgKeys.add(canonicalKey);
    this.svgCaptureCount++;
    this.emit({
      ...data,
      ...(faviconUrl ? { faviconUrl } : {}),
    });

    if (this.svgCaptureCount >= MAX_SVG_ICONS_PER_PAGE) {
      this.stopObservingSvgIcons();
    }
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
    if (computedStyle.visibility === "hidden" || computedStyle.opacity === "0") {
      return;
    }

    const backdropColor = this.backdropFor(
      heading,
      computedStyle.backgroundColor,
      false,
    );
    const data: HeadingScrapData = {
      kind: "heading",
      text,
      level,
      styles: this.pickHeadingStyles(computedStyle),
      ...(backdropColor ? { backdropColor } : {}),
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

  private pickHeadingStyles(
    computedStyle: CSSStyleDeclaration,
  ): Record<string, string> {
    const styles: Record<string, string> = {};
    for (const property of HEADING_STYLE_PROPERTIES) {
      const value = computedStyle[property];
      if (value) styles[property] = value;
    }

    const backgroundColor = computedStyle.backgroundColor;
    if (backgroundColor && colorAlpha(backgroundColor) > 0) {
      styles.backgroundColor = backgroundColor;
    }
    return styles;
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
  }

  private stopObservingButtons(): void {
    for (const button of this.observedButtons) {
      this.clearVisibilityTimer(button);
      this.intersectionObserver?.unobserve(button);
    }
    this.observedButtons.clear();
  }

  private stopObservingSvgIcons(): void {
    for (const svg of this.observedSvgIcons) {
      this.clearVisibilityTimer(svg);
      this.intersectionObserver?.unobserve(svg);
    }
    this.observedSvgIcons.clear();
  }

  private stopObservingHeadings(): void {
    for (const heading of this.observedHeadings) {
      this.clearVisibilityTimer(heading);
      this.intersectionObserver?.unobserve(heading);
    }
    this.observedHeadings.clear();
  }
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

/**
 * The flat color a see-through element is seen against: the nearest ancestor
 * that actually paints one. An ancestor carrying only an image or gradient is
 * skipped rather than guessed at, and a tree that paints nothing leaves the
 * page canvas, which is white.
 */
function resolveBackdropColor(element: Element): string | undefined {
  let ancestor = element.parentElement;
  for (let depth = 0; ancestor && depth < MAX_BACKDROP_DEPTH; depth++) {
    const background = getComputedStyle(ancestor).backgroundColor;
    if (colorAlpha(background) === 1) return background;
    if (ancestor === document.documentElement) return CANVAS_BACKDROP_COLOR;
    ancestor = ancestor.parentElement;
  }
  return ancestor ? undefined : CANVAS_BACKDROP_COLOR;
}
