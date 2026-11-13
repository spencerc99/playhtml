// ABOUTME: Collects browser events, buffers them in memory, and delegates storage and
// ABOUTME: upload to the background service worker via browser.runtime.sendMessage
import { generateULID } from '../collectors/types';
import type { CollectionEvent, CollectionEventType } from '../collectors/types';
import { toPublicPlayerIdentity } from '@playhtml/common';
import browser from 'webextension-polyfill';
import { requestSessionId, getTimezone } from './participant';
import { VERBOSE } from '../config';

const BATCH_INTERVAL_MS = 3000; // 3 seconds
const STORE_BATCH_INTERVAL_MS = 1000;
const STORE_BATCH_MAX_EVENTS = 25;
const STORE_RETRY_INITIAL_MS = 1000;
const STORE_RETRY_MAX_MS = 30_000;
/**
 * Most events held in the page while the background cannot take them (no
 * identity yet, or storage failing). Past this the oldest are dropped.
 */
export const MAX_HELD_EVENTS = 5000;

interface EventMetadataBase {
  sid: string;
  tz: string;
}

/**
 * An event before it is attributed to a participant. The participant ID is
 * stamped on when the event is stored, so no event is stored under anything
 * but the participant's real identity.
 */
export type UnattributedEvent = Omit<CollectionEvent, 'meta'> & {
  meta: Omit<CollectionEvent['meta'], 'pid'> & { pid?: string };
};

type HeldEvent = UnattributedEvent & { uploaded: false };

function shouldStoreWithoutDelay(event: UnattributedEvent): boolean {
  return (
    event.type === 'cursor' &&
    typeof event.data === 'object' &&
    event.data !== null &&
    (event.data as { event?: unknown }).event === 'click'
  );
}

/** The participant's public key, or null when the background has none yet. */
async function requestParticipantPublicKey(): Promise<string | null> {
  try {
    const identity = toPublicPlayerIdentity(
      await browser.runtime.sendMessage({
        type: 'GET_PUBLIC_PLAYER_IDENTITY',
      }),
    );
    return identity?.publicKey ?? null;
  } catch (error) {
    console.error('[EventBuffer] Failed to get public player identity:', error);
    return null;
  }
}

/**
 * EventBuffer manages event creation and batching
 *
 * - Creates events with metadata (url, sid, etc.) in content-script context
 * - Holds events until the participant's identity is known, then stamps it on
 * - Sends events to the background service worker for storage in extension-origin IndexedDB
 * - Batches flush triggers for upload efficiency
 */
export class EventBuffer {
  private storeIntervalMs = STORE_BATCH_INTERVAL_MS;
  private batchIntervalMs = BATCH_INTERVAL_MS;
  private batchTimer: number | null = null;
  private storeTimer: number | null = null;
  private storeRetryDelayMs = STORE_RETRY_INITIAL_MS;
  private pendingEvents: HeldEvent[] = [];
  private storeFlushPromise: Promise<boolean> | null = null;
  private metadataBasePromise: Promise<EventMetadataBase> | null = null;
  private participantId: string | null = null;
  private participantIdRequest: Promise<string | null> | null = null;
  private awaitingIdentity = false;
  private warnedMissingIdentity = false;
  private warnedHeldOverflow = false;
  private disposed = false;

  /**
   * Add an event — stores it in the background service worker and schedules a flush
   */
  async addEvent(event: UnattributedEvent): Promise<void> {
    if (this.disposed) return;
    const eventWithFlag: HeldEvent = { ...event, uploaded: false };

    this.pendingEvents.push(eventWithFlag);
    this.dropOverflow();
    // While identity is missing, the retry timer paces attempts; storing
    // early would only ask the background again for every event.
    if (
      !this.awaitingIdentity &&
      (shouldStoreWithoutDelay(eventWithFlag) ||
        this.pendingEvents.length >= STORE_BATCH_MAX_EVENTS)
    ) {
      void this.flushStoredEvents();
    } else {
      this.scheduleStoreFlush();
    }

    this.scheduleBatch();
  }

  /**
   * Sets how long events wait before each hop. Installation machines shorten
   * both so marks reach the screens close to live; `null` restores the
   * batching that keeps ordinary browsing cheap.
   */
  setPace(
    pace: { storeIntervalMs: number; batchIntervalMs: number } | null,
  ): void {
    this.storeIntervalMs = pace?.storeIntervalMs ?? STORE_BATCH_INTERVAL_MS;
    this.batchIntervalMs = pace?.batchIntervalMs ?? BATCH_INTERVAL_MS;
  }

  /**
   * Stops all timers and drops buffered events without sending them. Used when
   * the extension context is gone and the background can no longer be reached,
   * so retries would loop forever. Later events are ignored.
   */
  dispose(): void {
    this.disposed = true;
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    if (this.storeTimer !== null) {
      clearTimeout(this.storeTimer);
      this.storeTimer = null;
    }
    this.pendingEvents = [];
  }

  private scheduleStoreFlush(): void {
    if (this.disposed || this.storeTimer !== null) return;

    this.storeTimer = window.setTimeout(() => {
      this.storeTimer = null;
      void this.flushStoredEvents();
    }, this.storeIntervalMs);
  }

  private scheduleStoreRetry(): void {
    if (this.disposed || this.storeTimer !== null) return;

    const retryDelayMs = this.storeRetryDelayMs;
    this.storeRetryDelayMs = Math.min(retryDelayMs * 2, STORE_RETRY_MAX_MS);
    this.storeTimer = window.setTimeout(() => {
      this.storeTimer = null;
      void this.flushBatch();
    }, retryDelayMs);
  }

  private requeueEventsForStorageRetry(events: HeldEvent[]): void {
    if (this.disposed) return;
    this.pendingEvents.unshift(...events);
    this.dropOverflow();
    this.scheduleStoreRetry();
  }

  private dropOverflow(): void {
    const overflow = this.pendingEvents.length - MAX_HELD_EVENTS;
    if (overflow <= 0) return;
    this.pendingEvents.splice(0, overflow);
    if (!this.warnedHeldOverflow) {
      this.warnedHeldOverflow = true;
      console.warn(
        `[EventBuffer] Holding more than ${MAX_HELD_EVENTS} unsaved events; dropping the oldest`,
      );
    }
  }

  /**
   * The participant's public key, asked of the background until it has one.
   * Null means events must keep waiting.
   */
  private resolveParticipantId(): Promise<string | null> {
    if (this.participantId) return Promise.resolve(this.participantId);
    this.participantIdRequest ??= requestParticipantPublicKey()
      .then((publicKey) => {
        if (publicKey) {
          this.participantId = publicKey;
          this.awaitingIdentity = false;
        } else {
          this.awaitingIdentity = true;
          if (!this.warnedMissingIdentity) {
            this.warnedMissingIdentity = true;
            console.warn(
              '[EventBuffer] No player identity yet; holding events until there is one',
            );
          }
        }
        return this.participantId;
      })
      .finally(() => {
        this.participantIdRequest = null;
      });
    return this.participantIdRequest;
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

    const needsIdentity = this.pendingEvents.some((event) => !event.meta.pid);
    const participantId = needsIdentity
      ? await this.resolveParticipantId()
      : null;
    if (this.disposed) return false;
    if (needsIdentity && !participantId) {
      this.scheduleStoreRetry();
      return false;
    }
    // Another flush may have taken the events while identity was resolving.
    if (this.pendingEvents.length === 0) return true;

    const held = this.pendingEvents.splice(0, this.pendingEvents.length);
    const events = held.map(
      (event): CollectionEvent & { uploaded: false } => {
        const pid = event.meta.pid ?? participantId;
        if (!pid) throw new Error('[EventBuffer] Event has no participant ID');
        return { ...event, meta: { ...event.meta, pid } };
      },
    );
    const flushPromise = browser.runtime
      .sendMessage({
        type: 'STORE_EVENTS',
        events,
      })
      .then(
        (response) => {
          if (response?.success === true) {
            this.storeRetryDelayMs = STORE_RETRY_INITIAL_MS;
            return true;
          }

          this.requeueEventsForStorageRetry(held);
          console.error('[EventBuffer] Background failed to store events');
          return false;
        },
        (error) => {
          this.requeueEventsForStorageRetry(held);
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
    if (this.disposed) return;
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    this.batchTimer = window.setTimeout(() => {
      this.batchTimer = null;
      if (VERBOSE) {
        console.log(`[EventBuffer] Batch timer fired (${this.batchIntervalMs}ms)`);
      }
      void this.flushBatch();
    }, this.batchIntervalMs);
  }

  /**
   * Trigger upload of pending events via background service worker
   */
  async flushBatch(): Promise<void> {
    if (this.disposed) return;
    if (this.batchTimer !== null) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    const stored = await this.flushStoredEvents();
    if (!stored) return;
    browser.runtime.sendMessage({ type: 'FLUSH_PENDING_UPLOADS' }).catch(console.error);
  }

  private async getMetadataBase(): Promise<EventMetadataBase> {
    if (!this.metadataBasePromise) {
      this.metadataBasePromise = requestSessionId().then((sid) => ({
        sid,
        tz: getTimezone(),
      }));
      // A failed lookup is asked again by the next event instead of failing
      // every later event.
      this.metadataBasePromise.catch(() => {
        this.metadataBasePromise = null;
      });
    }
    return this.metadataBasePromise;
  }

  /**
   * Create an event with page and session metadata. The participant ID is
   * added when the event is stored.
   */
  async createEvent(
    type: CollectionEventType,
    data: unknown
  ): Promise<UnattributedEvent> {
    const { sid, tz } = await this.getMetadataBase();

    return {
      id: generateULID(),
      type,
      ts: Date.now(),
      data,
      meta: {
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
