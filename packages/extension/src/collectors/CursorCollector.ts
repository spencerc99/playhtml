import { BaseCollector } from './BaseCollector';
import type { CursorEventData } from './types';
import { normalizePosition } from './types';

/**
 * CursorCollector captures cursor movement with dual-layer approach:
 * 
 * 1. Real-time streaming (60fps) to PartyKit for live visualization
 * 2. Sparse sampling (100ms) to EventBuffer for archival
 */
export class CursorCollector extends BaseCollector<CursorEventData> {
  readonly type = 'cursor' as const;
  readonly description = 'Captures cursor movement, clicks, hovers, drags, and zoom';
  
  private mouseMoveHandler?: (e: MouseEvent) => void;
  private animationFrameId?: number;
  private lastSampleTime = 0;
  private sampleRate = 100; // ms between samples for archival
  private realTimeRate = 16; // ~60fps for real-time (16ms)
  private lastRealTimeTime = 0;
  
  // Rolling buffer for recent cursor positions (for archival)
  private recentPositions: Array<{ x: number; y: number; time: number }> = [];
  private maxBufferSize = 500;
  
  // Current cursor state
  private currentX = 0;
  private currentY = 0;
  private currentTarget: string | undefined;
  
  start(): void {
    if (this.enabled) return;
    
    this.enabled = true;
    this.lastSampleTime = Date.now();
    this.lastRealTimeTime = Date.now();
    
    // Set up mouse move handler
    this.mouseMoveHandler = (e: MouseEvent) => {
      this.currentX = e.clientX;
      this.currentY = e.clientY;
      
      // Try to capture target element
      const target = e.target as HTMLElement;
      if (target) {
        // Create a simple selector (tag + id/class if available)
        this.currentTarget = this.getElementSelector(target);
      }
      
      // Schedule real-time update
      this.scheduleRealTimeUpdate();
      
      // Check if we should sample for archival
      const now = Date.now();
      if (now - this.lastSampleTime >= this.sampleRate) {
        this.sample();
        this.lastSampleTime = now;
      }
    };
    
    document.addEventListener('mousemove', this.mouseMoveHandler, { passive: true });
    
    // Start animation frame loop for real-time updates
    this.startRealTimeLoop();
  }
  
  stop(): void {
    if (!this.enabled) return;
    
    this.enabled = false;
    
    if (this.mouseMoveHandler) {
      document.removeEventListener('mousemove', this.mouseMoveHandler);
      this.mouseMoveHandler = undefined;
    }
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = undefined;
    }
    
    // Clear buffers
    this.recentPositions = [];
  }
  
  /**
   * Schedule a real-time update (throttled to ~60fps)
   */
  private scheduleRealTimeUpdate(): void {
    const now = Date.now();
    if (now - this.lastRealTimeTime >= this.realTimeRate) {
      this.emitRealTimeData();
      this.lastRealTimeTime = now;
    }
  }
  
  /**
   * Start animation frame loop for real-time streaming
   */
  private startRealTimeLoop(): void {
    const loop = () => {
      if (!this.enabled) return;
      
      // Emit real-time data if enough time has passed
      const now = Date.now();
      if (now - this.lastRealTimeTime >= this.realTimeRate) {
        this.emitRealTimeData();
        this.lastRealTimeTime = now;
      }
      
      this.animationFrameId = requestAnimationFrame(loop);
    };
    
    this.animationFrameId = requestAnimationFrame(loop);
  }
  
  /**
   * Emit real-time cursor data (for PartyKit streaming)
   */
  private emitRealTimeData(): void {
    const normalized = normalizePosition(
      this.currentX,
      this.currentY,
      window.innerWidth,
      window.innerHeight
    );
    
    const data: CursorEventData = {
      x: normalized.x,
      y: normalized.y,
      t: this.currentTarget,
    };
    
    // Emit to real-time stream (PartyKit)
    this.emitRealTime(data);
  }
  
  /**
   * Sample current cursor state for archival
   */
  protected sample(): CursorEventData | null {
    if (!this.enabled) return null;
    
    const normalized = normalizePosition(
      this.currentX,
      this.currentY,
      window.innerWidth,
      window.innerHeight
    );
    
    // Add to rolling buffer
    this.recentPositions.push({
      x: normalized.x,
      y: normalized.y,
      time: Date.now(),
    });
    
    // Keep buffer size manageable
    if (this.recentPositions.length > this.maxBufferSize) {
      this.recentPositions.shift();
    }
    
    const data: CursorEventData = {
      x: normalized.x,
      y: normalized.y,
      t: this.currentTarget,
    };
    
    // Emit to buffer for archival
    this.emit(data);
    
    return data;
  }
  
  /**
   * Get a simple selector for an element
   */
  private getElementSelector(element: HTMLElement): string {
    // Prefer ID
    if (element.id) {
      return `#${element.id}`;
    }
    
    // Fall back to class
    if (element.className && typeof element.className === 'string') {
      const classes = element.className.split(' ').filter(Boolean);
      if (classes.length > 0) {
        return `.${classes[0]}`;
      }
    }
    
    // Fall back to tag name
    return element.tagName.toLowerCase();
  }
  
  /**
   * Get recent cursor positions (for debugging/stats)
   */
  getRecentPositions(): Array<{ x: number; y: number; time: number }> {
    return [...this.recentPositions];
  }
}
