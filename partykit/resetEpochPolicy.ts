// ABOUTME: Provides pure reset-epoch parsing and staleness helpers for PartyServer.
// ABOUTME: Keeps reset boundary decisions consistent for client, bridge, and socket checks.
export function parseClientResetEpoch(value: string | null): number | null {
  if (value === null || value === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isResetEpochStale(
  candidateEpoch: number | null,
  serverEpoch: number | null
): boolean {
  return (
    serverEpoch !== null &&
    (candidateEpoch === null || candidateEpoch < serverEpoch)
  );
}

export type AutosaveResetEpochDecision =
  | { kind: "save" }
  | { kind: "skip"; reason: string }
  | { kind: "promote-server-epoch"; resetEpoch: number };

export function getAutosaveResetEpochDecision(
  docResetEpoch: number | null,
  serverResetEpoch: number | null
): AutosaveResetEpochDecision {
  if (isResetEpochStale(docResetEpoch, serverResetEpoch)) {
    const reason =
      docResetEpoch === null
        ? `doc reset epoch missing while server epoch=${serverResetEpoch}`
        : `doc reset epoch ${docResetEpoch} < server epoch ${serverResetEpoch}`;
    return { kind: "skip", reason };
  }

  if (
    docResetEpoch !== null &&
    (serverResetEpoch === null || docResetEpoch > serverResetEpoch)
  ) {
    return { kind: "promote-server-epoch", resetEpoch: docResetEpoch };
  }

  return { kind: "save" };
}

// A socket whose reset epoch is older than the room's is held open instead of
// closed. Closing it lets the client's reconnect backoff reset on every open, so
// clients that cannot handle room-reset reconnect in a tight loop. The first
// Yjs message decides what happens next: a client with no document history can
// be admitted safely, while one with history must never merge into the room.
export type HeldConnectionMessageDecision = "admit" | "reject" | "wait";

const Y_MESSAGE_SYNC = 0;
const Y_MESSAGE_AWARENESS = 1;
const Y_SYNC_STEP_1 = 0;

function readVarUint(
  bytes: Uint8Array,
  offset: number
): { value: number; next: number } | null {
  let value = 0;
  let shift = 0;
  let index = offset;
  while (index < bytes.length) {
    const byte = bytes[index];
    value += (byte & 0x7f) * 2 ** shift;
    index += 1;
    if (byte < 0x80) return { value, next: index };
    shift += 7;
    if (shift > 49) return null;
  }
  return null;
}

// Reads the entry count of the state vector carried by a Yjs sync step 1
// message. Returns null for any other message shape.
export function readSyncStep1StateVectorSize(
  message: Uint8Array
): number | null {
  const messageType = readVarUint(message, 0);
  if (messageType === null || messageType.value !== Y_MESSAGE_SYNC) return null;
  const syncType = readVarUint(message, messageType.next);
  if (syncType === null || syncType.value !== Y_SYNC_STEP_1) return null;
  const vectorLength = readVarUint(message, syncType.next);
  if (vectorLength === null) return null;
  const vectorEnd = vectorLength.next + vectorLength.value;
  if (vectorEnd > message.length) return null;
  const entryCount = readVarUint(message, vectorLength.next);
  if (entryCount === null || entryCount.next > vectorEnd) return null;
  return entryCount.value;
}

export function getHeldConnectionMessageDecision(
  message: string | ArrayBuffer | ArrayBufferView
): HeldConnectionMessageDecision {
  // Custom string messages carry no document state.
  if (typeof message === "string") return "wait";

  const bytes =
    message instanceof Uint8Array
      ? message
      : message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);

  const messageType = readVarUint(bytes, 0);
  if (messageType === null) return "reject";
  if (messageType.value === Y_MESSAGE_AWARENESS) return "wait";

  const stateVectorSize = readSyncStep1StateVectorSize(bytes);
  if (stateVectorSize === 0) return "admit";
  return "reject";
}

export function getResetEpochNoticeMessage(resetEpoch: number): string {
  return JSON.stringify({ type: "reset-epoch", resetEpoch });
}
