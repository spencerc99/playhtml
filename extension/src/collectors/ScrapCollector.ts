// ABOUTME: Captures visible page images as locally stored internet scraps.
// ABOUTME: Filters unusable image sources and bounds collection on image-heavy pages.

import { BaseCollector } from "./BaseCollector";
import type { ScrapEventData } from "./types";
import { getFaviconUrl } from "../utils/pageMetadata";

const MIN_DISPLAY_SIZE = 80;
const MIN_NATURAL_SIZE = 50;
const VISIBILITY_DELAY_MS = 1000;
const MAX_SCRAPS_PER_PAGE = 50;

export class ScrapCollector extends BaseCollector<ScrapEventData> {
  readonly type = "image" as const;
  readonly description = "Captures visible images as local internet scraps";

  private intersectionObserver?: IntersectionObserver;
  private mutationObserver?: MutationObserver;
  private visibilityTimers = new Map<HTMLImageElement, number>();
  private observedImages = new Set<HTMLImageElement>();
  private loadHandlers = new Map<HTMLImageElement, () => void>();
  private seenSources = new Set<string>();
  private captureCount = 0;

  start(): void {
    this.intersectionObserver = new IntersectionObserver(
      (entries) => this.handleIntersections(entries),
      { threshold: 0.5 },
    );

    document.querySelectorAll("img").forEach((image) => {
      this.observeCandidate(image);
    });

    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node instanceof HTMLImageElement) {
            this.observeCandidate(node);
          }
          node.querySelectorAll("img").forEach((image) => {
            this.observeCandidate(image);
          });
        }
      }
    });

    if (document.body) {
      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
      });
    }
  }

  stop(): void {
    this.intersectionObserver?.disconnect();
    this.mutationObserver?.disconnect();
    this.intersectionObserver = undefined;
    this.mutationObserver = undefined;

    for (const timer of this.visibilityTimers.values()) {
      clearTimeout(timer);
    }
    this.visibilityTimers.clear();

    for (const [image, handler] of this.loadHandlers) {
      image.removeEventListener("load", handler);
    }
    this.loadHandlers.clear();
    this.observedImages.clear();
    this.seenSources.clear();
    this.captureCount = 0;
  }

  private observeCandidate(image: HTMLImageElement): void {
    if (
      this.captureCount >= MAX_SCRAPS_PER_PAGE ||
      this.observedImages.has(image) ||
      this.loadHandlers.has(image)
    ) {
      return;
    }

    if (!image.complete) {
      const handleLoad = () => {
        this.loadHandlers.delete(image);
        if (this.enabled) {
          this.observeCandidate(image);
        }
      };
      this.loadHandlers.set(image, handleLoad);
      image.addEventListener("load", handleLoad, { once: true });
      return;
    }

    this.observedImages.add(image);
    this.intersectionObserver?.observe(image);
  }

  private handleIntersections(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const image = entry.target as HTMLImageElement;
      const isVisible = entry.isIntersecting && entry.intersectionRatio >= 0.5;

      if (!isVisible) {
        this.clearVisibilityTimer(image);
        continue;
      }
      if (this.visibilityTimers.has(image)) continue;

      const timer = window.setTimeout(() => {
        this.visibilityTimers.delete(image);
        this.capture(image);
        this.intersectionObserver?.unobserve(image);
        this.observedImages.delete(image);
      }, VISIBILITY_DELAY_MS);
      this.visibilityTimers.set(image, timer);
    }
  }

  private clearVisibilityTimer(image: HTMLImageElement): void {
    const timer = this.visibilityTimers.get(image);
    if (timer === undefined) return;
    clearTimeout(timer);
    this.visibilityTimers.delete(image);
  }

  private capture(image: HTMLImageElement): void {
    if (!this.enabled || this.captureCount >= MAX_SCRAPS_PER_PAGE) return;

    const src = image.currentSrc || image.src;
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
    if (this.seenSources.has(src)) return;

    const bounds = image.getBoundingClientRect();
    if (bounds.width < MIN_DISPLAY_SIZE || bounds.height < MIN_DISPLAY_SIZE) return;
    if (image.naturalWidth < MIN_NATURAL_SIZE || image.naturalHeight < MIN_NATURAL_SIZE) {
      return;
    }

    const faviconUrl = getFaviconUrl();
    this.seenSources.add(src);
    this.captureCount++;
    this.emit({
      src,
      ...(image.alt ? { alt: image.alt } : {}),
      naturalWidth: image.naturalWidth,
      naturalHeight: image.naturalHeight,
      displayWidth: bounds.width,
      displayHeight: bounds.height,
      pageTitle: document.title,
      ...(faviconUrl ? { faviconUrl } : {}),
    });

    if (this.captureCount >= MAX_SCRAPS_PER_PAGE) {
      this.stopObservingCandidates();
    }
  }

  private stopObservingCandidates(): void {
    this.intersectionObserver?.disconnect();
    this.mutationObserver?.disconnect();
    for (const timer of this.visibilityTimers.values()) {
      clearTimeout(timer);
    }
    this.visibilityTimers.clear();
    for (const [image, handler] of this.loadHandlers) {
      image.removeEventListener("load", handler);
    }
    this.loadHandlers.clear();
    this.observedImages.clear();
  }
}
