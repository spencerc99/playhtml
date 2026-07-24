// ABOUTME: Captures visible images, controls, icons, and cursor artwork as internet scraps.
// ABOUTME: Applies per-kind filtering, visibility timing, sanitization, and page-session limits.

import { BaseCollector } from "./BaseCollector";
import { getScrapKey, serializeSvg } from "./scrapUtils";
import type {
  ButtonScrapData,
  CursorScrapData,
  ScrapEventData,
  SvgIconScrapData,
} from "./types";
import { getFaviconUrl } from "../utils/pageMetadata";

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
const VISIBILITY_DELAY_MS = 1000;
const CURSOR_CHECK_INTERVAL_MS = 500;
const MAX_IMAGES_PER_PAGE = 50;
const MAX_BUTTONS_PER_PAGE = 20;
const MAX_SVG_ICONS_PER_PAGE = 20;
const MAX_SVG_MARKUP_BYTES = 20 * 1024;
const MAX_BUTTON_SVG_BYTES = 8 * 1024;
const BUTTON_SELECTOR =
  'button, input[type="submit"], input[type="button"], [role="button"]';
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
  private loadHandlers = new Map<HTMLImageElement, () => void>();
  private seenImageSources = new Set<string>();
  private seenButtonKeys = new Set<string>();
  private seenSvgKeys = new Set<string>();
  private seenCursorUrls = new Set<string>();
  private imageCaptureCount = 0;
  private buttonCaptureCount = 0;
  private svgCaptureCount = 0;
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
    this.seenImageSources.clear();
    this.seenButtonKeys.clear();
    this.seenSvgKeys.clear();
    this.seenCursorUrls.clear();
    this.imageCaptureCount = 0;
    this.buttonCaptureCount = 0;
    this.svgCaptureCount = 0;
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

    node.querySelectorAll("img").forEach((image) => {
      this.observeImageCandidate(image);
    });
    node.querySelectorAll(BUTTON_SELECTOR).forEach((button) => {
      this.observeButtonCandidate(button);
    });
    node.querySelectorAll("svg").forEach((svg) => {
      this.observeSvgCandidate(svg as SVGSVGElement);
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
    }
  }

  private captureImage(image: HTMLImageElement): void {
    if (!this.enabled || this.imageCaptureCount >= MAX_IMAGES_PER_PAGE) return;

    const src = image.currentSrc || image.src;
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
    if (this.seenImageSources.has(src)) return;

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

    const faviconUrl = getFaviconUrl();
    this.seenImageSources.add(src);
    this.imageCaptureCount++;
    this.emit({
      kind: "image",
      src,
      ...(image.alt ? { alt: image.alt } : {}),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      displayWidth: bounds.width,
      displayHeight: bounds.height,
      pageTitle: document.title,
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

    const faviconUrl = getFaviconUrl();
    const data: ButtonScrapData = {
      kind: "button",
      text,
      styles,
      ...(innerSvg ? { innerSvg } : {}),
      pageTitle: document.title,
      ...(faviconUrl ? { faviconUrl } : {}),
    };
    const key = getScrapKey(data);
    if (this.seenButtonKeys.has(key)) return;

    this.seenButtonKeys.add(key);
    this.buttonCaptureCount++;
    this.emit(data);

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

    const faviconUrl = getFaviconUrl();
    const data: SvgIconScrapData = {
      kind: "svg-icon",
      markup,
      width: bounds.width,
      height: bounds.height,
      pageTitle: document.title,
      ...(faviconUrl ? { faviconUrl } : {}),
    };
    const key = getScrapKey(data);
    if (this.seenSvgKeys.has(key)) return;

    this.seenSvgKeys.add(key);
    this.svgCaptureCount++;
    this.emit(data);

    if (this.svgCaptureCount >= MAX_SVG_ICONS_PER_PAGE) {
      this.stopObservingSvgIcons();
    }
  }

  private handleMouseover = (event: MouseEvent): void => {
    if (!this.enabled || !(event.target instanceof Element)) return;
    const now = Date.now();
    if (now - this.lastCursorCheckAt < CURSOR_CHECK_INTERVAL_MS) return;
    this.lastCursorCheckAt = now;

    const cursorImage = this.parseCursorImage(getComputedStyle(event.target).cursor);
    if (
      !cursorImage ||
      cursorImage.url.startsWith("blob:") ||
      this.seenCursorUrls.has(cursorImage.url)
    ) {
      return;
    }

    const faviconUrl = getFaviconUrl();
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
      ...(faviconUrl ? { faviconUrl } : {}),
    };
    this.seenCursorUrls.add(getScrapKey(data));
    this.emit(data);
  };

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
}
