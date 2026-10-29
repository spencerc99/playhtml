// ABOUTME: Tests the native messaging bridge to the iPhone app's shared folder.
// ABOUTME: Checks that files cross it whole, in slices, and that builds without it opt out.

import { describe, expect, it } from "vitest";
import {
  SLICE_BYTES,
  base64ToBytes,
  bytesToBase64,
  connectSharedContainer,
  type SendNative,
} from "../sync/sharedContainer";

/** A stand-in for the Swift side: one folder of files, answering the same messages. */
function nativeSide(side: "safari" | "app") {
  const files = new Map<string, { bytes: Uint8Array; modified: number }>();
  const pending = new Map<string, Uint8Array>();
  const sent: Record<string, unknown>[] = [];
  let clock = 0;
  const send: SendNative = async (message) => {
    sent.push(message);
    const name = message.name as string;
    switch (message.wwoShared) {
      case "hello":
        return { ok: true, side };
      case "stat": {
        const file = files.get(name);
        return file
          ? {
              ok: true,
              exists: true,
              size: file.bytes.length,
              modified: file.modified,
            }
          : { ok: true, exists: false };
      }
      case "read": {
        const file = files.get(name)!;
        const offset = message.offset as number;
        const length = message.length as number;
        return {
          ok: true,
          data: bytesToBase64(file.bytes.subarray(offset, offset + length)),
          modified: file.modified,
        };
      }
      case "write": {
        const data = base64ToBytes(message.data as string);
        const before = message.append
          ? (pending.get(name) ?? new Uint8Array())
          : new Uint8Array();
        const joined = new Uint8Array(before.length + data.length);
        joined.set(before);
        joined.set(data, before.length);
        pending.set(name, joined);
        return { ok: true };
      }
      case "commit":
        clock += 1;
        files.set(name, { bytes: pending.get(name)!, modified: clock });
        pending.delete(name);
        return { ok: true };
    }
    return { ok: false, error: "unknown" };
  };
  return { send, files, sent };
}

describe("connectSharedContainer", () => {
  it("is absent where there is no native side", async () => {
    expect(await connectSharedContainer(null)).toBeNull();
    expect(
      await connectSharedContainer(async () => {
        throw new Error("no native host");
      }),
    ).toBeNull();
    expect(await connectSharedContainer(async () => ({ ok: true }))).toBeNull();
  });

  it("writes and reads a file larger than one slice whole", async () => {
    const native = nativeSide("app");
    const container = await connectSharedContainer(native.send);
    expect(container?.side).toBe("app");

    const bytes = new Uint8Array(SLICE_BYTES * 2 + 17);
    for (let at = 0; at < bytes.length; at += 1) bytes[at] = at % 251;
    await container!.write("app.events", bytes);

    const writes = native.sent.filter(
      (message) => message.wwoShared === "write",
    );
    expect(writes.map((message) => message.append)).toEqual([
      false,
      true,
      true,
    ]);
    const read = await container!.read("app.events");
    expect(read?.bytes).toEqual(bytes);
    expect(read?.modified).toBe(1);
  });

  it("writes an empty file", async () => {
    const native = nativeSide("safari");
    const container = await connectSharedContainer(native.send);
    await container!.write("safari.state", new Uint8Array());
    expect((await container!.read("safari.state"))?.bytes.length).toBe(0);
  });

  it("reads nothing for a file the other side has not written", async () => {
    const container = await connectSharedContainer(nativeSide("safari").send);
    expect(await container!.read("app.state")).toBeNull();
  });

  it("refuses names that could leave the folder", async () => {
    const container = await connectSharedContainer(nativeSide("safari").send);
    await expect(container!.read("../secrets")).rejects.toThrow(
      /Not a shared file name/,
    );
  });

  it("drops a read when the file changes partway through", async () => {
    const native = nativeSide("app");
    const container = await connectSharedContainer(native.send);
    await container!.write("app.events", new Uint8Array(SLICE_BYTES + 1));
    const send = native.send;
    let reads = 0;
    const racing = await connectSharedContainer(async (message) => {
      const reply = (await send(message)) as Record<string, unknown>;
      if (message.wwoShared === "read" && ++reads === 2) {
        return { ...reply, modified: 99 };
      }
      return reply;
    });
    await expect(racing!.read("app.events")).rejects.toThrow(/changed/);
  });
});
