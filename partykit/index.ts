import type { PartyKitServer, Party, Request } from "partykit/server";
import { onConnect } from "y-partykit";

export default {
  async onRequest(req: Request, party: Party) {
    if (req.method === "GET" && new URL(req.url).searchParams.has("dump")) {
      const data = await party.storage.list();
      const items = [...data.entries()].map(([key, value]) => [
        key,
        // @ts-ignore
        [...value],
      ]);
      return new Response(JSON.stringify(items));
    }

    if (req.method === "GET" && new URL(req.url).searchParams.has("boom")) {
      await party.storage.deleteAll();
      return new Response("Destroyed room data");
    }

    return new Response("Not found");
  },
  async onConnect(ws, room) {
    return onConnect(ws, room, {
      persist: {
        mode: "snapshot",
      },
    });
  },
} satisfies PartyKitServer;
