// ABOUTME: Exercises authentication and relationship checks through PartyServer bridge routing.
// ABOUTME: Verifies rejected requests leave live documents and bridge metadata untouched.
import { describe, expect, it, mock } from "bun:test";
import {
  docToJson,
  encodeDocToBase64,
  jsonToDoc,
  replaceDocFromSnapshot,
} from "../docUtils";
import { BRIDGE_SECRET_HEADER } from "../bridgeAuth";

const SECRET = "test-bridge-secret";

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
    PARTYKIT_BRIDGE_SECRET: SECRET,
    Main: {},
  },
}));

type ApplyAction = {
  action: "apply-subtrees-immediate";
  subtrees: Record<string, Record<string, unknown>>;
  sender: string;
  originKind: "consumer" | "source";
  resetEpoch: null;
};

function bridgeRequest(body: ApplyAction, credential?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (credential !== undefined) {
    headers.set(BRIDGE_SECRET_HEADER, credential);
  }
  return new Request("https://api.playhtml.fun/parties/main/source-room", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

async function createHarness() {
  const { PartyServer } = await import("../party");
  const document = jsonToDoc({
    "can-toggle": { shared: { active: false } },
  });
  const server = Object.create(PartyServer.prototype, {
    name: { value: "source-room" },
    document: { value: document },
    persistenceMode: { value: { kind: "available" }, writable: true },
    documentLoadCompleted: { value: true, writable: true },
    documentWriteState: { value: { kind: "idle" }, writable: true },
    documentWriteTail: { value: Promise.resolve(), writable: true },
    realtimeSyncStarted: { value: true, writable: true },
    isSkippingSave: { value: false, writable: true },
    circuitBreaker: {
      value: {
        getLoadDeferredResponse: async () => null,
        isQuarantined: () => false,
      },
      writable: true,
    },
    bridgeHealth: { value: { reset() {} }, writable: true },
    getSubscribers: { value: async () => [], writable: true },
    getSharedReferences: { value: async () => [], writable: true },
    getResetEpoch: { value: async () => 42, writable: true },
  }) as any;
  return { server, document };
}

const applyAction: ApplyAction = {
  action: "apply-subtrees-immediate",
  subtrees: { "can-toggle": { shared: { active: true } } },
  sender: "unrelated-room",
  originKind: "consumer",
  resetEpoch: null,
};

describe("PartyServer bridge request protection", () => {
  it("rejects an unauthenticated mutation before touching the document", async () => {
    const { server, document } = await createHarness();

    const response = await server.onRequest(bridgeRequest(applyAction));

    expect(response.status).toBe(401);
    expect(docToJson(document)?.["can-toggle"]?.shared).toEqual({
      active: false,
    });
  });

  it("rejects an authenticated mutation from an unrelated room", async () => {
    const { server, document } = await createHarness();

    const response = await server.onRequest(
      bridgeRequest(applyAction, SECRET)
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: "bridge_relationship_not_found",
    });
    expect(docToJson(document)?.["can-toggle"]?.shared).toEqual({
      active: false,
    });
  });

  it("allows a registered source to update only its subscribed subtree", async () => {
    const { server, document } = await createHarness();
    Object.defineProperty(server, "getSharedReferences", {
      value: async () => [
        {
          sourceRoomId: "registered-source",
          elementIds: ["shared"],
          sourceResetEpoch: 42,
        },
      ],
    });

    const response = await server.onRequest(
      bridgeRequest(
        {
          ...applyAction,
          sender: "registered-source",
          originKind: "source",
          resetEpoch: 42,
        },
        SECRET
      )
    );

    expect(response.status).toBe(200);
    expect(docToJson(document)?.["can-toggle"]?.shared).toEqual({
      active: true,
    });
  });

  it("serializes a bridge apply behind an in-flight document replacement", async () => {
    const { server, document } = await createHarness();
    Object.defineProperty(server, "getSharedReferences", {
      value: async () => [
        {
          sourceRoomId: "registered-source",
          elementIds: ["shared"],
          sourceResetEpoch: 42,
        },
      ],
    });
    let releaseReplacement = () => {};
    const replacementGate = new Promise<void>((resolve) => {
      releaseReplacement = resolve;
    });
    const replacement = jsonToDoc({
      "can-toggle": { shared: { active: false } },
      "can-play": { preserved: { value: "replacement" } },
    });
    const replacementBase64 = encodeDocToBase64(replacement);
    replacement.destroy();
    server.documentWriteState = { kind: "reset", resetEpoch: 43 };
    server.documentWriteTail = replacementGate.then(() => {
      replaceDocFromSnapshot(document, replacementBase64);
      server.documentWriteState = { kind: "idle" };
    });
    let reachedWriteQueue = () => {};
    const writeQueued = new Promise<void>((resolve) => {
      reachedWriteQueue = resolve;
    });
    const runDocumentWrite = server.runDocumentWrite.bind(server);
    Object.defineProperty(server, "runDocumentWrite", {
      value: (work: () => Promise<unknown>) => {
        reachedWriteQueue();
        return runDocumentWrite(work);
      },
    });

    const responsePromise = server.onRequest(
      bridgeRequest(
        {
          ...applyAction,
          sender: "registered-source",
          originKind: "source",
          resetEpoch: 42,
        },
        SECRET
      )
    );
    const admission = await Promise.race([
      writeQueued.then(() => "queued" as const),
      responsePromise.then(() => "responded" as const),
    ]);

    expect(admission).toBe("queued");
    expect(docToJson(document)?.["can-toggle"]?.shared).toEqual({
      active: false,
    });

    releaseReplacement();
    const response = await responsePromise;

    expect(response.status).toBe(200);
    expect(docToJson(document)?.["can-toggle"]?.shared).toEqual({
      active: true,
    });
    expect(docToJson(document)?.["can-play"]?.preserved).toEqual({
      value: "replacement",
    });
  });
});
