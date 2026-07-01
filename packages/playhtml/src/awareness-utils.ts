// ABOUTME: Resolves stable awareness identities for cursor and presence maps.
// ABOUTME: Builds fingerprints for user-authored awareness channels.

/**
 * Resolves the stable ID for a client's awareness entry.
 * Uses __playhtml_identity__.publicKey when present, so presence and cursor
 * views share the same identity source across rooms.
 * If neither identity exists, fall back to clientId so anonymous awareness still works.
 */
export function getStableIdForAwareness(
  state: Record<string, unknown>,
  clientId: number
): string {
  const cursorData = state.__playhtml_cursors__ as
    | { playerIdentity?: { publicKey?: string } }
    | undefined;
  const identityData = state.__playhtml_identity__ as
    | { publicKey?: string }
    | undefined;
  return (
    identityData?.publicKey ??
    cursorData?.playerIdentity?.publicKey ??
    String(clientId)
  );
}

/**
 * Builds a stable string fingerprint of only element-awareness data (all keys
 * that do not start with "__"). Used to skip onChangeAwareness work when only
 * cursor or other internal awareness (e.g. __playhtml_cursors__) changed, so
 * we don't rebuild maps and trigger React re-renders on every mouse move.
 */
export function getElementAwarenessFingerprint(
  states: Map<number, Record<string, unknown>>
): string {
  const parts: string[] = [];
  const clientIds = Array.from(states.keys()).sort((a, b) => a - b);
  for (const clientId of clientIds) {
    const state = states.get(clientId);
    if (!state) continue;
    const tagKeys = Object.keys(state)
      .filter((k) => !k.startsWith("__"))
      .sort();
    for (const tag of tagKeys) {
      const tagData = state[tag];
      if (tagData == null || typeof tagData !== "object") continue;
      const tagRecord = tagData as Record<string, unknown>;
      const elementIds = Object.keys(tagRecord).sort();
      for (const elementId of elementIds) {
        try {
          parts.push(
            `${clientId}:${tag}:${elementId}:${JSON.stringify(tagRecord[elementId])}`
          );
        } catch {
          // skip non-JSON-serializable values
        }
      }
    }
  }
  return parts.join("|");
}
