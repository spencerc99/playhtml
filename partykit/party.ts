import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";
import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import * as Y from "yjs";

// Create a single supabase client for interacting with your database
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_KEY as string,
  { auth: { persistSession: false } }
);

export default class implements Party.Server {
  constructor(public room: Party.Room) {}

  async onMessage(
    message: string | ArrayBuffer | ArrayBufferView,
    sender: Party.Connection<unknown>
  ): Promise<void> {
    if (typeof message === "string") {
      this.room.broadcast(message);
    }
  }

  async onConnect(connection: Party.Connection) {
    const room = this.room;

    await onConnect(connection, this.room, {
      async load() {
        // This is called once per "room" when the first user connects

        // Let's make a Yjs document
        const doc = new Y.Doc();

        // Load the document from the database
        const { data, error } = await supabase
          .from("documents")
          .select("document")
          .eq("name", room.id)
          .maybeSingle();

        if (error) {
          throw new Error(error.message);
        }

        if (data) {
          // If the document exists on the database,
          // apply it to the Yjs document
          Y.applyUpdate(
            doc,
            new Uint8Array(Buffer.from(data.document, "base64"))
          );
        }

        // Return the Yjs document
        return doc;
      },
      callback: {
        handler: async (doc) => {
          // This is called every few seconds if the document has changed

          // convert the Yjs document to a Uint8Array
          const content = Y.encodeStateAsUpdate(doc);

          // Save the document to the database
          const { data: _data, error } = await supabase
            .from("documents")
            .upsert(
              {
                name: room.id,
                document: Buffer.from(content).toString("base64"),
              },
              { onConflict: "name" }
            );

          if (error) {
            console.error("failed to save:", error);
          }
        },
      },
    });
  }
}
