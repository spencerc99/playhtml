import browser from 'webextension-polyfill';
import { BaseCollector } from './BaseCollector';
import type { CollectionEventType, CollectorStatus } from './types';
import { EventBuffer } from '../storage/EventBuffer';
import { uploadEvents } from '../storage/sync';
import { VERBOSE } from '../config';
import { getValidEventTypes } from '../shared/types';

const STORAGE_KEY = 'collection_enabled_collectors';

/**
 * CollectorManager orchestrates all collectors
 * 
 * - Manages collector lifecycle (start/stop)
 * - Handles enabled/disabled state persistence
 * - Routes events to EventBuffer
 * - Coordinates with sync service
 */
export class CollectorManager {
  private collectors: Map<CollectionEventType, BaseCollector> = new Map();
  private eventBuffer: EventBuffer;
  private initialized = false;
  
  constructor() {
    this.eventBuffer = new EventBuffer();
    this.eventBuffer.setUploadCallback(uploadEvents);
  }
  
  /**
   * Initialize the manager
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    
    // First, apply 3-way modes (off/local/shared) if present
    await this.applyModesFromStorage();
    // Then, load legacy enabled flags for backward compatibility
    await this.loadEnabledCollectors();
    
    this.initialized = true;
  }

  /**
   * Enable/disable collectors based on per-collector mode in storage.
   * - 'off' => disable
   * - 'local' or 'shared' => enable
   */
  private async applyModesFromStorage(): Promise<void> {
    try {
      const types = getValidEventTypes();
      const keys = types.map((t) => `collection_mode_${t}`);
      const result = await browser.storage.local.get(keys);
      for (const type of types) {
        const mode = result[`collection_mode_${type}`];
        const normalized: 'off' | 'local' | 'shared' =
          mode === 'off' || mode === 'local' || mode === 'shared' ? mode : 'local';
        if (normalized === 'off') {
          await this.disableCollector(type as CollectionEventType);
        } else {
          await this.enableCollector(type as CollectionEventType);
        }
      }
    } catch (e) {
      if (VERBOSE) {
        console.warn('[CollectorManager] Failed to apply modes from storage:', e);
      }
    }
  }
  
  /**
   * Register a collector
   */
  registerCollector(collector: BaseCollector): void {
    if (VERBOSE) {
      console.log(`[CollectorManager] Registering collector: ${collector.type}`);
    }
    this.collectors.set(collector.type, collector);
    
    // Set up event emission callback
    collector.setEmitCallback(async (data) => {
      try {
        const event = await this.eventBuffer.createEvent(collector.type, data);
        await this.eventBuffer.addEvent(event);
        if (VERBOSE) {
          console.log(`[CollectorManager] Event collected: ${collector.type}`, event.id);
        }
      } catch (error) {
        console.error(`[CollectorManager] Failed to add event:`, error);
      }
    });
    
    if (VERBOSE) {
      console.log(`[CollectorManager] Emit callback set for ${collector.type}`);
    }
    
    // Check if this collector should be enabled
    this.checkCollectorState(collector);
  }
  
  /**
   * Check and apply saved state for a collector
   */
  private async checkCollectorState(collector: BaseCollector): Promise<void> {
    const enabled = await this.isCollectorEnabled(collector.type);
    
    if (enabled) {
      collector.enable();
    } else {
      collector.disable();
    }
  }
  
  /**
   * Enable a collector
   */
  async enableCollector(type: CollectionEventType): Promise<void> {
    if (VERBOSE) {
      console.log(`[CollectorManager] Enabling collector: ${type}`);
    }
    const collector = this.collectors.get(type);
    if (collector) {
      collector.enable();
      await this.saveCollectorState(type, true);
      if (VERBOSE) {
        console.log(`[CollectorManager] Collector ${type} enabled successfully`);
      }
    } else {
      console.error(`[CollectorManager] Collector ${type} not found`);
    }
  }
  
  /**
   * Disable a collector
   */
  async disableCollector(type: CollectionEventType): Promise<void> {
    const collector = this.collectors.get(type);
    if (collector) {
      collector.disable();
      await this.saveCollectorState(type, false);
    }
  }
  
  /**
   * Check if a collector is enabled
   */
  async isCollectorEnabled(type: CollectionEventType): Promise<boolean> {
    try {
      const result = await browser.storage.local.get([STORAGE_KEY]);
      const enabled = result[STORAGE_KEY] || {};
      return enabled[type] === true;
    } catch {
      return false;
    }
  }
  
  /**
   * Save collector enabled state
   */
  private async saveCollectorState(
    type: CollectionEventType,
    enabled: boolean
  ): Promise<void> {
    try {
      const result = await browser.storage.local.get([STORAGE_KEY]);
      const enabledCollectors = result[STORAGE_KEY] || {};
      enabledCollectors[type] = enabled;
      await browser.storage.local.set({ [STORAGE_KEY]: enabledCollectors });
    } catch (error) {
      console.error('Failed to save collector state:', error);
    }
  }
  
  /**
   * Load enabled collectors from storage
   */
  private async loadEnabledCollectors(): Promise<void> {
    try {
      const result = await browser.storage.local.get([STORAGE_KEY]);
      const enabledCollectors = result[STORAGE_KEY] || {};
      
      // Apply saved state to all registered collectors
      for (const [type, collector] of this.collectors.entries()) {
        if (enabledCollectors[type]) {
          collector.enable();
        } else {
          collector.disable();
        }
      }
    } catch (error) {
      console.error('Failed to load enabled collectors:', error);
    }
  }
  
  /**
   * Get status of all collectors
   */
  getCollectorStatuses(): CollectorStatus[] {
    return Array.from(this.collectors.values()).map((collector) => ({
      type: collector.type,
      enabled: collector.isEnabled(),
      description: collector.description,
    }));
  }
  
  /**
   * Get a specific collector
   */
  getCollector(type: CollectionEventType): BaseCollector | undefined {
    return this.collectors.get(type);
  }
  
  /**
   * Get event buffer (for stats)
   */
  getEventBuffer(): EventBuffer {
    return this.eventBuffer;
  }
  
  /**
   * Manually trigger a batch flush
   */
  async flushEvents(): Promise<void> {
    await this.eventBuffer.flushBatch();
  }
}
