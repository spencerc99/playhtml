import type { PartyKitServer } from "partykit/server";
import { onConnect } from "y-partykit";

export default {
  async onConnect(ws, room) {
    // Yjs method
    // @ts-ignore
    return onConnect(ws, room, {
      persist: true,
    });
  },
} satisfies PartyKitServer;
