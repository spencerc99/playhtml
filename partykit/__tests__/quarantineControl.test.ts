// ABOUTME: Verifies pagination and filtering for the global quarantine index.
// ABOUTME: Ensures the admin list reports every current KV-backed room once.
import { describe, expect, test } from "bun:test";
import { listQuarantinedRooms } from "../quarantineControl";

describe("listQuarantinedRooms", () => {
  test("reads every page and ignores keys deleted during the listing", async () => {
    const values = new Map([
      ["quarantine:room-b", "automatic alarm failures"],
      ["quarantine:room-a", "operator stop"],
    ]);
    const kv = {
      async list({ cursor }: { cursor?: string }) {
        if (!cursor) {
          return {
            keys: [
              { name: "quarantine:room-b" },
              { name: "quarantine:deleted-room" },
            ],
            list_complete: false as const,
            cursor: "next",
            cacheStatus: null,
          };
        }

        return {
          keys: [{ name: "quarantine:room-a" }],
          list_complete: true as const,
          cacheStatus: null,
        };
      },
      async get(key: string) {
        return values.get(key) ?? null;
      },
    } as unknown as KVNamespace;

    await expect(listQuarantinedRooms(kv)).resolves.toEqual([
      { roomId: "room-a", detail: "operator stop" },
      { roomId: "room-b", detail: "automatic alarm failures" },
    ]);
  });
});
