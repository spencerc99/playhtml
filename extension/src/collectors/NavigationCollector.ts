// ABOUTME: Collector for tab visibility, navigation, and page lifecycle events
// ABOUTME: Emits focus/blur events to enable screen time calculation from local event data

import { BaseCollector } from './BaseCollector';
import type { NavigationEventData } from './types';
import { VERBOSE } from '../config';
import { buildMetadataHash, getCurrentPageMetadata } from '../utils/pageMetadata';
import { isMediaPlaying } from '../utils/media';

/**
 * A visible tab with no input for this long stops counting as screen time.
 * Leaving a computer unlocked overnight otherwise counts the whole night
 * against whatever tab was in front.
 */
export const IDLE_TIMEOUT_MS = 5 * 60_000;

const ACTIVITY_EVENTS = [
  'pointermove',
  'pointerdown',
  'keydown',
  'wheel',
  'scroll',
  'touchstart',
] as const;

/**
 * NavigationCollector captures navigation and tab lifecycle events:
 * 
 * - Tab visibility changes (when user switches tabs)
 * - Browser navigation (back/forward via popstate)
 * - Page unload (beforeunload)
 * - Idle: a visible tab with no input for IDLE_TIMEOUT_MS emits a blur, and the
 *   next input emits a focus, so idle stretches don't count as screen time.
 *   Playing media keeps the tab active. Embedded frames report their input
 *   and media through noteActivity() (see features/frameActivity.ts).
 */
export class NavigationCollector extends BaseCollector<NavigationEventData> {
  readonly type = 'navigation' as const;
  readonly description = 'Captures tab visibility, navigation, and page lifecycle events';
  
  private visibilityChangeHandler?: () => void;
  private popstateHandler?: (e: PopStateEvent) => void;
  private beforeunloadHandler?: (e: BeforeUnloadEvent) => void;
  private activityHandler?: () => void;

  // Idle detection: the clock stops after IDLE_TIMEOUT_MS without input
  private idle = false;
  private lastActivityTs = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  
  // Deduplication: prevent duplicate events within time window
  private lastEventType: string | null = null;
  private lastEventTime = 0;
  private dedupWindow = 2000; // ms - ignore duplicate events within 2 seconds
  private eventQuantity = 0; // Count events during debounce window
  
  start(): void {
    if (VERBOSE) {
      console.log('[NavigationCollector] Starting navigation collection...');
    }
    
    // Visibility change handler (tab switches)
    this.visibilityChangeHandler = () => {
      const event = document.hidden ? 'blur' : 'focus';

      if (document.hidden) {
        this.clearIdleTimer();
        // Going idle already emitted the blur that closes this session
        if (this.idle) {
          this.idle = false;
          return;
        }
      } else {
        this.idle = false;
        this.markActive();
      }

      // Check for duplicates
      if (this.isDuplicate(event)) {
        if (VERBOSE) {
          console.log(`[NavigationCollector] Ignoring duplicate ${event} event`);
        }
        return;
      }
      
      this.emitDiscreteEvent({
        event,
        // Include visibility state for context
        visibility_state: document.visibilityState as any,
        ...this.getPageSnapshot(),
      });
      
      this.updateLastEvent(event);
    };
    
    // Popstate handler (back/forward navigation)
    this.popstateHandler = (e: PopStateEvent) => {
      if (this.isDuplicate('popstate')) {
        return;
      }
      
      this.emitDiscreteEvent({
        event: 'popstate',
        url: window.location.href,
        state: e.state,
        ...this.getPageSnapshot(window.location.href),
      });
      
      this.updateLastEvent('popstate');
    };
    
    // Beforeunload handler (page leaving)
    this.beforeunloadHandler = (e: BeforeUnloadEvent) => {
      // Don't dedupe beforeunload - it only fires once anyway
      this.emitDiscreteEvent({
        event: 'beforeunload',
        from_url: window.location.href,
        ...this.getPageSnapshot(window.location.href),
      });
    };
    
    // Any input marks the tab active and resumes a session that went idle
    this.activityHandler = () => {
      if (document.visibilityState !== 'visible') return;
      if (this.idle) {
        this.idle = false;
        this.emitDiscreteEvent({
          event: 'focus',
          visibility_state: 'visible',
          ...this.getPageSnapshot(),
        });
        this.updateLastEvent('focus');
      }
      this.markActive();
    };

    // Attach event listeners
    // Use visibilitychange instead of focus/blur for better tab switch detection
    document.addEventListener('visibilitychange', this.visibilityChangeHandler);
    window.addEventListener('popstate', this.popstateHandler);
    window.addEventListener('beforeunload', this.beforeunloadHandler);
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, this.activityHandler, { capture: true, passive: true });
    }

    // Emit synthetic focus if the page is already visible when collection starts.
    // Without this, a session that begins mid-visit has no focus anchor and the
    // first blur event cannot be paired to compute screen time.
    if (document.visibilityState === 'visible') {
      this.emitDiscreteEvent({
        event: 'focus',
        visibility_state: 'visible',
        ...this.getPageSnapshot(),
      });
      this.updateLastEvent('focus');
      this.markActive();
    }

    if (VERBOSE) {
      console.log('[NavigationCollector] Started successfully');
    }
  }
  
  stop(): void {
    this.clearIdleTimer();
    this.idle = false;

    if (this.activityHandler) {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, this.activityHandler, { capture: true });
      }
      this.activityHandler = undefined;
    }

    if (this.visibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.visibilityChangeHandler);
      this.visibilityChangeHandler = undefined;
    }
    
    if (this.popstateHandler) {
      window.removeEventListener('popstate', this.popstateHandler);
      this.popstateHandler = undefined;
    }
    
    if (this.beforeunloadHandler) {
      window.removeEventListener('beforeunload', this.beforeunloadHandler);
      this.beforeunloadHandler = undefined;
    }
  }

  /**
   * Input or playing media inside an embedded frame, relayed from the frame's
   * content script. Counts the same as input on this page.
   */
  noteActivity(): void {
    this.activityHandler?.();
  }

  /**
   * Record input and make sure an idle check is pending. The timer is only
   * scheduled when none is pending, so high-frequency input stays cheap.
   */
  private markActive(): void {
    this.lastActivityTs = Date.now();
    if (this.idleTimer === null) {
      this.scheduleIdleCheck(IDLE_TIMEOUT_MS);
    }
  }

  private scheduleIdleCheck(delayMs: number): void {
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.checkIdle();
    }, delayMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private checkIdle(): void {
    if (this.idle || document.visibilityState !== 'visible') return;

    const remaining = this.lastActivityTs + IDLE_TIMEOUT_MS - Date.now();
    if (remaining > 0) {
      this.scheduleIdleCheck(remaining);
      return;
    }
    // Watching a video or listening without touching anything is still active
    if (isMediaPlaying()) {
      this.scheduleIdleCheck(IDLE_TIMEOUT_MS);
      return;
    }

    this.idle = true;
    this.emitDiscreteEvent({
      event: 'blur',
      visibility_state: 'visible',
      idle: true,
      ...this.getPageSnapshot(),
    });
    this.updateLastEvent('blur');
  }

  /**
   * Check if event is a duplicate within deduplication window
   */
  private isDuplicate(eventType: string): boolean {
    const now = Date.now();
    const timeSinceLastEvent = now - this.lastEventTime;
    
    const isDupe = (
      this.lastEventType === eventType &&
      timeSinceLastEvent < this.dedupWindow
    );
    
    if (isDupe) {
      this.eventQuantity++; // Increment if it's a duplicate
      if (VERBOSE) {
        console.log(`[NavigationCollector] Duplicate ${eventType} detected (quantity: ${this.eventQuantity})`);
      }
    }
    
    return isDupe;
  }
  
  /**
   * Update last event tracking for deduplication
   */
  private updateLastEvent(eventType: string): void {
    this.lastEventType = eventType;
    this.lastEventTime = Date.now();
    this.eventQuantity = 1; // Reset to 1 (current event)
  }
  
  /**
   * Emit a discrete navigation event immediately
   */
  private emitDiscreteEvent(data: NavigationEventData): void {
    if (!this.enabled) return;
    
    // Add quantity to the event data
    const dataWithQuantity = {
      ...data,
      quantity: this.eventQuantity,
    };
    
    if (VERBOSE) {
      console.log(`[NavigationCollector] Emitting navigation event (${this.eventQuantity} occurrences):`, dataWithQuantity);
    }
    
    // Emit to buffer for archival
    this.emit(dataWithQuantity);
  }

  /**
   * Capture page metadata snapshot at event time.
   * This allows server-side dedupe/versioning without keeping large fields per event row.
   */
  private getPageSnapshot(url = window.location.href): Pick<
    NavigationEventData,
    'page_ref' | 'canonical_url' | 'title' | 'favicon_url' | 'metadata_hash'
  > {
    const metadata = getCurrentPageMetadata(url);
    return {
      ...metadata,
      metadata_hash: buildMetadataHash(metadata.title, metadata.favicon_url),
    };
  }
}
