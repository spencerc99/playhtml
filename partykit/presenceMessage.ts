// ABOUTME: Persists presence connection state through the hosting platform.
// ABOUTME: Restores hibernation state when platform attachment writes are rejected.

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
