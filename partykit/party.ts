import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";
import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import * as Y from "yjs";
// No longer using custom cursor manager - cursors now handled via Yjs awareness
// import { CursorManager, type ConnectionWithCursor } from "./cursor-manager";
// import {
//   decodeCursorMessage,
//   cursorClientMessageSchema,
// } from "./cursor-schemas";

// Create a single supabase client for interacting with your database
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_KEY as string,
  { auth: { persistSession: false } }
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Allow-Headers":
    "Origin, X-Requested-With, Content-Type, Accept",
};

export default class PlayHTMLPartyServer implements Party.Server {
  options: Party.ServerOptions = {
    hibernate: true,
  };

  // private cursorManager: CursorManager; // No longer using custom cursor manager

  constructor(public room: Party.Room) {
    // this.cursorManager = new CursorManager(room); // No longer using custom cursor manager
  }

  // Domain verification removed - allow all connections

  async onMessage(
    message: string | ArrayBuffer | ArrayBufferView,
    sender: Party.Connection<unknown>
  ): Promise<void> {
    // All messages are now handled by Yjs, including cursor data via awareness
    // No need for custom cursor message handling
    this.room.broadcast(message);
  }

  // No longer needed - cursor messages are handled via Yjs awareness
  // private looksLikeCursorMessage(message: string | ArrayBuffer | ArrayBufferView): boolean { ... }

  async onConnect(
    connection: Party.Connection,
    { request }: Party.ConnectionContext
  ) {
    const room = this.room;

    // Cursor tracking is now handled via Yjs awareness - no custom setup needed
    // this.cursorManager.onConnect(connection as ConnectionWithCursor, request);

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

  onClose(connection: Party.Connection): void {
    // Cursor cleanup is handled by Yjs awareness automatically
    // this.cursorManager.onClose(connection as ConnectionWithCursor);
  }

  onError(connection: Party.Connection, error: Error): void {
    // Cursor error handling is no longer needed
    // this.cursorManager.onError(connection as ConnectionWithCursor);
  }

  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method === "GET") {
      // Cursor state is now available via Yjs awareness - no custom endpoint needed
      return Response.json({ message: "Cursor data available via Yjs awareness" }, { status: 200, headers: CORS });
    }

    if (req.method === "OPTIONS") {
      return Response.json({ ok: true }, { status: 200, headers: CORS });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}
