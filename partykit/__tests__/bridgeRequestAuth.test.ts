// ABOUTME: Verifies authentication for PartyServer room-to-room HTTP bridge requests.
// ABOUTME: Prevents public subscribe and apply requests from mutating shared room state.
import { describe, expect, it, mock } from "bun:test";
import { docToJson, jsonToDoc } from "../docUtils";
import {
  BRIDGE_SECRET_HEADER,
  createBridgeRequest,
  getBridgeAuthFailure,
} from "../bridgeAuth";

const BRIDGE_SECRET = "test-bridge-secret";

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
    PARTYKIT_BRIDGE_SECRET: BRIDGE_SECRET,
    Main: {},
  },
}));

type BridgeAction =
  | {
      action: "subscribe";
      consumerRoomId: string;
      elementIds: string[];
    }
  | {
      action: "export-permissions";
      elementIds: string[];
    }
  | {
      action: "apply-subtrees-immediate";
      subtrees: Record<string, Record<string, unknown>>;
      sender: string;
      originKind: "consumer" | "source";
      resetEpoch: number | null;
    };

function bridgeRequest(
  body: BridgeAction,
  credential?: string
): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (credential !== undefined) {
    headers.set(BRIDGE_SECRET_HEADER, credential);
  }
  return new Request(
    "https://api.playhtml.fun/parties/main/source-room/bridge",
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }
  );
}

async function createPartyServerHarness() {
  const { PartyServer } = await import("../party");
  let subscribers: Array<{
    consumerRoomId: string;
    elementIds: string[];
    consumerResetEpoch?: number | null;
    createdAt: string;
    lastSeen: string;
    leaseMs: number;
  }> = [];
  let sharedReferences: Array<{
    sourceRoomId: string;
    elementIds: string[];
    lastSeen: string;
  }> = [];
  const document = jsonToDoc({
    "can-toggle": {
      shared: { active: false },
    },
  });
  const server = Object.create(PartyServer.prototype) as any;
  Object.defineProperties(server, {
    name: { value: "source-room" },
    document: { value: document },
  });
  Object.assign(server, {
    persistenceMode: { kind: "available" },
    bridgeHealth: { reset() {} },
    getSubscribers: async () => subscribers,
    setSubscribers: async (nextSubscribers: typeof subscribers) => {
      subscribers = structuredClone(nextSubscribers);
    },
    getSharedReferences: async () => sharedReferences,
    setSharedReferences: async (nextReferences: typeof sharedReferences) => {
      sharedReferences = structuredClone(nextReferences);
    },
    getSharedPermissions: async () => ({ shared: "read-write" }),
    getResetEpoch: async () => null,
    sendBridgeApply: async () => {},
  });

  return {
    server,
    document,
    getSubscribers: () => subscribers,
    getSharedReferences: () => sharedReferences,
  };
}

const subscribeAction: BridgeAction = {
  action: "subscribe",
  consumerRoomId: "attacker-room",
  elementIds: ["shared"],
};

const exportPermissionsAction: BridgeAction = {
  action: "export-permissions",
  elementIds: ["shared"],
};

const applyAction: BridgeAction = {
  action: "apply-subtrees-immediate",
  subtrees: {
    "can-toggle": {
      shared: { active: true },
    },
  },
  sender: "attacker-room",
  originKind: "consumer",
  resetEpoch: null,
};

describe("PartyServer bridge request authentication", () => {
  it("fails closed when the deployment credential is not configured", () => {
    const request = bridgeRequest(subscribeAction, BRIDGE_SECRET);

    expect(getBridgeAuthFailure(request, undefined)?.status).toBe(503);
    expect(() => createBridgeRequest("/subscribe", subscribeAction, undefined)).toThrow(
      "PARTYKIT_BRIDGE_SECRET is not configured"
    );
  });

  it("attaches the configured credential to internal bridge requests", async () => {
    for (const [path, action] of [
      ["/subscribe", subscribeAction],
      ["/apply", applyAction],
    ] as const) {
      const request = createBridgeRequest(path, action, BRIDGE_SECRET);

      expect(request.headers.get(BRIDGE_SECRET_HEADER)).toBe(BRIDGE_SECRET);
      expect(await request.json()).toEqual(action);
    }
  });

  it("rejects every bridge action when the credential is missing", async () => {
    const { server } = await createPartyServerHarness();

    for (const action of [
      subscribeAction,
      exportPermissionsAction,
      applyAction,
    ]) {
      const response = await server.onRequest(bridgeRequest(action));
      expect(response.status).toBe(401);
    }
  });

  it("rejects every bridge action when the credential is wrong", async () => {
    const { server, document, getSubscribers, getSharedReferences } =
      await createPartyServerHarness();

    for (const action of [
      subscribeAction,
      exportPermissionsAction,
      applyAction,
    ]) {
      const response = await server.onRequest(
        bridgeRequest(action, "wrong-bridge-secret")
      );
      expect(response.status).toBe(403);
    }

    expect(getSubscribers()).toEqual([]);
    expect(getSharedReferences()).toEqual([]);
    expect(docToJson(document)?.["can-toggle"]?.shared).toEqual({
      active: false,
    });
  });

  it("allows legitimate bridge actions with the configured credential", async () => {
    const { server, document, getSubscribers } =
      await createPartyServerHarness();

    const subscribeResponse = await server.onRequest(
      bridgeRequest(subscribeAction, BRIDGE_SECRET)
    );
    const permissionsResponse = await server.onRequest(
      bridgeRequest(exportPermissionsAction, BRIDGE_SECRET)
    );
    const applyResponse = await server.onRequest(
      bridgeRequest(applyAction, BRIDGE_SECRET)
    );

    expect(subscribeResponse.status).toBe(200);
    expect(permissionsResponse.status).toBe(200);
    expect(applyResponse.status).toBe(200);
    expect(getSubscribers()).toHaveLength(1);
    expect(docToJson(document)?.["can-toggle"]?.shared).toEqual({
      active: true,
    });
  });

  it("blocks the public subscribe-then-apply exploit without mutating room state", async () => {
    const { server, document, getSubscribers, getSharedReferences } =
      await createPartyServerHarness();

    const subscribeResponse = await server.onRequest(
      bridgeRequest(subscribeAction)
    );
    const applyResponse = await server.onRequest(bridgeRequest(applyAction));

    expect(subscribeResponse.status).toBe(401);
    expect(applyResponse.status).toBe(401);
    expect(getSubscribers()).toEqual([]);
    expect(getSharedReferences()).toEqual([]);
    expect(docToJson(document)?.["can-toggle"]?.shared).toEqual({
      active: false,
    });
  });
});
