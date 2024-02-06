import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";

export default class PlayServer implements Party.Server {
  constructor(public room: Party.Room) {}
  async onRequest(req: Party.Request) {
    const parsedUrl = new URL(req.url);
    if (req.method === "GET" && parsedUrl.searchParams.has("dump")) {
      const data = await this.room.storage.list();
      const items = [...data.entries()].map(([key, value]) => [
        key,
        // @ts-ignore
        [...value],
      ]);
      return new Response(JSON.stringify(items));
    }

    if (req.method === "GET" && parsedUrl.searchParams.has("boom")) {
      await this.room.storage.deleteAll();
      return new Response("Destroyed room data");
    }

    return new Response("Not found");
  }

  onMessage(
    message: string | ArrayBuffer | ArrayBufferView,
    sender: Party.Connection<unknown>
  ): void | Promise<void> {
    this.room.broadcast(message);
  }
  async onConnect(ws: Party.Connection<unknown>) {
    // optionally look for events here to filter out valid ones?
    return await onConnect(ws, this.room, {
      persist: {
        mode: "snapshot",
      },
    });
  }
}

PlayServer satisfies Party.Worker;
