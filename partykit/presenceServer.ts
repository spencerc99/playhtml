// ABOUTME: Hosts generic realtime presence rooms for volatile PlayHTML state.
// ABOUTME: Coalesces channel updates over PartySocket without using Yjs awareness.

import {
  Server,
  type Connection,
  type ConnectionContext,
  type WSMessage,
} from "partyserver";
import {
  type PresenceClientMessage,
  type PresenceSnapshot,
  type PresenceSyncMessage,
  validatePresenceClientMessage,
} from "@playhtml/common";
import {
  clearPresenceMessageBudget,
  commitPresenceClientMessages,
  consumePresenceMessageBudget,
  createPresenceMessageBudgetState,
  createPresenceRoomState,
  recordPresenceRemoval,
  restorePresenceConnectionChannels,
  takePresenceChanges,
} from "./presencePolicy";
import { getConnectionCloseDiagnostic } from "./connectionDiagnostics";
import {
  persistPresenceConnectionState,
  projectPresenceClientIdentity,
} from "./presenceMessage";

const PRESENCE_CHANNELS_STATE_KEY = "__playhtmlPresenceChannels";
const PRESENCE_OPENED_AT_STATE_KEY = "__playhtmlPresenceOpenedAt";
const PRESENCE_BROADCAST_INTERVAL_MS = 1000 / 60;
const PRESENCE_INVALID_MESSAGE_WINDOW_MS = 1000;
const PRESENCE_INVALID_MESSAGE_LIMIT = 10;

type PresenceConnectionState = Record<string, unknown> & {
  [PRESENCE_CHANNELS_STATE_KEY]?: Record<string, unknown>;
  [PRESENCE_OPENED_AT_STATE_KEY]?: number;
};

type InvalidMessageWindow = {
  startedAt: number;
  count: number;
};

export class PresenceServer extends Server<Env> {
  static override options = {
    hibernate: true,
  };

  private presenceState = createPresenceRoomState();
  private messageBudgets = createPresenceMessageBudgetState();
  private invalidMessageWindows = new Map<string, InvalidMessageWindow>();
  private pendingMessages = new Map<
    string,
    {
      connection: Connection<PresenceConnectionState>;
      messages: Map<string, PresenceClientMessage>;
    }
  >();
  private lastBroadcastAt = 0;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;

  override onConnect(
    connection: Connection,
    _ctx: ConnectionContext,
  ): void | Promise<void> {
    const presenceConnection =
      connection as Connection<PresenceConnectionState>;
    presenceConnection.setState((previous) => ({
      ...(previous ?? {}),
      [PRESENCE_OPENED_AT_STATE_KEY]: Date.now(),
    }));
    this.flushBroadcast();
    presenceConnection.send(JSON.stringify(this.createSyncMessage()));
  }

  override onMessage(connection: Connection, message: WSMessage): void {
    if (typeof message !== "string") {
      this.sendError(connection, "Presence messages must be strings");
      return;
    }

    let parsed: PresenceClientMessage;
    try {
      parsed = validatePresenceClientMessage(
        projectPresenceClientIdentity(JSON.parse(message)),
      );
    } catch (error) {
      this.sendError(connection, getErrorMessage(error));
      return;
    }

    const presenceConnection =
      connection as Connection<PresenceConnectionState>;
    const budget = consumePresenceMessageBudget(
      this.messageBudgets,
      presenceConnection.id,
      parsed,
      Date.now(),
    );
    if (!budget.accepted) {
      this.sendRate(presenceConnection, budget.channel, budget.hz);
      return;
    }

    let pending = this.pendingMessages.get(presenceConnection.id);
    if (!pending) {
      pending = { connection: presenceConnection, messages: new Map() };
      this.pendingMessages.set(presenceConnection.id, pending);
    }
    if (parsed.type === "presence-join") {
      if (parsed.identity !== undefined) {
        pending.messages.set("identity", {
          type: "presence-update",
          channel: "identity",
          value: parsed.identity,
        });
      }
      if (parsed.page !== undefined) {
        pending.messages.set("page", {
          type: "presence-update",
          channel: "page",
          value: parsed.page,
        });
      }
    } else {
      pending.messages.set(parsed.channel, parsed);
    }

    this.scheduleBroadcast();
  }

  override onClose(
    connection: Connection,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void | Promise<void> {
    const presenceConnection =
      connection as Connection<PresenceConnectionState>;
    this.pendingMessages.delete(presenceConnection.id);
    this.restorePeerFromConnection(presenceConnection);
    recordPresenceRemoval(this.presenceState, presenceConnection.id);
    clearPresenceMessageBudget(this.messageBudgets, presenceConnection.id);
    this.invalidMessageWindows.delete(presenceConnection.id);
    this.scheduleBroadcast();

    const diagnostic = this.getCloseDiagnostic(
      presenceConnection,
      code,
      reason,
      wasClean,
    );
    if (diagnostic) console.warn(diagnostic);
  }

  override onError(
    connection: Connection,
    error: unknown,
  ): void | Promise<void> {
    console.error(
      `[PresenceServer] WebSocket error: room=${this.name} connection=${connection.id}`,
      error,
    );
    this.onClose(connection, 1011, getErrorMessage(error), false);
  }

  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return;

    const now = Date.now();
    const elapsed = now - this.lastBroadcastAt;
    if (elapsed >= PRESENCE_BROADCAST_INTERVAL_MS) {
      this.flushBroadcast();
      return;
    }

    // A pending timer prevents hibernation until attachments and broadcasts flush.
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.flushBroadcast();
    }, PRESENCE_BROADCAST_INTERVAL_MS - elapsed);
  }

  private flushBroadcast(): void {
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    for (const { connection, messages } of this.pendingMessages.values()) {
      this.pendingMessages.delete(connection.id);
      if (connection.readyState !== WebSocket.OPEN) continue;
      try {
        commitPresenceClientMessages(
          this.presenceState,
          connection.id,
          connection.state?.[PRESENCE_CHANNELS_STATE_KEY] ?? {},
          Array.from(messages.values()),
          (channels) => this.storeConnectionChannels(connection, channels),
        );
      } catch (error) {
        this.sendError(connection, getErrorMessage(error));
      }
    }
    const changes = takePresenceChanges(this.presenceState);
    if (!changes) return;

    this.lastBroadcastAt = Date.now();
    this.broadcast(JSON.stringify(changes));
  }

  private createSyncMessage(): PresenceSyncMessage {
    const peers: PresenceSnapshot = {};
    for (const connection of this.getConnections<PresenceConnectionState>()) {
      const channels = connection.state?.[PRESENCE_CHANNELS_STATE_KEY];
      if (!channels || Object.keys(channels).length === 0) continue;
      peers[connection.id] = { ...channels };
    }
    return {
      type: "presence-sync",
      peers,
    };
  }

  private storeConnectionChannels(
    connection: Connection<PresenceConnectionState>,
    channels: Record<string, unknown>,
  ): void {
    const previous = connection.state as PresenceConnectionState | null;
    const next: PresenceConnectionState = {
      ...(previous ?? {}),
      [PRESENCE_CHANNELS_STATE_KEY]: channels,
    };
    persistPresenceConnectionState(previous, next, (state) => {
      connection.setState(state);
    });
  }

  private restorePeerFromConnection(
    connection: Connection<PresenceConnectionState>,
  ): void {
    const channels = connection.state?.[PRESENCE_CHANNELS_STATE_KEY];
    if (!channels) return;

    restorePresenceConnectionChannels(
      this.presenceState,
      connection.id,
      channels,
    );
  }

  private sendError(connection: Connection, message: string): void {
    if (!this.consumeInvalidMessageBudget(connection.id)) {
      connection.close(1008, "too many invalid presence messages");
      return;
    }

    connection.send(
      JSON.stringify({
        type: "presence-error",
        message,
      }),
    );
  }

  private sendRate(connection: Connection, channel: string, hz: number): void {
    connection.send(
      JSON.stringify({
        type: "presence-rate",
        channel,
        hz,
      }),
    );
  }

  private consumeInvalidMessageBudget(connectionId: string): boolean {
    const now = Date.now();
    let window = this.invalidMessageWindows.get(connectionId);
    if (
      !window ||
      now - window.startedAt >= PRESENCE_INVALID_MESSAGE_WINDOW_MS
    ) {
      window = { startedAt: now, count: 0 };
      this.invalidMessageWindows.set(connectionId, window);
    }

    if (window.count >= PRESENCE_INVALID_MESSAGE_LIMIT) {
      return false;
    }

    window.count++;
    return true;
  }

  private getCloseDiagnostic(
    connection: Connection<PresenceConnectionState>,
    code: number,
    reason: string,
    wasClean: boolean,
  ): string | null {
    const openedAt = connection.state?.[PRESENCE_OPENED_AT_STATE_KEY];
    return getConnectionCloseDiagnostic({
      roomName: this.name,
      connectionId: connection.id,
      code,
      reason,
      wasClean,
      openedAt,
      label: "PresenceServer",
      quietCloseCodes: [1000, 1005],
    });
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
