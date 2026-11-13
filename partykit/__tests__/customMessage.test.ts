// ABOUTME: Drives PartyServer.onCustomMessage to check which custom messages are relayed.
// ABOUTME: Control messages stay server-side even when their handler throws.
import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

mock.module("cloudflare:workers", () => ({
  DurableObject: class {
    constructor(
      readonly ctx: unknown,
      readonly env: unknown
    ) {}
  },
  env: {
    SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_KEY: "test-supabase-key",
    ADMIN_TOKEN: "test-admin-token",
    PARTYKIT_BRIDGE_SECRET: "test-bridge-secret",
    Main: {},
  },
}));

async function createHarness() {
  const { PartyServer } = await import("../party");
  const broadcasts: string[] = [];
  const sent: Array<{ connection: unknown; message: string }> = [];
  const server = Object.create(PartyServer.prototype, {
    name: { value: "custom-message-room" },
    getSharedPermissions: {
      value: async () => ({ shared: "read-only" }),
      writable: true,
    },
    broadcastCustomMessage: {
      value: (message: string) => broadcasts.push(message),
    },
    sendCustomMessage: {
      value: (connection: unknown, message: string) =>
        sent.push({ connection, message }),
    },
  }) as any;
  return { server, broadcasts, sent };
}

const sender = { id: "conn-1" };

describe("PartyServer custom messages", () => {
  let warnSpy: ReturnType<typeof spyOn> | null = null;

  afterEach(() => {
    warnSpy?.mockRestore();
    warnSpy = null;
  });

  it("relays non-JSON messages unchanged", async () => {
    const { server, broadcasts } = await createHarness();

    await server.onCustomMessage(sender, "not json");

    expect(broadcasts).toEqual(["not json"]);
  });

  it("relays JSON messages that are not control messages", async () => {
    const { server, broadcasts } = await createHarness();
    const app = JSON.stringify({ type: "confetti", count: 3 });

    await server.onCustomMessage(sender, app);
    await server.onCustomMessage(sender, "null");
    await server.onCustomMessage(sender, "42");

    expect(broadcasts).toEqual([app, "null", "42"]);
  });

  it("answers a well-formed export-permissions request only to the sender", async () => {
    const { server, broadcasts, sent } = await createHarness();

    await server.onCustomMessage(
      sender,
      JSON.stringify({ type: "export-permissions", elementIds: ["shared"] })
    );

    expect(broadcasts).toEqual([]);
    expect(sent).toEqual([
      {
        connection: sender,
        message: JSON.stringify({ permissions: { shared: "read-only" } }),
      },
    ]);
  });

  it("does not relay a control message whose handler throws", async () => {
    const { server, broadcasts, sent } = await createHarness();
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    await server.onCustomMessage(
      sender,
      JSON.stringify({ type: "export-permissions" })
    );

    expect(broadcasts).toEqual([]);
    expect(sent).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = String(warnSpy.mock.calls[0]?.[0]);
    expect(logged).toContain(
      "[Bridge] Control message failed for room custom-message-room: type=export-permissions:"
    );
  });
});
