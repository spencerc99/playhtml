// ABOUTME: Broadcasts emotes over the "emotes" presence channel and receives peers'.
// ABOUTME: Local-first render, 500ms throttle, dedupe by id — mirrors ChatManager.

import type { PresenceAPI, PresenceView } from "@playhtml/common";

const EMOTE_CHANNEL = "emotes";
const SEND_THROTTLE_MS = 500;

export interface EmoteBroadcast {
  id: string;
  emoteId: string;
  ts: number;
  targetPid?: string;
}

export type OnEmote = (pid: string, emote: EmoteBroadcast, isMe: boolean) => void;

function isEmoteBroadcast(v: unknown): v is EmoteBroadcast {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as EmoteBroadcast).id === "string" &&
    typeof (v as EmoteBroadcast).emoteId === "string"
  );
}

function makeId(now: number): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${now}-${Math.random().toString(36).slice(2)}`;
}

export class EmoteBroadcaster {
  private lastSendAt = 0;
  private seenIds = new Set<string>();
  private lastHighFiveTs = new Map<string, number>();
  private unsub: () => void;

  constructor(
    private presence: PresenceAPI,
    private onEmote: OnEmote,
  ) {
    this.unsub = this.presence.onPresenceChange(EMOTE_CHANNEL, (presences) =>
      this.onPresences(presences),
    );
  }

  emote(emoteId: string, targetPid?: string): void {
    const now = Date.now();
    const myPid = this.presence.getMyIdentity().publicKey;
    const msg: EmoteBroadcast = { id: makeId(now), emoteId, ts: now, targetPid };
    // Local-first so the sender sees immediate feedback even while throttled.
    this.seenIds.add(msg.id);
    this.onEmote(myPid, msg, true);
    if (now - this.lastSendAt < SEND_THROTTLE_MS) return;
    this.lastSendAt = now;
    this.presence.setMyPresence(EMOTE_CHANNEL, msg);
  }

  peerHighFiveTs(pid: string): number | undefined {
    return this.lastHighFiveTs.get(pid);
  }

  private onPresences(presences: Map<string, PresenceView>): void {
    const myPid = this.presence.getMyIdentity().publicKey;
    presences.forEach((view, pid) => {
      if (pid === myPid) return;
      const raw = (view as Record<string, unknown>)[EMOTE_CHANNEL];
      if (!isEmoteBroadcast(raw)) return;
      if (this.seenIds.has(raw.id)) return;
      this.seenIds.add(raw.id);
      if (raw.emoteId === "highfive") this.lastHighFiveTs.set(pid, raw.ts);
      this.onEmote(pid, raw, false);
    });
  }

  destroy(): void {
    this.unsub();
    this.seenIds.clear();
    this.lastHighFiveTs.clear();
  }
}
