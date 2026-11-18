// ABOUTME: Checks that admin read endpoints report a failed Supabase read as a server error.
// ABOUTME: A failed read must not look like an empty room.
import { describe, expect, it, mock } from "bun:test";

const ADMIN_TOKEN = "test-admin-token";

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
    ADMIN_TOKEN,
    PARTYKIT_BRIDGE_SECRET: "test-bridge-secret",
    Main: {},
  },
}));

const supabaseStub = {
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () => ({
                data: null,
                error: { message: "connection refused" },
              }),
            };
          },
        };
      },
    };
  },
};

mock.module(`${import.meta.dir}/../db.ts`, () => ({ supabase: supabaseStub }));

const { AdminHandler } = await import(`${import.meta.dir}/../admin.ts`);

function createHandler() {
  const context = {
    name: "admin-read-room",
    getSubscribers: async () => [],
    getSharedReferences: async () => [],
    getSharedPermissions: async () => ({}),
    getResetEpoch: async () => 1,
    getConnections: () => [],
    document: null,
    circuitBreaker: {
      getQuarantineStatusBody: async () => ({ quarantined: false }),
      isQuarantined: () => false,
    },
  };
  return new AdminHandler(context as any);
}

function adminGet(route: string): Request {
  return new Request(
    `https://api.playhtml.fun/parties/main/admin-read-room/${route}`,
    { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } }
  );
}

describe("admin read endpoints", () => {
  it("inspect reports a failed document read as a 500 with the message", async () => {
    const response = await createHandler().handleRequest(
      adminGet("admin/inspect")
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to inspect room",
      message: "connection refused",
      roomId: "admin-read-room",
    });
  });

  it("live-compare reports a failed document read as a 500 with the message", async () => {
    const response = await createHandler().handleRequest(
      adminGet("admin/live-compare")
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Failed to compare data methods",
      message: "connection refused",
    });
  });
});
