// ABOUTME: Abstract base class for all browsing behavior collectors.
// ABOUTME: Defines the lifecycle (start/stop), event emission, and real-time streaming interface.

import type { CollectionEventType } from './types';

/**
 * Abstract base class for all collectors
 *
 * Collectors capture browsing behaviors and emit events.
 * They can stream to real-time systems (PartyKit) and/or
 * buffer for archival (Supabase via Worker).
 *
 * Real-time streaming pattern:
 * - Currently only CursorCollector streams to PartyKit for live visualization
 * - To add real-time to other collectors, use emitRealTime() in addition to emit()
 * - Example: Navigation/viewport events could stream real-time for collaborative viewing
 */
export abstract class BaseCollector<T = unknown> {
  abstract readonly type: CollectionEventType;
  abstract readonly description: string;
  
  protected enabled: boolean = false;
  protected paused: boolean = false;
  protected sampleRate: number = 100; // ms between samples (default)
  
  // Callbacks for emitting events
  private onEmitCallback?: (event: T) => void | Promise<void>;
  private onRealTimeCallback?: (data: T) => void;
  private pendingEventEmits = new Set<Promise<void>>();
  
  /**
   * Start collecting data
   */
  abstract start(): void;
  
  /**
   * Stop collecting data
   */
  abstract stop(): void;

  /**
   * Sample current state (for periodic collectors)
   * Returns null if no sample should be taken
   * Override this in continuous collectors (cursor, scroll, etc.)
   * Discrete event collectors (navigation, clicks) can ignore this
   */
  protected sample(): T | null {
    return null;
  }

  /**
   * Emit any pending debounced data before this collector stops accepting emissions.
   */
  protected drainPendingEvents(): void {}
  
  /**
   * Enable this collector
   */
  enable(): void {
    if (!this.enabled) {
      this.enabled = true;
      this.start();
    }
  }
  
  /**
   * Disable this collector
   */
  disable(): void {
    if (this.enabled) {
      this.drainPendingEvents();
      this.enabled = false;
      this.stop();
    }
  }
  
  /**
   * Check if collector is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Pause emission without tearing down DOM listeners.
   * Use resume() to restore. Does not affect persisted enabled state.
   */
  pause(): void {
    this.paused = true;
  }

  /**
   * Resume emission after a pause(). Does not re-run start() or emit
   * any synthetic events.
   */
  resume(): void {
    this.paused = false;
  }
  
  /**
   * Set the callback for buffered events (archival)
   */
  setEmitCallback(callback: (event: T) => void | Promise<void>): void {
    this.onEmitCallback = callback;
  }
  
  /**
   * Set the callback for real-time events (live streaming)
   */
  setRealTimeCallback(callback: (data: T) => void): void {
    this.onRealTimeCallback = callback;
  }

  protected hasRealTimeCallback(): boolean {
    return this.onRealTimeCallback !== undefined;
  }
  
  /**
   * Emit an event to both buffers (archival) and real-time streams
   */
  protected emit(data: T): void {
    if (this.paused) return;

    // Emit to buffer for archival
    if (this.onEmitCallback) {
      const result = this.onEmitCallback(data);
      if (result) {
        const pending = Promise.resolve(result)
          .catch((error) => {
            console.error(`[BaseCollector] Emit callback failed for ${this.type}:`, error);
          })
          .finally(() => {
            this.pendingEventEmits.delete(pending);
          });
        this.pendingEventEmits.add(pending);
      }
    } else {
      console.warn(`[BaseCollector] No emit callback set for ${this.type}`);
    }
    
    // Emit to real-time stream (if applicable)
    // Note: Real-time streaming is handled separately by collectors
    // that need it (like CursorCollector)
  }
  
  /**
   * Emit to real-time stream only (for high-frequency updates)
   */
  protected emitRealTime(data: T): void {
    if (this.paused) return;
    if (this.onRealTimeCallback) {
      this.onRealTimeCallback(data);
    }
  }

  async waitForPendingEvents(): Promise<void> {
    await Promise.all(Array.from(this.pendingEventEmits));
  }
  
  /**
   * Get collector status
   */
  getStatus() {
    return {
      type: this.type,
      enabled: this.enabled,
      description: this.description,
    };
  }
}
