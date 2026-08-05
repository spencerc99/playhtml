// ABOUTME: Shared helpers for driving fake presence PartySockets in tests.
// ABOUTME: Finds sockets by room and parses sent presence protocol messages.

export type FakePresenceSocket = {
  options: Record<string, unknown>;
  sent: string[];
  closed: boolean;
  readyState: number;
  open: () => void;
  receive: (data: unknown) => void;
};

export function getPresenceSockets(): FakePresenceSocket[] {
  return ((globalThis as any).PLAYHTML_TEST_PRESENCE_SOCKETS ??
    []) as FakePresenceSocket[];
}

export function getPresenceSocketForRoom(room: string): FakePresenceSocket {
  const socket = getPresenceSockets().find(
    (candidate) => candidate.options.room === room && !candidate.closed,
  );
  if (!socket) {
    throw new Error(`Expected open presence socket for room ${room}`);
  }
  return socket;
}

export function sentMessages(socket: FakePresenceSocket): any[] {
  return socket.sent.map((message) => JSON.parse(message));
}

export function sentChannelUpdates(
  socket: FakePresenceSocket,
  channel: string,
): any[] {
  return sentMessages(socket)
    .filter(
      (message) =>
        message.type === "presence-update" && message.channel === channel,
    )
    .map((message) => message.value);
}

/** Like sentChannelUpdates but unwraps the page-presence {at, value} staleness
 * envelope back to the user payload, so assertions can ignore the timestamp. */
export function sentPresenceValues(
  socket: FakePresenceSocket,
  channel: string,
): any[] {
  return sentChannelUpdates(socket, channel).map((v) =>
    v && typeof v === "object" && "value" in v && "at" in v ? v.value : v,
  );
}

export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
