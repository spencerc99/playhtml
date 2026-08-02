// ABOUTME: Persists presence connection state through the hosting platform.
// ABOUTME: Prepares compatible client messages and restores rejected attachment writes.

const PUBLIC_IDENTITY_FIELDS = [
  "publicKey",
  "name",
  "playerStyle",
  "createdAt",
] as const;
const PUBLIC_PLAYER_STYLE_FIELDS = ["colorPalette", "cursorStyle"] as const;

export function projectPresenceClientIdentity(value: unknown): unknown {
  if (!isRecord(value)) return value;

  if (value.type === "presence-join" && isRecord(value.identity)) {
    return {
      ...value,
      identity: projectPlayerIdentity(value.identity),
    };
  }

  if (
    value.type === "presence-update" &&
    value.channel === "identity" &&
    isRecord(value.value)
  ) {
    return {
      ...value,
      value: projectPlayerIdentity(value.value),
    };
  }

  return value;
}

function projectPlayerIdentity(
  identity: Record<string, unknown>,
): Record<string, unknown> {
  const projected = pickFields(identity, PUBLIC_IDENTITY_FIELDS);
  if (isRecord(projected.playerStyle)) {
    projected.playerStyle = pickFields(
      projected.playerStyle,
      PUBLIC_PLAYER_STYLE_FIELDS,
    );
  }
  return projected;
}

function pickFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(value, field)) {
      projected[field] = value[field];
    }
  }
  return projected;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
