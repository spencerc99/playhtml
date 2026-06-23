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
  applyPresenceClientMessage,
  createPresenceRoomState,
  recordPresenceRemoval,
  recordPresenceUpdate,
  takePresenceChanges,
} from "./presencePolicy";

const PRESENCE_CHANNELS_STATE_KEY = "__playhtmlPresenceChannels";
const PRESENCE_OPENED_AT_STATE_KEY = "__playhtmlPresenceOpenedAt";
const PRESENCE_BROADCAST_INTERVAL_MS = 1000 / 60;

type PresenceConnectionState = Record<string, unknown> & {
  [PRESENCE_CHANNELS_STATE_KEY]?: Record<string, unknown>;
  [PRESENCE_OPENED_AT_STATE_KEY]?: number;
};

export class PresenceServer extends Server<Env> {
  static override options = {
    hibernate: true,
  };

  private presenceState = createPresenceRoomState();
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
    presenceConnection.send(JSON.stringify(this.createSyncMessage()));
  }

  override onMessage(connection: Connection, message: WSMessage): void {
    if (typeof message !== "string") {
      this.sendError(connection, "Presence messages must be strings");
      return;
    }

    let parsed: PresenceClientMessage;
    try {
      parsed = validatePresenceClientMessage(JSON.parse(message));
    } catch (error) {
      this.sendError(connection, getErrorMessage(error));
      return;
    }

    const presenceConnection =
      connection as Connection<PresenceConnectionState>;
    applyPresenceClientMessage(
      this.presenceState,
      presenceConnection.id,
      parsed,
    );
    this.storeConnectionChannels(presenceConnection);

    if (parsed.type !== "presence-ping") {
      this.scheduleBroadcast();
    }
  }

  override onClose(
    connection: Connection,
    code: number,
    reason: string,
    wasClean: boolean,
  ): void | Promise<void> {
    const presenceConnection =
      connection as Connection<PresenceConnectionState>;
    this.restorePeerFromConnection(presenceConnection);
    recordPresenceRemoval(this.presenceState, presenceConnection.id);
    this.scheduleBroadcast();

    const diagnostic = this.getCloseDiagnostic(
      presenceConnection,
      code,
      reason,
      wasClean,
    );
    if (diagnostic) console.warn(diagnostic);
  }

  override onError(connection: Connection, error: unknown): void | Promise<void> {
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

    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      this.flushBroadcast();
    }, PRESENCE_BROADCAST_INTERVAL_MS - elapsed);
  }

  private flushBroadcast(): void {
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
  ): void {
    const channels = this.presenceState.peers.get(connection.id);
    connection.setState((previous) => ({
      ...(previous ?? {}),
      [PRESENCE_CHANNELS_STATE_KEY]: channels
        ? Object.fromEntries(channels)
        : {},
    }));
  }

  private restorePeerFromConnection(
    connection: Connection<PresenceConnectionState>,
  ): void {
    const channels = connection.state?.[PRESENCE_CHANNELS_STATE_KEY];
    if (!channels) return;

    for (const [channel, value] of Object.entries(channels)) {
      recordPresenceUpdate(this.presenceState, connection.id, channel, value);
    }
  }

  private sendError(connection: Connection, message: string): void {
    connection.send(
      JSON.stringify({
        type: "presence-error",
        message,
      }),
    );
  }

  private getCloseDiagnostic(
    connection: Connection<PresenceConnectionState>,
    code: number,
    reason: string,
    wasClean: boolean,
  ): string | null {
    if (code === 1000 && wasClean) return null;

    const openedAt = connection.state?.[PRESENCE_OPENED_AT_STATE_KEY];
    const duration =
      typeof openedAt === "number" ? Date.now() - openedAt : "unknown";
    return (
      `[PresenceServer] WebSocket closed abnormally: room=${this.name} ` +
      `connection=${connection.id} code=${code} reason="${reason}" ` +
      `wasClean=${wasClean} durationMs=${duration}`
    );
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
