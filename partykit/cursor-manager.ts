import type * as Party from "partykit/server";
import type {
  Cursor,
  CursorUser,
  CursorPresence,
  CursorMetadata,
  CursorPartyMessage,
  CursorClientMessage,
  PlayerIdentity,
} from "@playhtml/common";
import { calculateDistance, PROXIMITY_THRESHOLD } from "@playhtml/common";
import {
  BROADCAST_INTERVAL,
  CURSOR_CLEANUP_INTERVAL,
  CURSOR_TIMEOUT,
  cursorClientMessageSchema,
  decodeCursorMessage,
  encodeCursorPartyMessage,
} from "./cursor-schemas";

export type ConnectionWithCursor = Party.Connection<{
  metadata?: CursorMetadata;
  presence?: CursorPresence;
}>;

export class CursorManager {
  private cursors: Map<string, CursorUser> = new Map();
  private proximityPairs: Set<string> = new Set();

  // Pending updates queued for next broadcast
  private pendingAdd: { [id: string]: CursorUser } = {};
  private pendingPresence: { [id: string]: CursorPresence } = {};
  private pendingRemove: string[] = [];

  private lastBroadcast = 0;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private party: Party.Party) {
    // Start cleanup timer for stale cursors
    this.cleanupTimer = setInterval(() => {
      this.cleanupStaleCursors();
    }, CURSOR_CLEANUP_INTERVAL);
  }

  onConnect(connection: ConnectionWithCursor, request: Party.Request): void {
    const metadata: CursorMetadata = {
      country: (request as any)?.cf?.country ?? null,
      connectionId: connection.id,
    };

    // Extract initial presence from query params
    const params = new URLSearchParams(request?.url?.split("?")[1] || "");
    const presence: CursorPresence = {
      playerIdentity: params.get("playerIdentity")
        ? JSON.parse(decodeURIComponent(params.get("playerIdentity")!))
        : undefined,
    };

    connection.setState({ presence, metadata });
    this.join(connection);
  }

  onMessage(
    message: string | ArrayBufferLike,
    connection: ConnectionWithCursor
  ): void {
    let data: any;
    try {
      data =
        typeof message === "string"
          ? JSON.parse(message)
          : decodeCursorMessage(message);
    } catch {
      return;
    }

    const result = cursorClientMessageSchema.safeParse(data);
    if (!result.success) {
      return;
    }

    data = result.data;

    switch (data.type) {
      case "cursor-update":
        this.handleCursorUpdate(connection, data.presence);
        break;
      case "cursor-request-sync":
        this.sendSyncToConnection(connection);
        break;
    }
  }

  onClose(connection: ConnectionWithCursor): void {
    this.leave(connection);
  }

  onError(connection: ConnectionWithCursor): void {
    this.leave(connection);
  }

  private join(connection: ConnectionWithCursor): void {
    const user = this.getUser(connection);
    this.enqueueAdd(connection.id, user);

    // Send sync message to new connection
    this.sendSyncToConnection(connection);

    this.broadcast();
  }

  private sendSyncToConnection(connection: ConnectionWithCursor): void {
    const sync: CursorPartyMessage = {
      type: "cursor-sync",
      users: Object.fromEntries(this.cursors),
    };
    connection.send(encodeCursorPartyMessage(sync));
  }

  private leave(connection: ConnectionWithCursor): void {
    this.enqueueRemove(connection.id);
    this.broadcast();
  }

  private handleCursorUpdate(
    connection: ConnectionWithCursor,
    presence: CursorPresence
  ): void {
    // Update presence with timestamp
    const updatedPresence: CursorPresence = {
      ...presence,
      lastSeen: Date.now(),
    };

    connection.setState((prevState) => ({
      ...prevState,
      presence: updatedPresence,
    }));

    this.enqueuePresence(connection.id, updatedPresence);

    // Check for proximity changes if cursor position updated
    if (updatedPresence.cursor) {
      this.checkProximity(connection.id, updatedPresence.cursor);
    }

    this.broadcast();
  }

  private checkProximity(connectionId: string, cursor: Cursor): void {
    for (const [otherId, otherUser] of this.cursors) {
      if (otherId === connectionId || !otherUser.presence.cursor) continue;

      const distance = calculateDistance(cursor, otherUser.presence.cursor);
      const pairKey = [connectionId, otherId].sort().join("-");
      const wasNear = this.proximityPairs.has(pairKey);
      const isNear = distance < PROXIMITY_THRESHOLD;

      if (!wasNear && isNear) {
        // Players entered proximity
        this.proximityPairs.add(pairKey);
        this.notifyProximityEntered(
          connectionId,
          otherId,
          otherUser.presence.playerIdentity
        );
      } else if (wasNear && !isNear) {
        // Players left proximity
        this.proximityPairs.delete(pairKey);
        this.notifyProximityLeft(connectionId, otherId);
      }
    }
  }

  private notifyProximityEntered(
    connectionId: string,
    otherId: string,
    playerIdentity?: PlayerIdentity
  ): void {
    const proximityMessage: CursorPartyMessage = {
      type: "proximity-entered",
      connectionId,
      otherConnectionId: otherId,
      playerIdentity,
    };

    // Send to both players
    this.party
      .getConnection(connectionId)
      ?.send(encodeCursorPartyMessage(proximityMessage));
    this.party.getConnection(otherId)?.send(
      encodeCursorPartyMessage({
        ...proximityMessage,
        connectionId: otherId,
        otherConnectionId: connectionId,
      })
    );
  }

  private notifyProximityLeft(connectionId: string, otherId: string): void {
    const proximityMessage: CursorPartyMessage = {
      type: "proximity-left",
      connectionId,
      otherConnectionId: otherId,
    };

    // Send to both players
    this.party
      .getConnection(connectionId)
      ?.send(encodeCursorPartyMessage(proximityMessage));
    this.party.getConnection(otherId)?.send(
      encodeCursorPartyMessage({
        ...proximityMessage,
        connectionId: otherId,
        otherConnectionId: connectionId,
      })
    );
  }

  private cleanupStaleCursors(): void {
    const now = Date.now();
    const staleConnections: string[] = [];

    for (const [connectionId, user] of this.cursors) {
      if (
        user.presence.lastSeen &&
        now - user.presence.lastSeen > CURSOR_TIMEOUT
      ) {
        staleConnections.push(connectionId);
      }
    }

    for (const connectionId of staleConnections) {
      this.enqueueRemove(connectionId);
    }

    if (staleConnections.length > 0) {
      this.broadcast();
    }
  }

  private getUser(connection: ConnectionWithCursor): CursorUser {
    return {
      presence: connection.state?.presence ?? ({} as CursorPresence),
      metadata: connection.state?.metadata ?? {
        country: null,
        connectionId: connection.id,
      },
    };
  }

  private enqueueAdd(id: string, user: CursorUser): void {
    this.pendingAdd[id] = user;
    this.cursors.set(id, user);
  }

  private enqueuePresence(id: string, presence: CursorPresence): void {
    this.pendingPresence[id] = presence;

    // Update stored cursor data
    const existing = this.cursors.get(id);
    if (existing) {
      existing.presence = presence;
    }
  }

  private enqueueRemove(id: string): void {
    this.pendingRemove.push(id);
    this.cursors.delete(id);

    // Clean up proximity pairs involving this connection
    const toDelete: string[] = [];
    for (const pairKey of this.proximityPairs) {
      if (pairKey.includes(id)) {
        toDelete.push(pairKey);
      }
    }
    toDelete.forEach((key) => this.proximityPairs.delete(key));
  }

  private broadcast(): void {
    const now = Date.now();
    const ago = now - this.lastBroadcast;

    if (ago >= BROADCAST_INTERVAL) {
      this._broadcast();
    } else {
      if (!this.broadcastTimer) {
        this.broadcastTimer = setTimeout(() => {
          this._broadcast();
          this.broadcastTimer = null;
        }, BROADCAST_INTERVAL - ago);
      }
    }
  }

  private _broadcast(): void {
    this.lastBroadcast = Date.now();

    // Skip if only one connection and no meaningful changes
    const connections = [...this.party.getConnections()];
    if (this.shouldSkipBroadcast(connections)) {
      this.clearPendingUpdates();
      return;
    }

    const update: CursorPartyMessage = {
      type: "cursor-changes",
      add:
        Object.keys(this.pendingAdd).length > 0 ? this.pendingAdd : undefined,
      presence:
        Object.keys(this.pendingPresence).length > 0
          ? this.pendingPresence
          : undefined,
      remove: this.pendingRemove.length > 0 ? this.pendingRemove : undefined,
    };

    this.party.broadcast(encodeCursorPartyMessage(update));
    this.clearPendingUpdates();
  }

  private shouldSkipBroadcast(connections: Party.Connection[]): boolean {
    const presenceIds = new Set(Object.keys(this.pendingPresence));
    return (
      connections.length === 1 &&
      this.pendingRemove.length === 0 &&
      Object.keys(this.pendingAdd).length === 0 &&
      presenceIds.size === 1 &&
      presenceIds.has(connections[0].id)
    );
  }

  private clearPendingUpdates(): void {
    this.pendingAdd = {};
    this.pendingPresence = {};
    this.pendingRemove = [];
  }

  // HTTP endpoint for getting current cursor state
  getCursors(): { [id: string]: CursorUser } {
    return Object.fromEntries(this.cursors);
  }

  destroy(): void {
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}
