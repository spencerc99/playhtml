// ABOUTME: Abstract base class for all browsing behavior collectors.
// ABOUTME: Defines the lifecycle (start/stop), pausing, sample rate, and buffered event emission.

import type { CollectionEventType } from './types';

/**
 * Abstract base class for all collectors
 *
 * Collectors capture browsing behaviors and emit events, which are buffered
 * for local storage and archival upload (Supabase via Worker).
 */
export abstract class BaseCollector<T = unknown> {
  abstract readonly type: CollectionEventType;
  abstract readonly description: string;
  
  protected enabled: boolean = false;
  protected paused: boolean = false;
  protected sampleRate: number = 100; // ms between samples (default)

  
  // Callbacks for emitting events
  private onEmitCallback?: (event: T) => void | Promise<void>;
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
   * Milliseconds between archival samples. Installation machines lower this so
   * the screens read as live; ordinary browsing keeps the collector's default.
   */
  setSampleRate(rateMs: number): void {
    this.sampleRate = Math.max(16, rateMs);
  }

  /**
   * Emit an event to the buffer for local storage and archival upload
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
