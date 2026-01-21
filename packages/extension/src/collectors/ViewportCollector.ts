import { BaseCollector } from './BaseCollector';
import type { ViewportEventData } from './types';
import { normalizeScroll } from './types';
import { VERBOSE } from '../config';

/**
 * ViewportCollector captures viewport changes:
 * 
 * - Scroll position (throttled to ~100ms)
 * - Window resize (debounced to ~200ms)
 * - Browser zoom level changes
 */
export class ViewportCollector extends BaseCollector<ViewportEventData> {
  readonly type = 'viewport' as const;
  readonly description = 'Captures viewport events: scroll, resize, zoom';
  
  private scrollHandler?: () => void;
  private resizeHandler?: () => void;
  private lastScrollTime = 0;
  private lastResizeTime = 0;
  private scrollThrottle = 100; // ms
  private resizeDebounce = 200; // ms
  private resizeTimer: number | null = null;
  
  // Zoom tracking
  private lastZoomLevel: number | null = null;
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
      // Clear existing timer
      if (this.resizeTimer) {
        clearTimeout(this.resizeTimer);
      }
      
      // Set new timer
      this.resizeTimer = window.setTimeout(() => {
        this.emitResizeEvent();
        this.checkZoomChange();
        this.resizeTimer = null;
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
    };
    
    if (VERBOSE) {
      console.log('[ViewportCollector] Emitting resize event:', data);
    }
    
    this.emit(data);
  }
  
  /**
   * Check for zoom level changes and emit if changed
   */
  private checkZoomChange(): void {
    const currentZoom = this.getZoomLevel();
    
    if (this.lastZoomLevel !== null && currentZoom !== this.lastZoomLevel) {
      const data: ViewportEventData = {
        event: 'zoom',
        zoom: currentZoom,
      };
      
      if (VERBOSE) {
        console.log('[ViewportCollector] Emitting zoom event:', data);
      }
      
      this.emit(data);
    }
    
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
