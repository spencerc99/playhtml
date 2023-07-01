/// <reference no-default-lib="true"/>
/// <reference types="@cloudflare/workers-types" />

import type { PartyKitServer } from "partykit/server";
import { onConnect } from "y-partykit";
import { Message, MessageType } from "./types";

export default {
  async onConnect(ws, room) {
    const existingItems = await room.storage.list();
    console.log("items", existingItems);
    for (const item of existingItems) {
      console.log("sending", item[1]);
      ws.send(JSON.stringify(item[1] as Message));
    }

    async function handleMessage(evt: Message) {
      console.log("handleMessage", JSON.stringify(evt, null, 2));
      try {
        switch (evt.type) {
          case MessageType.Position: {
            const { id, x, y } = evt;
            await room.storage.put(`id-${MessageType.Position}`, {
              id,
              x,
              y,
              type: MessageType.Position,
            });
          }
        }
      } catch (err) {
        console.error(err);
      }
    }

    ws.addEventListener("message", (evt) => {
      console.log("message", evt);
      try {
        handleMessage(JSON.parse(evt.data) as Message);
      } catch (err) {
        console.error(err);
      }
    });

    return;

    // Yjs method
    // return onConnect(ws, room, { persist: true });
  },
} satisfies PartyKitServer;
