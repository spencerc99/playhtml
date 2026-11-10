// ABOUTME: Talks to the iPhone app's shared App Group folder through native messaging.
// ABOUTME: Reads and writes whole files in slices, so large history files fit through the bridge.

import browser from "webextension-polyfill";

/** Which copy of the extension this is: Safari's, or the one inside the app. */
export type SyncSide = "safari" | "app";

/** The bundle id native messaging addresses; Safari and the app both route by it. */
export const NATIVE_APPLICATION_ID = "online.wewere.app";

/** Raw bytes per message. A multiple of 3, so each slice is whole base64. */
export const SLICE_BYTES = 384 * 1024;

const FILE_NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;

type NativeReply = Record<string, unknown>;
export type SendNative = (message: Record<string, unknown>) => Promise<unknown>;

export interface SharedFile {
  bytes: Uint8Array;
  /** When the file was last written, in milliseconds since the epoch. */
  modified: number;
}

export interface SharedContainer {
  side: SyncSide;
  stat(name: string): Promise<{ size: number; modified: number } | null>;
  read(name: string): Promise<SharedFile | null>;
  write(name: string, bytes: Uint8Array): Promise<void>;
}

export function bytesToBase64(bytes: Uint8Array): string {
  // Built in slices, because spreading megabytes into one call overflows the
  // argument limit.
  const SLICE = 0x8000;
  let binary = "";
  for (let at = 0; at < bytes.length; at += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(at, at + SLICE));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) {
    bytes[at] = binary.charCodeAt(at);
  }
  return bytes;
}

function defaultSend(): SendNative | null {
  const runtime = browser.runtime as typeof browser.runtime & {
    sendNativeMessage?: (
      application: string,
      message: unknown,
    ) => Promise<unknown>;
  };
  if (typeof runtime.sendNativeMessage !== "function") return null;
  return (message) =>
    runtime.sendNativeMessage!(NATIVE_APPLICATION_ID, message);
}

function checkName(name: string): void {
  if (!FILE_NAME.test(name)) throw new Error(`Not a shared file name: ${name}`);
}

async function call(
  send: SendNative,
  message: NativeReply,
): Promise<NativeReply> {
  const reply = await send(message);
  if (!reply || typeof reply !== "object") {
    throw new Error("The shared folder gave no answer");
  }
  const body = reply as NativeReply;
  if (body.ok !== true) {
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : "The shared folder refused the request",
    );
  }
  return body;
}

/**
 * Opens the shared folder, or returns null where there is none: Chrome,
 * Firefox, Safari on the Mac, and any iPhone build whose native side does not
 * answer. Those builds keep their data to themselves, as before.
 */
export async function connectSharedContainer(
  send: SendNative | null = defaultSend(),
): Promise<SharedContainer | null> {
  if (!send) return null;
  let side: SyncSide;
  try {
    const hello = await call(send, { wwoShared: "hello" });
    if (hello.side !== "safari" && hello.side !== "app") return null;
    side = hello.side;
  } catch {
    return null;
  }

  async function stat(name: string) {
    checkName(name);
    const reply = await call(send!, { wwoShared: "stat", name });
    if (reply.exists !== true) return null;
    return { size: Number(reply.size), modified: Number(reply.modified) };
  }

  return {
    side,
    stat,
    async read(name) {
      const info = await stat(name);
      if (!info) return null;
      const bytes = new Uint8Array(info.size);
      for (let offset = 0; offset < info.size; offset += SLICE_BYTES) {
        const reply = await call(send!, {
          wwoShared: "read",
          name,
          offset,
          length: SLICE_BYTES,
        });
        // The file can change between slices if the other side writes it;
        // the whole read is dropped and tried again on the next pass.
        if (Number(reply.modified) !== info.modified) {
          throw new Error(`${name} changed while it was being read`);
        }
        const slice = base64ToBytes(String(reply.data ?? ""));
        bytes.set(slice.subarray(0, info.size - offset), offset);
      }
      return { bytes, modified: info.modified };
    },
    async write(name, bytes) {
      checkName(name);
      // Slices go to a side file that replaces the real one in one step at the
      // end, so the other side never reads half a file.
      for (
        let offset = 0;
        offset < bytes.length || offset === 0;
        offset += SLICE_BYTES
      ) {
        await call(send!, {
          wwoShared: "write",
          name,
          append: offset > 0,
          data: bytesToBase64(bytes.subarray(offset, offset + SLICE_BYTES)),
        });
        if (bytes.length === 0) break;
      }
      await call(send!, { wwoShared: "commit", name });
    },
  };
}
