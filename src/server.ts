/// <reference types="@cloudflare/workers-types" />

import type { PartyKitServer } from "partykit/server";
import { onConnect } from "y-partykit";

export default {
  async onConnect(ws, room) {
    // Yjs method
    return onConnect(ws, room, { persist: true });
  },
} satisfies PartyKitServer;
