import type { CollectionEvent, CollectionEventType } from '../collectors/types';
import { getParticipantId, getSessionId, getTimezone } from './participant';

const DB_NAME = 'collection_events_db';
const DB_VERSION = 1;
const STORE_NAME = 'events';
const BATCH_SIZE = 100;
const BATCH_INTERVAL_MS = 5000; // 5 seconds

/**
 * EventBuffer manages event storage and batching
 * 
 * - Stores events in IndexedDB (survives crashes)
 * - Batches events for upload (every 5s or 100 events)
 * - Handles offline gracefully
 */
export class EventBuffer {
  private db: IDBDatabase | null = null;
  private batchTimer: number | null = null;
  private uploadCallback?: (events: CollectionEvent[]) => Promise<void>;
  private isInitialized = false;
  
  constructor() {
    // Initialize on construction
    this.init().catch(console.error);
  }
  
  /**
   * Initialize IndexedDB
   */
  private async init(): Promise<void> {
    if (this.isInitialized) return;
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        this.isInitialized = true;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        // Create object store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('ts', 'ts', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        }
      };
    });
  }
  
  /**
   * Set callback for uploading batched events
   */
  setUploadCallback(callback: (events: CollectionEvent[]) => Promise<void>): void {
    this.uploadCallback = callback;
  }
  
  /**
   * Add an event to the buffer
   */
  async addEvent(event: CollectionEvent): Promise<void> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.add(event);
      
      request.onsuccess = () => {
        resolve();
        this.scheduleBatch();
      };
      
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Ensure database is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.init();
    }
  }
  
  /**
   * Schedule a batch upload (debounced)
   */
  private scheduleBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    
    this.batchTimer = window.setTimeout(() => {
      this.flushBatch().catch(console.error);
    }, BATCH_INTERVAL_MS);
  }
  
  /**
   * Flush pending events to upload callback
   */
  async flushBatch(): Promise<void> {
    if (!this.uploadCallback) {
      console.warn('No upload callback set for EventBuffer');
      return;
    }
    
    await this.ensureInitialized();
    
    const events = await this.getPendingEvents(BATCH_SIZE);
    
    if (events.length === 0) {
      return;
    }
    
    try {
      await this.uploadCallback(events);
      
      // Remove uploaded events from IndexedDB
      await this.removeEvents(events.map(e => e.id));
    } catch (error) {
      console.error('Failed to upload events:', error);
      // Events remain in IndexedDB for retry later
    }
  }
  
  /**
   * Get pending events from IndexedDB
   */
  private async getPendingEvents(limit: number): Promise<CollectionEvent[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('ts');
      const request = index.openCursor(null, 'next');
      
      const events: CollectionEvent[] = [];
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        
        if (cursor && events.length < limit) {
          events.push(cursor.value as CollectionEvent);
          cursor.continue();
        } else {
          resolve(events);
        }
      };
      
      request.onerror = () => reject(request.error);
    });
  }
  
  /**
   * Remove events from IndexedDB
   */
  private async removeEvents(ids: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = this.db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      let completed = 0;
      const total = ids.length;
      
      if (total === 0) {
        resolve();
        return;
      }
      
      ids.forEach((id) => {
        const request = store.delete(id);
        request.onsuccess = () => {
          completed++;
          if (completed === total) {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
    });
  }
  
  /**
   * Create a CollectionEvent with metadata
   */
  async createEvent(
    type: CollectionEventType,
    data: unknown
  ): Promise<CollectionEvent> {
    const [pid, sid] = await Promise.all([
      getParticipantId(),
      getSessionId(),
    ]);
    
    const { generateULID } = await import('../collectors/types');
    
    return {
      id: generateULID(),
      type,
      ts: Date.now(),
      data,
      meta: {
        pid,
        sid,
        url: window.location.href,
        vw: window.innerWidth,
        vh: window.innerHeight,
        tz: getTimezone(),
      },
    };
  }
  
  /**
   * Get count of pending events
   */
  async getPendingCount(): Promise<number> {
    await this.ensureInitialized();
    
    return new Promise((resolve, reject) => {
      if (!this.db) {
        reject(new Error('Database not initialized'));
        return;
      }
      
      const transaction = this.db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count();
      
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
}
