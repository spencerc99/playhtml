import type { PartyKitServer, Party, Request } from "partykit/server";
import { onConnect } from "y-partykit";

export default {
  async onRequest(req: Request, party: Party) {
    const parsedUrl = new URL(req.url);
    if (req.method === "GET" && parsedUrl.searchParams.has("dump")) {
      const data = await party.storage.list();
      const items = [...data.entries()].map(([key, value]) => [
        key,
        // @ts-ignore
        [...value],
      ]);
      return new Response(JSON.stringify(items));
    }

    if (req.method === "GET" && parsedUrl.searchParams.has("boom")) {
      await party.storage.deleteAll();
      return new Response("Destroyed room data");
    }

    return new Response("Not found");
  },
  async onMessage(message, _conn, room) {
    if (typeof message === "string") {
      console.log("message", message);
    }
    room.broadcast(message);
  },
  async onConnect(ws, room) {
    // optionally look for events here to filter out valid ones?
    return onConnect(ws, room, {
      persist: {
        mode: "snapshot",
      },
    });
  },
} satisfies PartyKitServer;
