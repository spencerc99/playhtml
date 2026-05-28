// ABOUTME: Orchestrator for Wikipedia article chat — state store, presence wiring, send/throttle.
// ABOUTME: React panel and echo renderer are mounted separately in wikipedia.ts using this manager.

import type { PresenceAPI, PresenceView } from "@playhtml/common";
import { containsProfanity } from "@movement/profanity";
import { getOrCreateHandle, rerollHandle } from "./chat-handle";

const CHAT_CHANNEL = "chat";
const MAX_MESSAGE_LENGTH = 400;
const SEND_THROTTLE_MS = 500;
const RING_BUFFER_SIZE = 50;

export type ChatMessageBroadcast = {
  id: string;
  text: string;
  ts: number;
  name: string;
};

export type ChatMessageView = ChatMessageBroadcast & {
  pid: string;
  color: string;
  isMe: boolean;
};

export type ChatManagerState = {
  messages: ChatMessageView[];
  handle: string;
  articleTitle: string;
  isOpen: boolean;
  unread: boolean;
  sendError: string | null;
  myColor: string;
  // Increments whenever the input should be (re)focused — e.g. pressing "/"
  // while the panel is already open but the input isn't focused. The panel
  // watches this and focuses its textarea on change.
  focusNonce: number;
};

type Listener = () => void;

function isChatMessage(v: unknown): v is ChatMessageBroadcast {
  if (!v || typeof v !== "object") return false;
  const m = v as Record<string, unknown>;
  return (
    typeof m.id === "string" &&
    typeof m.text === "string" &&
    typeof m.ts === "number" &&
    typeof m.name === "string"
  );
}

export class ChatManager {
  private state: ChatManagerState;
  private listeners = new Set<Listener>();
  private unsubPresence: (() => void) | null = null;
  private lastSendAt = 0;
  private seenIds = new Set<string>();
  // onPresenceChange replays the current snapshot on subscribe. We intentionally
  // do NOT seed the panel from it: presence holds only each peer's latest
  // message, so a replay would reconstruct an incoherent partial transcript
  // (missing any earlier messages a peer overwrote). Chat stays live-session
  // only — we mark replayed ids as seen so they don't double-append later.
  private seededInitialSnapshot = false;

  constructor(
    private presence: PresenceAPI,
    articleTitle: string,
  ) {
    const myIdentity = presence.getMyIdentity();
    const myColor = myIdentity.playerStyle?.colorPalette?.[0] ?? "#8a8279";
    this.state = {
      messages: [],
      handle: "Anonymous",
      articleTitle,
      isOpen: false,
      unread: false,
      sendError: null,
      myColor,
      focusNonce: 0,
    };
  }

  async init(): Promise<void> {
    const handle = await getOrCreateHandle();
    this.setState({ handle });
    this.unsubPresence = this.presence.onPresenceChange(CHAT_CHANNEL, (presences) => {
      this.onPresences(presences);
    });
  }

  destroy(): void {
    this.unsubPresence?.();
    this.unsubPresence = null;
    this.listeners.clear();
  }

  getState(): ChatManagerState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  send(text: string): boolean {
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    const capped = trimmed.slice(0, MAX_MESSAGE_LENGTH);
    if (containsProfanity(capped)) {
      this.setState({ sendError: "this won't send — mind the language" });
      return false;
    }
    const now = Date.now();
    if (now - this.lastSendAt < SEND_THROTTLE_MS) return false;
    this.lastSendAt = now;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${now}-${Math.random().toString(36).slice(2)}`;
    const msg: ChatMessageBroadcast = {
      id,
      text: capped,
      ts: now,
      name: this.state.handle,
    };
    const myPid = this.presence.getMyIdentity().publicKey;
    // Append locally BEFORE broadcasting: setMyPresence synchronously fires
    // awareness listeners which would otherwise mark our own id as "seen"
    // before our optimistic append runs, causing it to be deduped away.
    this.appendMessage({
      ...msg,
      pid: myPid,
      color: this.state.myColor,
      isMe: true,
    });
    this.presence.setMyPresence(CHAT_CHANNEL, msg);
    if (this.state.sendError !== null) this.setState({ sendError: null });
    return true;
  }

  clearError(): void {
    if (this.state.sendError !== null) this.setState({ sendError: null });
  }

  toggle(): void {
    if (this.state.isOpen) {
      this.setState({ isOpen: false });
    } else {
      this.setState({ isOpen: true, unread: false });
    }
  }

  // Pressing "/" should open the panel if closed, or just focus the input if
  // it's already open — never close it (closing is Esc / the minimize button).
  openOrFocus(): void {
    if (this.state.isOpen) {
      this.setState({ focusNonce: this.state.focusNonce + 1 });
    } else {
      this.setState({ isOpen: true, unread: false, focusNonce: this.state.focusNonce + 1 });
    }
  }

  close(): void {
    if (this.state.isOpen) this.setState({ isOpen: false });
  }

  async reroll(): Promise<void> {
    const fresh = await rerollHandle();
    this.setState({ handle: fresh });
  }

  private onPresences(presences: Map<string, PresenceView>): void {
    // First call is the subscribe-time replay. Mark every message currently in
    // presence as seen but do NOT append — chat is live-session only and the
    // replay can't represent coherent history (see seededInitialSnapshot note).
    if (!this.seededInitialSnapshot) {
      this.seededInitialSnapshot = true;
      presences.forEach((view) => {
        const raw = (view as Record<string, unknown>)[CHAT_CHANNEL];
        if (isChatMessage(raw)) this.seenIds.add(raw.id);
      });
      return;
    }

    const myPid = this.presence.getMyIdentity().publicKey;
    let unreadFromBatch = false;
    presences.forEach((view, pid) => {
      const raw = (view as Record<string, unknown>)[CHAT_CHANNEL];
      if (!isChatMessage(raw)) return;
      if (this.seenIds.has(raw.id)) return;
      const isMe = pid === myPid;
      if (isMe) {
        this.seenIds.add(raw.id);
        return;
      }
      const color = view.playerIdentity?.playerStyle?.colorPalette?.[0] ?? "#8a8279";
      this.appendMessage({ ...raw, pid, color, isMe: false });
      if (!this.state.isOpen) unreadFromBatch = true;
    });
    if (unreadFromBatch && !this.state.unread) {
      this.setState({ unread: true });
    }
  }

  private appendMessage(msg: ChatMessageView): void {
    if (this.seenIds.has(msg.id)) return;
    this.seenIds.add(msg.id);
    const next = [...this.state.messages, msg];
    while (next.length > RING_BUFFER_SIZE) {
      const evicted = next.shift();
      if (evicted) this.seenIds.delete(evicted.id);
    }
    this.setState({ messages: next });
  }

  private setState(patch: Partial<ChatManagerState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
}
