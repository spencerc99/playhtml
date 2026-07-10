// ABOUTME: Validates incoming presence messages before the server parses them.
// ABOUTME: Restores hibernation state when platform attachment writes are rejected.

const MAX_PRESENCE_MESSAGE_BYTES = 1024 * 1024;

export function assertPresenceMessageSize(message: string): void {
  if (new TextEncoder().encode(message).byteLength > MAX_PRESENCE_MESSAGE_BYTES) {
    throw new Error("Presence messages must be 1 MiB or less");
  }
}

export function persistPresenceConnectionState<T>(
  previous: T,
  next: T,
  persist: (state: T) => void,
): void {
  try {
    persist(next);
  } catch {
    persist(previous);
    throw new Error("Presence state exceeds server storage limit");
  }
}
