// ABOUTME: Lists room quarantine flags from the Worker KV control plane.
// ABOUTME: Keeps global admin reads independent from Durable Object hydration.
const QUARANTINE_KEY_PREFIX = "quarantine:";

export type QuarantinedRoomEntry = {
  roomId: string;
  detail: string;
};

export async function listQuarantinedRooms(
  kv: KVNamespace
): Promise<QuarantinedRoomEntry[]> {
  const rooms: QuarantinedRoomEntry[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list({
      prefix: QUARANTINE_KEY_PREFIX,
      ...(cursor ? { cursor } : {}),
    });
    const pageRooms = await Promise.all(
      page.keys.map(async ({ name }) => {
        const detail = await kv.get(name);
        if (detail === null) return null;

        return {
          roomId: name.slice(QUARANTINE_KEY_PREFIX.length),
          detail,
        };
      })
    );

    rooms.push(
      ...pageRooms.filter(
        (room): room is QuarantinedRoomEntry => room !== null
      )
    );

    if (page.list_complete) break;
    cursor = page.cursor;
  } while (cursor);

  return rooms.sort((a, b) => a.roomId.localeCompare(b.roomId));
}
