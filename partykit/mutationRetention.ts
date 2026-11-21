// ABOUTME: Forgets the last mutation number of clients that left a version 2 room long ago.
// ABOUTME: Keeps the per-client map from growing by one entry for every page load that writes.

/** When each client last wrote to or was connected to the room, in epoch milliseconds. */
export type ClientLastSeen = Record<string, number>;

export type PruneForgottenClientsArgs = {
  /** The room's last applied mutation number per client. Pruned in place. */
  lastMutationIds: Record<string, number>;
  /** Pruned and refreshed in place. */
  clientLastSeen: ClientLastSeen;
  /** Clients with an open connection. They are never forgotten. */
  connectedClientIds: ReadonlySet<string>;
  now: number;
  retentionMs: number;
};

/**
 * Removes clients not seen for longer than the retention window and returns
 * how many were removed. A client with no recorded time (a room saved before
 * times were tracked) starts its window now rather than being dropped.
 */
export function pruneForgottenClients(args: PruneForgottenClientsArgs): number {
  const {
    lastMutationIds,
    clientLastSeen,
    connectedClientIds,
    now,
    retentionMs,
  } = args;
  let removed = 0;
  for (const clientId of Object.keys(lastMutationIds)) {
    if (connectedClientIds.has(clientId)) {
      clientLastSeen[clientId] = now;
      continue;
    }
    const lastSeen = clientLastSeen[clientId];
    if (lastSeen === undefined) {
      clientLastSeen[clientId] = now;
      continue;
    }
    if (now - lastSeen > retentionMs) {
      delete lastMutationIds[clientId];
      delete clientLastSeen[clientId];
      removed += 1;
    }
  }
  for (const clientId of Object.keys(clientLastSeen)) {
    if (!(clientId in lastMutationIds)) delete clientLastSeen[clientId];
  }
  return removed;
}
