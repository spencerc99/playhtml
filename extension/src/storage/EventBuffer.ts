// ABOUTME: Collects browser events, buffers them in memory, and delegates storage and
// ABOUTME: upload to the background service worker via browser.runtime.sendMessage
import type { CollectionEvent, CollectionEventType } from '../collectors/types';
import { getParticipantId, getSessionId, getTimezone } from './participant';
import { VERBOSE } from '../config';
import browser from 'webextension-polyfill';

const BATCH_INTERVAL_MS = 3000; // 3 seconds

/**
 * EventBuffer manages event creation and batching
 *
 * - Creates events with full metadata (url, pid, sid, etc.) in content-script context
 * - Sends events to the background service worker for storage in extension-origin IndexedDB
 * - Batches flush triggers for upload efficiency
 */
export class EventBuffer {
  private batchTimer: number | null = null;

  /**
   * Add an event — stores it in the background service worker and schedules a flush
   */
  async addEvent(event: CollectionEvent): Promise<void> {
    const eventWithFlag = { ...event, uploaded: false };

    browser.runtime.sendMessage({
      type: 'STORE_EVENTS',
      events: [eventWithFlag],
    }).catch(console.error);

    this.scheduleBatch();
  }

  /**
   * Schedule a batch flush (debounced)
   */
  private scheduleBatch(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = window.setTimeout(() => {
      if (VERBOSE) {
        console.log(`[EventBuffer] Batch timer fired (${BATCH_INTERVAL_MS}ms)`);
      }
      this.flushBatch();
    }, BATCH_INTERVAL_MS);
  }

  /**
   * Trigger upload of pending events via background service worker
   */
  async flushBatch(): Promise<void> {
    browser.runtime.sendMessage({ type: 'FLUSH_PENDING_UPLOADS' }).catch(console.error);
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
   * Manually trigger a flush (for testing/debugging)
   */
  async manualFlush(): Promise<void> {
    if (VERBOSE) {
      console.log('[EventBuffer] Manual flush triggered');
    }
    await this.flushBatch();
  }
}
