import type * as Party from "partykit/server";
import { onConnect } from "y-partykit";
import { createClient } from "@supabase/supabase-js";
import { Buffer } from "node:buffer";
import * as Y from "yjs";

// Session authentication types
interface SessionChallenge {
  challenge: string;
  domain: string;
  timestamp: number;
  expiresAt: number;
}

interface ValidatedSession {
  sessionId: string;
  publicKey: string;
  domain: string;
  establishedAt: number;
  expiresAt: number;
}

interface SessionAction {
  sessionId: string;
  action: string;
  elementId: string;
  data: any;
  timestamp: number;
  nonce: string;
}

// Create a single supabase client for interacting with your database
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_KEY as string,
  { auth: { persistSession: false } }
);

// Crypto utilities
async function verifySignature(
  message: string,
  signatureBase64: string,
  publicKeyBase64: string,
  algorithm: string = "Ed25519"
): Promise<boolean> {
  try {
    console.log(`[PartyKit] Verifying signature with algorithm: ${algorithm}`);
    console.log(`[PartyKit] Public key length: ${publicKeyBase64.length}`);
    console.log(`[PartyKit] Signature length: ${signatureBase64.length}`);

    const publicKeyBuffer = Buffer.from(publicKeyBase64, "base64");

    const keyAlgorithm =
      algorithm === "RSA-PSS"
        ? { name: "RSA-PSS", hash: "SHA-256" }
        : { name: "Ed25519" };

    const publicKey = await crypto.subtle.importKey(
      "spki",
      publicKeyBuffer,
      keyAlgorithm,
      false,
      ["verify"]
    );

    const messageBuffer = new TextEncoder().encode(message);
    const signatureBuffer = Buffer.from(signatureBase64, "base64");

    const verifyAlgorithm =
      algorithm === "RSA-PSS" ? { name: "RSA-PSS", saltLength: 32 } : "Ed25519";

    const result = await crypto.subtle.verify(
      verifyAlgorithm,
      publicKey,
      signatureBuffer,
      messageBuffer
    );

    console.log(`[PartyKit] Signature verification result: ${result}`);
    return result;
  } catch (error) {
    console.error("Signature verification failed:", error);
    return false;
  }
}

export default class implements Party.Server {
  private validSessions = new Map<string, ValidatedSession>();
  private pendingChallenges = new Map<string, SessionChallenge>();
  private usedNonces = new Set<string>();

  constructor(public room: Party.Room) {
    // Cleanup expired sessions every hour
    setInterval(() => this.cleanupExpiredSessions(), 60 * 60 * 1000);
  }

  // Remove HTTP-based session establishment - using WebSocket instead

  async onMessage(
    message: string | ArrayBuffer | ArrayBufferView,
    sender: Party.Connection<unknown>
  ): Promise<void> {
    try {
      if (typeof message === "string") {
        try {
          const parsed = JSON.parse(message);
          console.log(`[PartyKit] Received message type: ${parsed.type}`);

          if (parsed.type === "session_establish") {
            console.log(
              `[PartyKit] Handling session establishment for ${parsed.publicKey?.slice(
                0,
                8
              )}...`
            );
            await this.handleSessionEstablishmentWS(parsed, sender);
            return; // Don't broadcast session messages
          } else if (parsed.type === "session_action") {
            console.log(
              `[PartyKit] Handling session action: ${parsed.action?.action}`
            );
            await this.handleSessionAction(parsed.action, sender);
            return; // Don't broadcast session actions
          } else {
            // Regular message broadcasting for non-session messages
            this.room.broadcast(message);
          }
        } catch (parseError) {
          console.log(
            `[PartyKit] Non-JSON message or parse error:`,
            parseError
          );
          // Not JSON, broadcast as-is
          try {
            this.room.broadcast(message);
          } catch (broadcastError) {
            console.error(`[PartyKit] Broadcast error:`, broadcastError);
          }
        }
      }
    } catch (error) {
      console.error(`[PartyKit] Message handling error:`, error);
    }
  }

  async onConnect(connection: Party.Connection) {
    const room = this.room;
    console.log(`[PartyKit] New connection established: ${connection.id}`);

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

  // WebSocket-based session establishment
  private async handleSessionEstablishmentWS(
    request: any,
    sender: Party.Connection
  ) {
    try {
      const { challenge, signature, publicKey, algorithm } = request;

      console.log(
        `[PartyKit] Session request - algorithm: ${algorithm}, publicKey: ${publicKey?.slice(
          0,
          16
        )}...`
      );

      // Validate signature first - use algorithm if provided, default to Ed25519
      const isValidSignature = await verifySignature(
        JSON.stringify(challenge),
        signature,
        publicKey,
        algorithm || "Ed25519"
      );

      if (!isValidSignature) {
        sender.send(
          JSON.stringify({
            type: "session_error",
            message: "Invalid signature",
          })
        );
        return;
      }

      // Check if this is a renewal (user already has active session)
      const existingSession = this.findExistingSession(publicKey);

      if (existingSession) {
        // Extend existing session
        existingSession.expiresAt = Date.now() + 24 * 60 * 60 * 1000;

        console.log(`🔄 Renewed session for ${publicKey.slice(0, 8)}...`);

        sender.send(
          JSON.stringify({
            type: "session_renewed",
            sessionId: existingSession.sessionId,
            publicKey: existingSession.publicKey,
            expiresAt: existingSession.expiresAt,
          })
        );
      } else {
        // Create new session
        const session: ValidatedSession = {
          sessionId: crypto.randomUUID(),
          publicKey,
          domain: challenge.domain || "localhost",
          establishedAt: Date.now(),
          expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
        };

        this.validSessions.set(session.sessionId, session);

        console.log(
          `✅ New session established for ${publicKey.slice(0, 8)}...`
        );

        sender.send(
          JSON.stringify({
            type: "session_established",
            sessionId: session.sessionId,
            publicKey: session.publicKey,
            expiresAt: session.expiresAt,
          })
        );
      }
    } catch (error) {
      console.error("Session establishment error:", error);
      sender.send(
        JSON.stringify({
          type: "session_error",
          message: "Session establishment failed",
        })
      );
    }
  }

  private findExistingSession(publicKey: string): ValidatedSession | null {
    for (const session of this.validSessions.values()) {
      if (session.publicKey === publicKey && session.expiresAt > Date.now()) {
        return session;
      }
    }
    return null;
  }

  // Handle session-based actions
  private async handleSessionAction(
    action: SessionAction,
    sender: Party.Connection
  ) {
    try {
      // Validate session exists and is not expired
      const session = this.validSessions.get(action.sessionId);
      if (!session || session.expiresAt < Date.now()) {
        throw new Error("Invalid or expired session");
      }

      // Basic action validation
      if (!this.isValidAction(action)) {
        throw new Error("Invalid action format");
      }

      // Check nonce uniqueness (prevent replay attacks)
      const nonceKey = `${action.sessionId}:${action.nonce}`;
      if (this.usedNonces.has(nonceKey)) {
        throw new Error("Duplicate action detected");
      }

      // Mark action as processed and broadcast validation
      this.usedNonces.add(nonceKey);

      this.room.broadcast(
        JSON.stringify({
          type: "session_action_validated",
          action: {
            elementId: action.elementId,
            action: action.action,
            appliedBy: session.publicKey,
            appliedAt: Date.now(),
          },
        })
      );

      console.log(
        `✅ Session action validated: ${action.action} on ${action.elementId}`
      );

      // Clean up old nonces (5 minute window)
      setTimeout(() => this.usedNonces.delete(nonceKey), 5 * 60 * 1000);
    } catch (error) {
      console.error("Session action error:", error);
      sender.send(
        JSON.stringify({
          type: "action_rejected",
          reason: error.message,
        })
      );
    }
  }

  private isValidAction(action: SessionAction): boolean {
    return !!(
      action.sessionId &&
      action.action &&
      action.elementId &&
      action.timestamp &&
      action.nonce &&
      // Timestamp should be recent (within 5 minutes)
      Date.now() - action.timestamp < 5 * 60 * 1000
    );
  }

  // Cleanup expired sessions
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.validSessions.entries()) {
      if (session.expiresAt < now) {
        this.validSessions.delete(sessionId);
        console.log(`🗑️ Cleaned up expired session: ${sessionId}`);
      }
    }
  }
}
