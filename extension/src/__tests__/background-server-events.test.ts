// ABOUTME: Verifies the background reads shared events from the Worker for content scripts.
// ABOUTME: Covers the signed request, success, a refused request, no identity, and a malformed message.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKER_URL } from "@movement/config";
import { ECDSA_SIGN_ALGORITHM, bytesToHex, hexToBytes } from "../utils/restoreRequest";
import { recentEventsSigningMessage } from "../utils/recentEventsRequest";

const originalDefineBackground = (globalThis as any).defineBackground;

async function generateStoredIdentity() {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    public: {
      publicKey: `pk_${bytesToHex(raw)}`,
      playerStyle: { colorPalette: ["#e04488"] },
    },
    privateKey: await crypto.subtle.exportKey("jwk", pair.privateKey),
  };
}

/** In-memory browser.storage.local, so the background reads what the test stored. */
function memoryStorage(initial: Record<string, unknown>) {
  const data: Record<string, unknown> = { ...initial };
  return {
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (keys === null || keys === undefined) return { ...data };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, data[k]]));
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    }),
  };
}

async function loadBackgroundListener(storage: Record<string, unknown> = {}) {
  const onMessageAddListener = vi.fn();
  vi.doMock("../storage/LocalEventStore", () => ({
    LocalEventStore: vi.fn(() => ({
      getPendingEvents: vi.fn(),
      markEventsAsUploaded: vi.fn(),
      addEvents: vi.fn(),
      getGlobalStats: vi.fn(),
      getAllDomains: vi.fn(),
      getAllEvents: vi.fn(),
    })),
  }));
  vi.doMock("../storage/sync", () => ({ uploadEvents: vi.fn() }));
  vi.doMock("../storage/restore", () => ({ restoreEventsFromServer: vi.fn() }));
  vi.doMock("webextension-polyfill", () => ({
    default: {
      storage: { local: memoryStorage(storage) },
      runtime: {
        onInstalled: { addListener: vi.fn() },
        onMessage: { addListener: onMessageAddListener },
        getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
      },
      tabs: { create: vi.fn().mockResolvedValue(undefined) },
      alarms: {
        get: vi.fn().mockResolvedValue(undefined),
        create: vi.fn(),
        onAlarm: { addListener: vi.fn() },
      },
    },
  }));
  (globalThis as any).defineBackground = (setup: () => void) => {
    setup();
    return setup;
  };

  await import("../entrypoints/background");
  const listener = onMessageAddListener.mock.calls[0][0];
  return (message: unknown) =>
    new Promise((resolve) => {
      const async = listener(message, {}, resolve);
      if (async !== true) resolve(undefined);
    });
}

describe("background shared-event reads", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalDefineBackground === undefined) {
      delete (globalThis as any).defineBackground;
    } else {
      (globalThis as any).defineBackground = originalDefineBackground;
    }
  });

  it("fetches one type of recent events with a signature the identity key verifies", async () => {
    const identity = await generateStoredIdentity();
    const events = [{ id: "e1", type: "cursor", ts: 1, data: {}, meta: {} }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      String(input).startsWith(`${WORKER_URL}/events/recent`)
        ? new Response(JSON.stringify(events), { status: 200 })
        : new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const send = await loadBackgroundListener({ playerIdentity: identity });

    const before = Date.now();
    const reply = await send({
      type: "FETCH_SERVER_EVENTS",
      domain: "example.com",
      eventType: "cursor",
      limit: 5000,
    });

    expect(reply).toEqual({ ok: true, events });
    const call = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith(`${WORKER_URL}/events/recent`),
    );
    expect(call?.[0]).toBe(
      `${WORKER_URL}/events/recent?type=cursor&limit=5000&domain=example.com`,
    );
    const headers = new Headers(call?.[1]?.headers);
    const publicId = headers.get("X-WWO-Public-Id");
    const signedAt = Number(headers.get("X-WWO-Signed-At"));
    const signature = headers.get("X-WWO-Signature");
    expect(publicId).toBe(identity.public.publicKey);
    expect(signedAt).toBeGreaterThanOrEqual(before);
    expect(signedAt).toBeLessThanOrEqual(Date.now());
    expect(signature).toMatch(/^[0-9a-f]{128}$/);

    const verifyKey = await crypto.subtle.importKey(
      "raw",
      hexToBytes(identity.public.publicKey.slice("pk_".length)),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const verified = await crypto.subtle.verify(
      ECDSA_SIGN_ALGORITHM,
      verifyKey,
      hexToBytes(signature!),
      new TextEncoder().encode(recentEventsSigningMessage({ publicId: publicId!, signedAt })),
    );
    expect(verified).toBe(true);
  });

  it("sends nothing and replies with an error when there is no identity yet", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) => new Response("[]", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const send = await loadBackgroundListener();

    const reply = await send({
      type: "FETCH_SERVER_EVENTS",
      domain: "example.com",
      eventType: "cursor",
      limit: 10,
    });

    expect(reply).toEqual({
      ok: false,
      error: "Could not load shared trails: this browser has no identity yet",
    });
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("/events/recent")),
    ).toBe(false);
  });

  it("replies with an error when the worker refuses the request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).startsWith(`${WORKER_URL}/events/recent`)
          ? new Response("Forbidden", { status: 403 })
          : new Response("{}", { status: 200 }),
      ),
    );
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = await loadBackgroundListener({
      playerIdentity: await generateStoredIdentity(),
    });

    const reply = await send({
      type: "FETCH_SERVER_EVENTS",
      domain: "example.com",
      eventType: "cursor",
      limit: 10,
    });

    expect(reply).toEqual({
      ok: false,
      error: "Could not load shared trails (server error 403)",
    });
    expect(
      error.mock.calls.some((call) =>
        String(call[0]).includes("[HistoryLoader] Server fetch failed for cursor: 403"),
      ),
    ).toBe(true);
  });

  it("rejects a message without a valid event type", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const send = await loadBackgroundListener();

    const reply = await send({
      type: "FETCH_SERVER_EVENTS",
      domain: "example.com",
      eventType: "not-a-type",
      limit: 10,
    });

    expect(reply).toEqual({
      ok: false,
      error: "Could not load shared trails: bad request",
    });
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes("/events/recent")),
    ).toBe(false);
  });
});
