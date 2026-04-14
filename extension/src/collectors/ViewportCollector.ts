// ABOUTME: Captures viewport changes including scroll, resize, and zoom events.
// ABOUTME: Throttles and debounces events to avoid excessive data while preserving browsing patterns.

import { BaseCollector } from "./BaseCollector";
import type { ViewportEventData } from "./types";
import { normalizeScroll } from "./types";
import { VERBOSE } from "../config";

/**
 * ViewportCollector captures viewport changes:
 *
 * - Scroll position (throttled to ~100ms)
 * - Window resize (debounced to ~2s, quantity tracks number of resizes)
 * - Browser zoom level changes (debounced to ~2s, quantity tracks number of zooms)
 */
export class ViewportCollector extends BaseCollector<ViewportEventData> {
  readonly type = "viewport" as const;
  readonly description = "Captures viewport events: scroll, resize, zoom";

  private scrollHandler?: () => void;
  private resizeHandler?: () => void;
  private lastResizeTime = 0;
  private scrollThrottle = 100; // ms
  private scrollTimer: number | null = null;
  private resizeDebounce = 200; // ms - wait for resize to settle
  private resizeTimer: number | null = null;
  private resizeQuantity = 0; // Count resize events during debounce window

  // Track last scroll position in pixels to detect actual movement
  private lastScrollX = 0;
  private lastScrollY = 0;

  // Track last resize dimensions to detect actual size changes
  private lastResizeWidth = 0;
  private lastResizeHeight = 0;

  // Zoom tracking
  private lastZoomLevel: number | null = null;
  private lastZoomEmitTime = -Infinity;
  private zoomDebounce = 2000; // ms - wait for zoom to settle before emitting
  private zoomQuantity = 0; // Count zoom changes during debounce window
  private visualViewport: VisualViewport | null = null;

  start(): void {
    if (VERBOSE) {
      console.log("[ViewportCollector] Starting viewport collection...");
    }

    // Initialize zoom level
    this.visualViewport = window.visualViewport || null;
    this.lastZoomLevel = this.getZoomLevel();

    // Initialize to -1 so the first scroll event always registers as movement,
    // including scrolls to position (0, 0).
    this.lastScrollX = -1;
    this.lastScrollY = -1;

    // Initialize resize dimensions tracking
    this.lastResizeWidth = window.innerWidth;
    this.lastResizeHeight = window.innerHeight;

    // Scroll handler (timer-based throttle: fires once per scrollThrottle window)
    this.scrollHandler = () => {
      if (this.scrollTimer !== null) return;
      this.scrollTimer = window.setTimeout(() => {
        this.scrollTimer = null;
        this.emitScrollEvent();
      }, this.scrollThrottle);
    };

    // Resize handler (debounced)
    this.resizeHandler = () => {
      // Increment quantity counter for this debounce window
      this.resizeQuantity++;

      // Clear existing timer
      if (this.resizeTimer) {
        clearTimeout(this.resizeTimer);
      }

      // Set new timer
      this.resizeTimer = window.setTimeout(() => {
        this.emitResizeEvent();
        this.checkZoomChange();
        this.resizeTimer = null;
        this.resizeQuantity = 0; // Reset counter after emit
      }, this.resizeDebounce);
    };

    // Attach event listeners
    window.addEventListener("scroll", this.scrollHandler, { passive: true });
    window.addEventListener("resize", this.resizeHandler, { passive: true });

    // Also listen to visualViewport resize for zoom detection (mobile/tablet)
    if (this.visualViewport) {
      this.visualViewport.addEventListener("resize", this.resizeHandler);
    }

    if (VERBOSE) {
      console.log("[ViewportCollector] Started successfully");
    }
  }

  stop(): void {
    if (this.scrollHandler) {
      window.removeEventListener("scroll", this.scrollHandler);
      this.scrollHandler = undefined;
    }

    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      if (this.visualViewport) {
        this.visualViewport.removeEventListener("resize", this.resizeHandler);
      }
      this.resizeHandler = undefined;
    }

    // Flush any pending scroll event that was waiting in the throttle timer
    if (this.scrollTimer !== null) {
      clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
      this.emitScrollEvent();
    }

    // Flush any pending resize event that was waiting in the debounce timer
    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
      this.emitResizeEvent();
    }
  }

  /**
   * Emit scroll event
   * Only emits if there's actual pixel movement (delta > 0)
   */
  private emitScrollEvent(): void {
    if (!this.enabled) return;

    // Get current scroll position in pixels
    const currentScrollX =
      window.scrollX || document.documentElement.scrollLeft;
    const currentScrollY = window.scrollY || document.documentElement.scrollTop;

    // Calculate pixel deltas
    const deltaX = Math.abs(currentScrollX - this.lastScrollX);
    const deltaY = Math.abs(currentScrollY - this.lastScrollY);

    // Only emit if there's actual movement (at least 1 pixel)
    // This filters out scroll events that fire but don't actually move
    if (deltaX === 0 && deltaY === 0) {
      if (VERBOSE) {
        console.log(
          "[ViewportCollector] Scroll event fired but no movement detected, skipping",
        );
      }
      return;
    }

    // Update last position
    this.lastScrollX = currentScrollX;
    this.lastScrollY = currentScrollY;

    const normalized = normalizeScroll(
      currentScrollX,
      currentScrollY,
      document.documentElement.scrollWidth,
      document.documentElement.scrollHeight,
      window.innerWidth,
      window.innerHeight,
    );

    const data: ViewportEventData = {
      event: "scroll",
      scrollX: normalized.scrollX,
      scrollY: normalized.scrollY,
      scrollDistancePx: deltaX + deltaY,
    };

    if (VERBOSE) {
      console.log(`[ViewportCollector] Emitting scroll event:`, {
        ...data,
        pixelDeltaX: deltaX,
        pixelDeltaY: deltaY,
        pixelX: currentScrollX,
        pixelY: currentScrollY,
      });
    }

    this.emit(data);
  }

  /**
   * Emit resize event
   * Only emits if there's actual size change (delta > 0)
   */
  private emitResizeEvent(): void {
    if (!this.enabled) return;

    const currentWidth = window.innerWidth;
    const currentHeight = window.innerHeight;

    // Calculate size deltas
    const deltaWidth = Math.abs(currentWidth - this.lastResizeWidth);
    const deltaHeight = Math.abs(currentHeight - this.lastResizeHeight);

    // Only emit if there's actual size change (at least 1 pixel)
    // This filters out resize events that fire but don't actually change size
    if (deltaWidth === 0 && deltaHeight === 0) {
      if (VERBOSE) {
        console.log(
          "[ViewportCollector] Resize event fired but no size change detected, skipping",
        );
      }
      // Reset quantity counter since no actual resize occurred
      this.resizeQuantity = 0;
      return;
    }

    // Update last dimensions
    this.lastResizeWidth = currentWidth;
    this.lastResizeHeight = currentHeight;

    const data: ViewportEventData = {
      event: "resize",
      width: currentWidth,
      height: currentHeight,
      quantity: this.resizeQuantity,
    };

    if (VERBOSE) {
      console.log(
        `[ViewportCollector] Emitting resize event (${this.resizeQuantity} resizes):`,
        {
          ...data,
          deltaWidth,
          deltaHeight,
        },
      );
    }

    this.emit(data);
  }

  /**
   * Check for zoom level changes and emit if changed
   * Debounced to prevent spam during continuous zooming
   * Only emits if there's actual zoom change (delta > 0)
   */
  private checkZoomChange(): void {
    const currentZoom = this.getZoomLevel();
    const now = Date.now();

    // Check if zoom actually changed (with small threshold to avoid floating point issues)
    const zoomDelta =
      this.lastZoomLevel !== null
        ? Math.abs(currentZoom - this.lastZoomLevel)
        : 0;
    const hasZoomChange = zoomDelta > 0.001; // 0.1% threshold for zoom changes

    if (hasZoomChange) {
      // Debounce: only emit if enough time has passed since last zoom event
      const timeSinceLastEmit = now - this.lastZoomEmitTime;

      if (timeSinceLastEmit >= this.zoomDebounce) {
        // New debounce window — reset counter and count just this zoom
        this.zoomQuantity = 1;

        const data: ViewportEventData = {
          event: "zoom",
          zoom: currentZoom,
          previous_zoom: this.lastZoomLevel ?? undefined,
          quantity: this.zoomQuantity,
        };

        if (VERBOSE) {
          console.log(
            `[ViewportCollector] Emitting zoom event (${this.zoomQuantity} zooms):`,
            {
              ...data,
              zoomDelta,
            },
          );
        }

        this.emit(data);
        this.lastZoomEmitTime = now;
        this.zoomQuantity = 0; // Reset counter
      } else {
        if (VERBOSE) {
          console.log(
            `[ViewportCollector] Zoom change detected but debounced (${timeSinceLastEmit}ms < ${this.zoomDebounce}ms, total: ${this.zoomQuantity})`,
          );
        }
      }
    } else {
      // No zoom change detected, reset quantity counter
      if (this.zoomQuantity > 0 && VERBOSE) {
        console.log(
          `[ViewportCollector] Zoom check fired but no change detected (delta: ${zoomDelta.toFixed(
            6,
          )}), resetting quantity counter`,
        );
      }
      this.zoomQuantity = 0;
    }

    // Always update last zoom level to track changes
    this.lastZoomLevel = currentZoom;
  }

  /**
   * Get current zoom level
   * Uses visualViewport.scale if available, otherwise returns 1.0
   * Note: Zoom detection only works on browsers with visualViewport API
   */
  private getZoomLevel(): number {
    const vv = window.visualViewport;
    if (vv?.scale) {
      return vv.scale;
    }

    // No reliable way to detect zoom without visualViewport
    // Don't use devicePixelRatio as it reflects physical screen DPI, not browser zoom
    return 1.0;
  }
}
