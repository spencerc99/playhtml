import { BaseCollector } from './BaseCollector';
import type { ViewportEventData } from './types';
import { normalizeScroll } from './types';
import { VERBOSE } from '../config';

/**
 * ViewportCollector captures viewport changes:
 * 
 * - Scroll position (throttled to ~100ms)
 * - Window resize (debounced to ~2s, quantity tracks number of resizes)
 * - Browser zoom level changes (debounced to ~2s, quantity tracks number of zooms)
 */
export class ViewportCollector extends BaseCollector<ViewportEventData> {
  readonly type = 'viewport' as const;
  readonly description = 'Captures viewport events: scroll, resize, zoom';
  
  private scrollHandler?: () => void;
  private resizeHandler?: () => void;
  private lastScrollTime = 0;
  private lastResizeTime = 0;
  private scrollThrottle = 100; // ms
  private resizeDebounce = 2000; // ms - wait for resize to settle (e.g., dragging window edge)
  private resizeTimer: number | null = null;
  private resizeQuantity = 0; // Count resize events during debounce window
  
  // Zoom tracking
  private lastZoomLevel: number | null = null;
  private lastZoomEmitTime = 0;
  private zoomDebounce = 2000; // ms - wait for zoom to settle before emitting
  private zoomQuantity = 0; // Count zoom changes during debounce window
  private visualViewport: VisualViewport | null = null;
  
  start(): void {
    if (VERBOSE) {
      console.log('[ViewportCollector] Starting viewport collection...');
    }
    
    // Initialize zoom level
    this.visualViewport = window.visualViewport || null;
    this.lastZoomLevel = this.getZoomLevel();
    
    // Scroll handler (throttled)
    this.scrollHandler = () => {
      const now = Date.now();
      if (now - this.lastScrollTime >= this.scrollThrottle) {
        this.emitScrollEvent();
        this.lastScrollTime = now;
      }
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
    // Use visualViewport if available (mobile/tablet), otherwise use window
    if (this.visualViewport) {
      this.visualViewport.addEventListener('resize', this.resizeHandler);
      this.visualViewport.addEventListener('scroll', this.scrollHandler);
    } else {
      window.addEventListener('scroll', this.scrollHandler, { passive: true });
    }

    // Always listen to window resize (for desktop browser resize)
    window.addEventListener('resize', this.resizeHandler, { passive: true });
    
    if (VERBOSE) {
      console.log('[ViewportCollector] Started successfully');
    }
  }
  
  stop(): void {
    if (this.scrollHandler) {
      if (this.visualViewport) {
        this.visualViewport.removeEventListener('scroll', this.scrollHandler);
      } else {
        window.removeEventListener('scroll', this.scrollHandler);
      }
      this.scrollHandler = undefined;
    }

    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      if (this.visualViewport) {
        this.visualViewport.removeEventListener('resize', this.resizeHandler);
      }
      this.resizeHandler = undefined;
    }

    if (this.resizeTimer) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
  }

  /**
   * Emit scroll event
   */
  private emitScrollEvent(): void {
    if (!this.enabled) return;
    
    const normalized = normalizeScroll(
      window.scrollX || document.documentElement.scrollLeft,
      window.scrollY || document.documentElement.scrollTop,
      document.documentElement.scrollWidth,
      document.documentElement.scrollHeight,
      window.innerWidth,
      window.innerHeight
    );
    
    const data: ViewportEventData = {
      event: 'scroll',
      scrollX: normalized.scrollX,
      scrollY: normalized.scrollY,
    };
    
    if (VERBOSE) {
      console.log('[ViewportCollector] Emitting scroll event:', data);
    }
    
    this.emit(data);
  }
  
  /**
   * Emit resize event
   */
  private emitResizeEvent(): void {
    if (!this.enabled) return;
    
    const data: ViewportEventData = {
      event: 'resize',
      width: window.innerWidth,
      height: window.innerHeight,
      quantity: this.resizeQuantity,
    };
    
    if (VERBOSE) {
      console.log(`[ViewportCollector] Emitting resize event (${this.resizeQuantity} resizes):`, data);
    }
    
    this.emit(data);
  }
  
  /**
   * Check for zoom level changes and emit if changed
   * Debounced to prevent spam during continuous zooming
   */
  private checkZoomChange(): void {
    const currentZoom = this.getZoomLevel();
    const now = Date.now();
    
    // Check if zoom actually changed
    if (this.lastZoomLevel !== null && currentZoom !== this.lastZoomLevel) {
      // Increment quantity counter
      this.zoomQuantity++;
      
      // Debounce: only emit if enough time has passed since last zoom event
      const timeSinceLastEmit = now - this.lastZoomEmitTime;
      
      if (timeSinceLastEmit >= this.zoomDebounce) {
        const data: ViewportEventData = {
          event: 'zoom',
          zoom: currentZoom,
          previous_zoom: this.lastZoomLevel,
          quantity: this.zoomQuantity,
        };
        
        if (VERBOSE) {
          console.log(`[ViewportCollector] Emitting zoom event (${this.zoomQuantity} zooms):`, data);
        }
        
        this.emit(data);
        this.lastZoomEmitTime = now;
        this.zoomQuantity = 0; // Reset counter
      } else {
        if (VERBOSE) {
          console.log(`[ViewportCollector] Zoom change detected but debounced (${timeSinceLastEmit}ms < ${this.zoomDebounce}ms, total: ${this.zoomQuantity})`);
        }
      }
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
    if (this.visualViewport?.scale) {
      return this.visualViewport.scale;
    }

    // No reliable way to detect zoom without visualViewport
    // Don't use devicePixelRatio as it reflects physical screen DPI, not browser zoom
    return 1.0;
  }
}
