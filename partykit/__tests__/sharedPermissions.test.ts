// ABOUTME: Drives PartyServer connect, register, and bridge-apply paths for shared permissions.
// ABOUTME: Verifies parsing, malformed declarations, own-entry reads, the entry cap, and overlapping writes.
import { describe, expect, it, mock } from "bun:test";
import * as awarenessProtocol from "y-protocols/awareness";
import { docToJson, jsonToDoc } from "../docUtils";
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

type PermissionMap = Record<string, "read-only" | "read-write">;

class FakeStorage {
  values = new Map<string, unknown>();
  puts: string[] = [];
  // When set, reads wait on it, so overlapping writers can be lined up.
  readGate: Promise<void> | null = null;
  gatedReads = 0;
  onGatedRead: (() => void) | null = null;
  async get(key: string) {
    const value = this.values.get(key);
    if (this.readGate) {
      this.gatedReads += 1;
      this.onGatedRead?.();
      await this.readGate;
    }
    return value;
  }
  async put(key: string, value: unknown) {
    this.puts.push(key);
    this.values.set(key, value);
  }
  async delete(key: string) {
    this.values.delete(key);
  }
  async getAlarm() {
    return null;
  }
  async setAlarm() {}
  async deleteAlarm() {}
}

async function createSourceRoom(storedPermissions?: PermissionMap) {
  const { PartyServer } = await import("../party");
  const storage = new FakeStorage();
  if (storedPermissions) {
    storage.values.set("sharedPermissions", storedPermissions);
  }
  const document = jsonToDoc({
    "can-toggle": {
      open: { active: false },
      locked: { active: false },
      constructor: { active: false },
    },
  }) as any;
  document.awareness = new awarenessProtocol.Awareness(document);
  const room = Object.create(PartyServer.prototype, {
    ctx: { value: { storage }, writable: true },
    name: { value: "source-room" },
    document: { value: document },
    persistenceMode: { value: { kind: "available" }, writable: true },
    documentLoadCompleted: { value: true, writable: true },
    documentMaintenanceInProgress: { value: false, writable: true },
    documentWriteTail: { value: Promise.resolve(), writable: true },
    realtimeSyncStarted: { value: true, writable: true },
    cachedSubscribers: { value: null, writable: true },
    cachedSharedRefs: { value: null, writable: true },
    cachedSharedPerms: { value: null, writable: true },
    pendingBridgeChanges: { value: new Set(), writable: true },
    circuitBreaker: {
      value: {
        getLoadDeferredResponse: async () => null,
        getClientLoadDeferredResponse: async () => null,
        isQuarantined: () => false,
      },
      writable: true,
    },
    bridgeHealth: { value: { reset() {} }, writable: true },
    getConnections: { value: () => [], writable: true },
    getResetEpoch: { value: async () => null, writable: true },
    clearEmptyRoomCompactAfter: { value: async () => {}, writable: true },
    scheduleNextAlarm: { value: async () => {}, writable: true },
    waitForEmptyRoomCompaction: { value: async () => {}, writable: true },
    getSubscribers: {
      value: async () => [
        {
          consumerRoomId: "consumer-room",
          elementIds: ["open", "locked", "constructor"],
          createdAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        },
      ],
      writable: true,
    },
    getSharedReferences: { value: async () => [], writable: true },
  }) as any;
  return {
    room,
    storage,
    document,
    storedPermissions: () =>
      storage.values.get("sharedPermissions") as PermissionMap | undefined,
    destroy: () => document.awareness.destroy(),
  };
}

async function connectSource(
  room: any,
  sharedElements: Array<{ elementId: string; permissions?: string }>
): Promise<void> {
  const params = new URLSearchParams({
    sharedElements: JSON.stringify(sharedElements),
  });
  await room.onConnect(
    { id: crypto.randomUUID(), send: () => {}, setState: () => {}, state: {} },
    {
      request: new Request(
        `https://example.com/parties/main/source-room?${params.toString()}`
      ),
    }
  );
}

async function registerSharedElement(
  room: any,
  element: { elementId: string; permissions?: string }
): Promise<void> {
  await room.onCustomMessage(
    { send: () => {} },
    JSON.stringify({ type: "register-shared-element", element })
  );
}

// A consumer write that touches both elements in one request, so a passing
// rejection of one element always comes with proof the other was applied.
async function applyConsumerWrite(room: any): Promise<Response> {
  return room.onRequest(
    new Request("https://example.com/parties/main/source-room", {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        [BRIDGE_SECRET_HEADER]: SECRET,
      }),
      body: JSON.stringify({
        action: "apply-subtrees-immediate",
        subtrees: {
          "can-toggle": {
            open: { active: true },
            locked: { active: true },
            constructor: { active: true },
          },
        },
        sender: "consumer-room",
        originKind: "consumer",
        resetEpoch: null,
      }),
    })
  );
}

// Only `open` should accept consumer writes in these tests.
function toggles(document: any) {
  return docToJson(document)?.["can-toggle"];
}

const OPEN_WRITTEN_ONLY = {
  open: { active: true },
  locked: { active: false },
  constructor: { active: false },
};

async function exportPermissions(
  room: any,
  elementIds: string[]
): Promise<Record<string, string>> {
  const response = await room.onRequest(
    new Request("https://example.com/parties/main/source-room", {
      method: "POST",
      headers: new Headers({
        "content-type": "application/json",
        [BRIDGE_SECRET_HEADER]: SECRET,
      }),
      body: JSON.stringify({ action: "export-permissions", elementIds }),
    })
  );
  return (await response.json()).permissions;
}

async function captureWarnings<T>(
  work: () => Promise<T>
): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message: unknown) => warnings.push(String(message));
  try {
    return { result: await work(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

describe("shared element permissions on the source room", () => {
  it("replaces the stored map with the connecting page's declaration", async () => {
    const source = await createSourceRoom({
      open: "read-only",
      locked: "read-write",
      removed: "read-write",
    });

    await connectSource(source.room, [
      { elementId: "open", permissions: "read-write" },
      { elementId: "locked", permissions: "read-only" },
    ]);

    expect(source.storedPermissions()).toEqual({
      open: "read-write",
      locked: "read-only",
    });
    expect((await applyConsumerWrite(source.room)).status).toBe(200);
    expect(toggles(source.document)).toEqual(OPEN_WRITTEN_ONLY);
    source.destroy();
  });

  it("sets only the registered element's entry", async () => {
    const source = await createSourceRoom({
      open: "read-only",
      locked: "read-write",
    });

    await registerSharedElement(source.room, {
      elementId: "open",
      permissions: "read-write",
    });

    expect(source.storedPermissions()).toEqual({
      open: "read-write",
      locked: "read-write",
    });
    source.destroy();
  });

  for (const declared of ["ro", "read-only", "RO"]) {
    it(`treats "${declared}" as read-only on connect and register`, async () => {
      const connected = await createSourceRoom();
      await connectSource(connected.room, [
        { elementId: "open", permissions: "read-write" },
        { elementId: "locked", permissions: declared },
      ]);
      const registered = await createSourceRoom({ open: "read-write" });
      await registerSharedElement(registered.room, {
        elementId: "locked",
        permissions: declared,
      });

      for (const source of [connected, registered]) {
        expect(source.storedPermissions()).toEqual({
          open: "read-write",
          locked: "read-only",
        });
        expect((await applyConsumerWrite(source.room)).status).toBe(200);
        expect(toggles(source.document)).toEqual(OPEN_WRITTEN_ONLY);
        source.destroy();
      }
    });
  }

  it("skips malformed declarations instead of failing the connect", async () => {
    const source = await createSourceRoom();

    await connectSource(source.room, [
      null as any,
      "locked" as any,
      { permissions: "read-write" } as any,
      { elementId: "", permissions: "read-write" },
      { elementId: "__proto__", permissions: "read-write" },
      { elementId: "open", permissions: "read-write" },
    ]);
    await registerSharedElement(source.room, {
      elementId: "__proto__",
      permissions: "read-write",
    });

    expect(source.storedPermissions()).toEqual({ open: "read-write" });
    expect(Object.getPrototypeOf(source.storedPermissions())).toBe(
      Object.prototype
    );
    source.destroy();
  });

  it("keeps the stored map when a connect declares only malformed entries", async () => {
    const stored: PermissionMap = { open: "read-write", locked: "read-only" };
    const source = await createSourceRoom(stored);

    await connectSource(source.room, [
      null as any,
      "open" as any,
      { permissions: "read-write" } as any,
      { elementId: "", permissions: "read-write" },
      { elementId: "__proto__", permissions: "read-write" },
    ]);

    expect(source.storage.puts).not.toContain("sharedPermissions");
    expect(source.storedPermissions()).toEqual(stored);
    expect((await applyConsumerWrite(source.room)).status).toBe(200);
    expect(toggles(source.document)).toEqual(OPEN_WRITTEN_ONLY);
    source.destroy();
  });

  it("does not treat Object.prototype names as shared elements", async () => {
    const source = await createSourceRoom({ open: "read-write" });

    expect(
      await exportPermissions(source.room, ["constructor", "toString", "open"])
    ).toEqual({ open: "read-write" });
    expect((await applyConsumerWrite(source.room)).status).toBe(200);
    expect(toggles(source.document)).toEqual(OPEN_WRITTEN_ONLY);
    source.destroy();
  });

  it("rejects consumer writes to read-only and unshared elements", async () => {
    const unshared = await createSourceRoom({ open: "read-write" });
    expect((await applyConsumerWrite(unshared.room)).status).toBe(200);
    expect(toggles(unshared.document)).toEqual(OPEN_WRITTEN_ONLY);

    const readOnly = await createSourceRoom({
      open: "read-write",
      locked: "read-only",
    });
    expect((await applyConsumerWrite(readOnly.room)).status).toBe(200);
    expect(toggles(readOnly.document)).toEqual(OPEN_WRITTEN_ONLY);
    unshared.destroy();
    readOnly.destroy();
  });

  it("does not write storage when the map is unchanged", async () => {
    const stored: PermissionMap = { open: "read-write", locked: "read-only" };
    const source = await createSourceRoom(stored);

    await connectSource(source.room, [
      { elementId: "locked", permissions: "ro" },
      { elementId: "open", permissions: "read-write" },
    ]);
    await registerSharedElement(source.room, {
      elementId: "locked",
      permissions: "read-only",
    });

    expect(source.storage.puts).not.toContain("sharedPermissions");
    expect(source.storedPermissions()).toBe(stored);
    source.destroy();
  });

  it("does not mutate the cached map in place", async () => {
    const source = await createSourceRoom({ open: "read-write" });
    const before = await source.room.getSharedPermissions();

    await registerSharedElement(source.room, {
      elementId: "locked",
      permissions: "read-only",
    });

    expect(before).toEqual({ open: "read-write" });
    expect(source.storedPermissions()).toEqual({
      open: "read-write",
      locked: "read-only",
    });
    source.destroy();
  });

  it("applies an overlapping connect and register to each other's result", async () => {
    const source = await createSourceRoom({ stale: "read-write" });
    let releaseRead = () => {};
    source.storage.readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });

    const waitForGatedReads = (count: number) =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (source.storage.gatedReads >= count) resolve();
        };
        source.storage.onGatedRead = check;
        check();
      });

    // The connect reads first, so it resumes and writes first; the register
    // must then build on the connect's map, not on the value it read.
    const connected = connectSource(source.room, [
      { elementId: "open", permissions: "read-write" },
      { elementId: "locked", permissions: "read-only" },
    ]);
    await waitForGatedReads(1);
    const registered = registerSharedElement(source.room, {
      elementId: "extra",
      permissions: "read-write",
    });
    await waitForGatedReads(2);
    source.storage.readGate = null;
    releaseRead();
    await Promise.all([connected, registered]);

    const stored = source.storedPermissions();
    expect(stored).toEqual({
      open: "read-write",
      locked: "read-only",
      extra: "read-write",
    });
    expect(await source.room.getSharedPermissions()).toBe(stored);
    source.destroy();
  });

  it("ignores ids beyond the per-room cap with one warning", async () => {
    const source = await createSourceRoom();
    const declared = Array.from({ length: 502 }, (_, index) => ({
      elementId: `element-${index}`,
      permissions: "read-write",
    }));

    const connect = await captureWarnings(() =>
      connectSource(source.room, declared)
    );
    const stored = source.storedPermissions() ?? {};
    expect(Object.keys(stored)).toHaveLength(500);
    expect(stored).not.toHaveProperty("element-500");
    expect(connect.warnings).toEqual([
      "[Bridge] Ignoring 2 shared element id(s) for room source-room: the room already stores the maximum of 500 shared-element permissions.",
    ]);

    const register = await captureWarnings(async () => {
      await registerSharedElement(source.room, {
        elementId: "late",
        permissions: "read-write",
      });
      await registerSharedElement(source.room, {
        elementId: "element-0",
        permissions: "read-only",
      });
    });
    expect(source.storedPermissions()).not.toHaveProperty("late");
    expect(source.storedPermissions()?.["element-0"]).toBe("read-only");
    expect(register.warnings).toEqual([
      "[Bridge] Ignoring 1 shared element id(s) for room source-room: the room already stores the maximum of 500 shared-element permissions.",
    ]);
    source.destroy();
  });
});
