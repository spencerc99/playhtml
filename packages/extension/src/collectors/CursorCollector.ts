import { BaseCollector } from './BaseCollector';
import type { CursorEventData } from './types';
import { normalizePosition } from './types';
import { VERBOSE } from '../config';

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
  protected sampleRate = 250; // ms between samples for archival
  private realTimeRate = 16; // ~60fps for real-time (16ms)
  private lastRealTimeTime = 0;
  private minMovementThreshold = 15; // pixels - minimum movement to trigger a sample
  
  // Rolling buffer for recent cursor positions (for archival)
  private recentPositions: Array<{ x: number; y: number; time: number }> = [];
  private maxBufferSize = 500;
  
  // Current cursor state
  private currentX = 0;
  private currentY = 0;
  private currentTarget: string | undefined;
  private currentCursorStyle: string | undefined;
  private lastCursorStyle: string | undefined;
  
  // Last sampled position (for movement threshold)
  private lastSampledX = 0;
  private lastSampledY = 0;
  
  // Mouse event handlers
  private mouseDownHandler?: (e: MouseEvent) => void;
  private mouseUpHandler?: (e: MouseEvent) => void;
  private dragStartHandler?: (e: DragEvent) => void;
  private dragEndHandler?: (e: DragEvent) => void;
  
  // Click vs hold tracking
  private mouseDownTime: number = 0;
  private mouseDownButton: number = -1;
  private mouseDownX: number = 0;
  private mouseDownY: number = 0;
  private holdThreshold = 250; // ms to distinguish click vs hold
  
  start(): void {
    // Note: enable() already checks if enabled, so we don't need to check here
    if (VERBOSE) {
      console.log('[CursorCollector] Starting cursor collection...');
    }
    this.lastSampleTime = Date.now();
    this.lastRealTimeTime = Date.now();
    
    // Initialize last sampled position to current position
    // This prevents the first sample from being triggered immediately
    if (this.currentX === 0 && this.currentY === 0) {
      // Wait for first mouse move to set initial position
      this.lastSampledX = -9999;
      this.lastSampledY = -9999;
    } else {
      this.lastSampledX = this.currentX;
      this.lastSampledY = this.currentY;
    }
    
    // Set up mouse move handler
    this.mouseMoveHandler = (e: MouseEvent) => {
      this.currentX = e.clientX;
      this.currentY = e.clientY;
      
      // Try to capture target element
      const target = e.target as HTMLElement;
      if (target) {
        // Create a simple selector (tag + id/class if available)
        this.currentTarget = this.getElementSelector(target);
        
        // Detect cursor style changes
        const computedStyle = window.getComputedStyle(target);
        const cursorStyle = computedStyle.cursor || 'auto';
        this.currentCursorStyle = cursorStyle;
        
        // Emit cursor change event if style changed
        if (this.lastCursorStyle !== undefined && this.lastCursorStyle !== cursorStyle) {
          this.emitCursorChangeEvent();
        }
        this.lastCursorStyle = cursorStyle;
      }
      
      // Schedule real-time update
      this.scheduleRealTimeUpdate();
      
      // Check if we should sample for archival
      const now = Date.now();
      if (now - this.lastSampleTime >= this.sampleRate) {
        // Check if movement is significant enough
        const dx = Math.abs(this.currentX - this.lastSampledX);
        const dy = Math.abs(this.currentY - this.lastSampledY);
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance >= this.minMovementThreshold) {
          const sampled = this.sample();
          if (sampled) {
            // Update last sampled position
            this.lastSampledX = this.currentX;
            this.lastSampledY = this.currentY;
          }
          this.lastSampleTime = now;
        } else {
          // Movement too small, just update the timer
          this.lastSampleTime = now;
        }
      }
    };
    
    document.addEventListener('mousemove', this.mouseMoveHandler, { passive: true });
    if (VERBOSE) {
      console.log('[CursorCollector] Mouse move listener attached');
    }
    
    // Set up mouse down handler (for click/hold detection)
    this.mouseDownHandler = (e: MouseEvent) => {
      this.mouseDownTime = Date.now();
      this.mouseDownButton = e.button;
      this.mouseDownX = e.clientX;
      this.mouseDownY = e.clientY;
    };
    
    // Set up mouse up handler (for click/hold detection)
    this.mouseUpHandler = (e: MouseEvent) => {
      const duration = Date.now() - this.mouseDownTime;
      const normalized = normalizePosition(
        this.mouseDownX,
        this.mouseDownY,
        window.innerWidth,
        window.innerHeight
      );
      
      const target = e.target as HTMLElement;
      const targetSelector = target ? this.getElementSelector(target) : undefined;
      
      if (duration >= this.holdThreshold) {
        // Emit hold event
        this.emitDiscreteEvent({
          ...normalized,
          t: targetSelector,
          event: 'hold',
          button: this.mouseDownButton,
          duration: duration,
        });
      } else {
        // Emit click event
        this.emitDiscreteEvent({
          ...normalized,
          t: targetSelector,
          event: 'click',
          button: this.mouseDownButton,
        });
      }
      
      this.mouseDownTime = 0;
      this.mouseDownButton = -1;
    };
    
    // Set up drag handlers
    this.dragStartHandler = (e: DragEvent) => {
      const normalized = normalizePosition(
        e.clientX,
        e.clientY,
        window.innerWidth,
        window.innerHeight
      );
      
      const target = e.target as HTMLElement;
      const targetSelector = target ? this.getElementSelector(target) : undefined;
      
      this.emitDiscreteEvent({
        ...normalized,
        t: targetSelector,
        event: 'drag_start',
      });
    };
    
    this.dragEndHandler = (e: DragEvent) => {
      const normalized = normalizePosition(
        e.clientX,
        e.clientY,
        window.innerWidth,
        window.innerHeight
      );
      
      const target = e.target as HTMLElement;
      const targetSelector = target ? this.getElementSelector(target) : undefined;
      
      this.emitDiscreteEvent({
        ...normalized,
        t: targetSelector,
        event: 'drag_end',
      });
    };
    
    // Attach event listeners
    document.addEventListener('mousedown', this.mouseDownHandler, { passive: true });
    document.addEventListener('mouseup', this.mouseUpHandler, { passive: true });
    document.addEventListener('dragstart', this.dragStartHandler, { passive: true });
    document.addEventListener('dragend', this.dragEndHandler, { passive: true });
    
    // Start animation frame loop for real-time updates
    this.startRealTimeLoop();
    if (VERBOSE) {
      console.log('[CursorCollector] Started successfully');
    }
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
    if (!this.enabled) {
      console.warn('[CursorCollector] Sample called but collector is not enabled');
      return null;
    }
    
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
    if (VERBOSE) {
      console.log('[CursorCollector] Sampling cursor position:', data);
    }
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
