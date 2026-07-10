// ABOUTME: Collects browser events, buffers them in memory, and delegates storage and
// ABOUTME: upload to the background service worker via browser.runtime.sendMessage
import type { CollectionEvent, CollectionEventType } from '../collectors/types';
import { toPublicPlayerIdentity } from '@playhtml/common';
import browser from 'webextension-polyfill';
import { createPrefixedId } from './ids';
import { requestSessionId, getTimezone } from './participant';
import { VERBOSE } from '../config';

const BATCH_INTERVAL_MS = 3000; // 3 seconds
const STORE_BATCH_INTERVAL_MS = 250;
const STORE_BATCH_MAX_EVENTS = 25;

interface EventMetadataBase {
  pid: string;
  sid: string;
  tz: string;
}

function shouldStoreWithoutDelay(event: CollectionEvent): boolean {
  return (
    event.type === 'cursor' &&
    typeof event.data === 'object' &&
    event.data !== null &&
    (event.data as { event?: unknown }).event === 'click'
  );
}

async function getEventParticipantPublicKey(): Promise<string> {
  try {
    const identity = toPublicPlayerIdentity(
      await browser.runtime.sendMessage({
        type: 'GET_PUBLIC_PLAYER_IDENTITY',
      }),
    );
    if (identity?.publicKey) return identity.publicKey;

    console.warn('[EventBuffer] playerIdentity not found, using temporary ID');
    return createPrefixedId('pk_temp_');
  } catch (error) {
    console.error('Failed to get public player identity:', error);
    return createPrefixedId('pk_temp_');
  }
}

/**
 * EventBuffer manages event creation and batching
 *
 * - Creates events with full metadata (url, pid, sid, etc.) in content-script context
 * - Sends events to the background service worker for storage in extension-origin IndexedDB
 * - Batches flush triggers for upload efficiency
 */
export class EventBuffer {
  private batchTimer: number | null = null;
  private storeTimer: number | null = null;
  private pendingEvents: CollectionEvent[] = [];
  private storeFlushPromise: Promise<boolean> | null = null;
  private metadataBasePromise: Promise<EventMetadataBase> | null = null;

  /**
   * Add an event — stores it in the background service worker and schedules a flush
   */
  async addEvent(event: CollectionEvent): Promise<void> {
    const eventWithFlag = { ...event, uploaded: false };

    this.pendingEvents.push(eventWithFlag);
    if (
      shouldStoreWithoutDelay(eventWithFlag) ||
      this.pendingEvents.length >= STORE_BATCH_MAX_EVENTS
    ) {
      void this.flushStoredEvents();
    } else {
      this.scheduleStoreFlush();
    }

    this.scheduleBatch();
  }

  private scheduleStoreFlush(): void {
    if (this.storeTimer !== null) return;

    this.storeTimer = window.setTimeout(() => {
      this.storeTimer = null;
      void this.flushStoredEvents();
    }, STORE_BATCH_INTERVAL_MS);
  }

  private async flushStoredEvents(): Promise<boolean> {
    if (this.storeTimer !== null) {
      clearTimeout(this.storeTimer);
      this.storeTimer = null;
    }

    if (this.storeFlushPromise) {
      const stored = await this.storeFlushPromise;
      if (!stored) return false;
    }

    if (this.pendingEvents.length === 0) return true;

    const events = this.pendingEvents.splice(0, this.pendingEvents.length);
    const flushPromise = browser.runtime
      .sendMessage({
        type: 'STORE_EVENTS',
        events,
      })
      .then(
        () => true,
        (error) => {
          this.pendingEvents.unshift(...events);
          console.error(error);
          return false;
        },
      );

    this.storeFlushPromise = flushPromise;
    try {
      return await flushPromise;
    } finally {
      if (this.storeFlushPromise === flushPromise) {
        this.storeFlushPromise = null;
      }
    }
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
    const stored = await this.flushStoredEvents();
    if (!stored) return;
    browser.runtime.sendMessage({ type: 'FLUSH_PENDING_UPLOADS' }).catch(console.error);
  }

  private async getMetadataBase(): Promise<EventMetadataBase> {
    if (!this.metadataBasePromise) {
      this.metadataBasePromise = Promise.all([
        getEventParticipantPublicKey(),
        requestSessionId(),
      ]).then(([pid, sid]) => ({
        pid,
        sid,
        tz: getTimezone(),
      }));
    }
    const metadata = await this.metadataBasePromise;
    if (metadata.pid.startsWith('pk_temp_')) {
      this.metadataBasePromise = null;
    }
    return metadata;
  }

  /**
   * Create a CollectionEvent with metadata
   */
  async createEvent(
    type: CollectionEventType,
    data: unknown
  ): Promise<CollectionEvent> {
    const { pid, sid, tz } = await this.getMetadataBase();

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
        tz,
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
