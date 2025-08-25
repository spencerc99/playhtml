import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";
import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import * as Y from "yjs";
import { CursorManager, type ConnectionWithCursor } from "./cursor-manager";
import {
  decodeCursorMessage,
  cursorClientMessageSchema,
} from "./cursor-schemas";

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

  private cursorManager: CursorManager;

  constructor(public room: Party.Room) {
    this.cursorManager = new CursorManager(room);
  }

  // Domain verification removed - allow all connections

  async onMessage(
    message: string | ArrayBuffer | ArrayBufferView,
    sender: Party.Connection<unknown>
  ): Promise<void> {
    // Only try cursor message handling if it's a string that looks like JSON with cursor type
    if (
      typeof message === "string" &&
      message.includes('"type":"cursor-update"')
    ) {
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === "cursor-update") {
          this.cursorManager.onMessage(message, sender as ConnectionWithCursor);
          return;
        }
      } catch (error) {
        console.log("Error parsing cursor message:", error);
        // Not a valid cursor message, continue to Yjs handling
      }
    }

    // Handle all other messages (Yjs binary and string messages)
    this.room.broadcast(message);
  }

  async onConnect(
    connection: Party.Connection,
    { request }: Party.ConnectionContext
  ) {
    const room = this.room;

    // Initialize cursor tracking for this connection
    this.cursorManager.onConnect(connection as ConnectionWithCursor, request);

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
    this.cursorManager.onClose(connection as ConnectionWithCursor);
  }

  onError(connection: Party.Connection, error: Error): void {
    this.cursorManager.onError(connection as ConnectionWithCursor);
  }

  async onRequest(req: Party.Request): Promise<Response> {
    if (req.method === "GET") {
      // Return current cursor state for SSR
      const cursors = this.cursorManager.getCursors();
      return Response.json({ cursors }, { status: 200, headers: CORS });
    }

    if (req.method === "OPTIONS") {
      return Response.json({ ok: true }, { status: 200, headers: CORS });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}
