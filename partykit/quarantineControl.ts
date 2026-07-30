// ABOUTME: Lists room quarantine flags from the Worker KV control plane.
// ABOUTME: Keeps global admin reads independent from Durable Object hydration.
import { getAdminAuthError } from "./adminAuth";

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
      ...pageRooms.filter((room): room is QuarantinedRoomEntry => room !== null)
    );

    if (page.list_complete) break;
    cursor = page.cursor;
  } while (cursor);

  return rooms.sort((a, b) => a.roomId.localeCompare(b.roomId));
}

export async function handleQuarantineControlRequest(
  request: Request,
  {
    adminToken,
    quarantineControl,
  }: {
    adminToken: string | undefined;
    quarantineControl: KVNamespace;
  }
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/admin/quarantines") return null;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, OPTIONS" },
    });
  }

  const authError = getAdminAuthError(request, adminToken);
  if (authError) return authError;

  try {
    const rooms = await listQuarantinedRooms(quarantineControl);
    return new Response(
      JSON.stringify({
        available: true,
        count: rooms.length,
        rooms,
      }),
      {
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("[PartyServer] Failed to list quarantined rooms:", error);
    return new Response(
      JSON.stringify({
        available: false,
        error: "Failed to read the quarantine control plane",
      }),
      {
        status: 503,
        headers: {
          "content-type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  }
}
