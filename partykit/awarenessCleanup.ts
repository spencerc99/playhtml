// ABOUTME: Identifies Yjs awareness client IDs not owned by live connections.
// ABOUTME: Supports opportunistic cleanup of stale presence in PartyServer rooms.

export const Y_PARTYSERVER_AWARENESS_IDS_STATE_KEY = "__ypsAwarenessIds";

type ConnectionWithState = {
  state?: Record<string, unknown> | null;
};

export function getConnectionAwarenessIds(
  connection: ConnectionWithState,
): number[] {
  const value = connection.state?.[Y_PARTYSERVER_AWARENESS_IDS_STATE_KEY];
  if (!Array.isArray(value)) return [];

  return value.filter((id): id is number => Number.isInteger(id));
}

export function getOrphanedAwarenessIds(
  awarenessIds: Iterable<number>,
  connections: Iterable<ConnectionWithState>,
): number[] {
  const controlledIds = new Set<number>();
  for (const connection of connections) {
    for (const id of getConnectionAwarenessIds(connection)) {
      controlledIds.add(id);
    }
  }

  return Array.from(awarenessIds).filter((id) => !controlledIds.has(id));
}
