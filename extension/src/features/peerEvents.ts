// ABOUTME: Window events that let the phone tap menu reach follow and emotes.
// ABOUTME: Kept apart so each feature can listen without importing the others.

/** Asks the page's FollowManager to follow someone. */
export const FOLLOW_PEER_EVENT = "wwo:follow-peer";
/** Set on <html> while this page can follow people, so the tap menu offers it. */
export const FOLLOW_AVAILABLE_ATTR = "data-wwo-can-follow";
/** Fires an emote from a point on screen; handled by the emote layer. */
export const FIRE_EMOTE_EVENT = "wwo:fire-emote";

export interface FollowPeerDetail {
  publicKey: string;
  color: string;
}

export interface FireEmoteDetail {
  emoteId: string;
  x: number;
  y: number;
}
