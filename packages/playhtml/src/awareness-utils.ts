/**
 * Resolves the stable ID for a client's awareness entry.
 * When cursors are enabled, uses playerIdentity.publicKey (stable across sessions).
 * When cursors are disabled we use yprovider; no client sets __playhtml_cursors__,
 * so we fall back to clientId to avoid skipping all awareness.
 */
export function getStableIdForAwareness(
  state: Record<string, unknown>,
  clientId: number
): string {
  const cursorData = state.__playhtml_cursors__ as
    | { playerIdentity?: { publicKey?: string } }
    | undefined;
  return cursorData?.playerIdentity?.publicKey ?? String(clientId);
}
