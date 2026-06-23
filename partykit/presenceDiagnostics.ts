// ABOUTME: Classifies generic presence WebSocket lifecycle events.
// ABOUTME: Keeps Worker diagnostics focused on unexpected disconnects.

export function isExpectedPresenceClose(code: number, wasClean: boolean): boolean {
  return wasClean && (code === 1000 || code === 1005);
}
