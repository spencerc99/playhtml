// ABOUTME: Stable PresenceAPI facade whose identity survives room rebuilds.
// ABOUTME: Re-attaches active subscriptions to each new inner client on swap.

import type { PlayerIdentity, PresenceAPI, PresenceView } from "@playhtml/common";

type FacadeSubscription = {
  channel: string;
  callback: (presences: Map<string, PresenceView>) => void;
  innerUnsub: () => void;
};

/**
 * One stable object returned by `playhtml.presence` for the lifetime of the
 * playhtml instance. Its methods delegate to whichever inner presence client is
 * current; on a page-room change the inner client is torn down and replaced, so
 * the facade re-attaches every active subscription to the new inner (which
 * replays the new room's snapshot). A reference captured — or an
 * `onPresenceChange` registered — before navigation therefore keeps working
 * after: writes reach the new room and the unsubscribe function still detaches.
 */
export class PresenceFacade implements PresenceAPI {
  private inner: PresenceAPI;
  private subscriptions = new Map<number, FacadeSubscription>();
  private nextSubscriptionId = 0;

  constructor(inner: PresenceAPI) {
    this.inner = inner;
  }

  /** Swap the delegate, re-attaching every active subscription to it. */
  setInner(inner: PresenceAPI): void {
    if (inner === this.inner) return;
    this.inner = inner;
    for (const subscription of this.subscriptions.values()) {
      try {
        subscription.innerUnsub();
      } catch {}
      // Re-subscribing replays the new room's snapshot to the callback.
      subscription.innerUnsub = inner.onPresenceChange(
        subscription.channel,
        subscription.callback,
      );
    }
  }

  setMyPresence(channel: string, data: unknown): void {
    this.inner.setMyPresence(channel, data);
  }

  getPresences(): Map<string, PresenceView> {
    return this.inner.getPresences();
  }

  onPresenceChange(
    channel: string,
    callback: (presences: Map<string, PresenceView>) => void,
  ): () => void {
    const id = this.nextSubscriptionId++;
    const innerUnsub = this.inner.onPresenceChange(channel, callback);
    this.subscriptions.set(id, { channel, callback, innerUnsub });
    return () => {
      const subscription = this.subscriptions.get(id);
      if (!subscription) return;
      this.subscriptions.delete(id);
      try {
        subscription.innerUnsub();
      } catch {}
    };
  }

  getMyIdentity(): PlayerIdentity {
    return this.inner.getMyIdentity();
  }
}
