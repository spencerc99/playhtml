import type { CollectionEventType } from './types';

/**
 * Abstract base class for all collectors
 * 
 * Collectors capture browsing behaviors and emit events.
 * They can stream to real-time systems (PartyKit) and/or
 * buffer for archival (Supabase via Worker).
 */
export abstract class BaseCollector<T = unknown> {
  abstract readonly type: CollectionEventType;
  abstract readonly description: string;
  
  protected enabled: boolean = false;
  protected sampleRate: number = 100; // ms between samples (default)
  
  // Callbacks for emitting events
  private onEmitCallback?: (event: T) => void;
  private onRealTimeCallback?: (data: T) => void;
  
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
   */
  protected abstract sample(): T | null;
  
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
   * Set the callback for buffered events (archival)
   */
  setEmitCallback(callback: (event: T) => void): void {
    this.onEmitCallback = callback;
  }
  
  /**
   * Set the callback for real-time events (live streaming)
   */
  setRealTimeCallback(callback: (data: T) => void): void {
    this.onRealTimeCallback = callback;
  }
  
  /**
   * Emit an event to both buffers (archival) and real-time streams
   */
  protected emit(data: T): void {
    // Emit to buffer for archival
    if (this.onEmitCallback) {
      this.onEmitCallback(data);
    }
    
    // Emit to real-time stream (if applicable)
    // Note: Real-time streaming is handled separately by collectors
    // that need it (like CursorCollector)
  }
  
  /**
   * Emit to real-time stream only (for high-frequency updates)
   */
  protected emitRealTime(data: T): void {
    if (this.onRealTimeCallback) {
      this.onRealTimeCallback(data);
    }
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
