// ABOUTME: Verifies public beta eligibility checks and protected allowlist mutations.
// ABOUTME: Exercises the Cloudflare KV contract without exposing the full allowlist publicly.

import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../lib/supabase';
import {
  handleAdminInternalAccessAdd,
  handleAdminInternalAccessList,
  handleAdminInternalAccessRemove,
  handleInternalAccessCheck,
} from '../routes/internalAccess';

const PUBLIC_ID = `pk_${'a'.repeat(130)}`;

class MemoryKV {
  private values = new Map<string, { value: string; metadata?: unknown }>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key)?.value ?? null;
  }

  async put(
    key: string,
    value: string,
    options?: { metadata?: unknown },
  ): Promise<void> {
    this.values.set(key, { value, metadata: options?.metadata });
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list({ prefix }: { prefix?: string } = {}) {
    return {
      keys: [...this.values.entries()]
        .filter(([key]) => !prefix || key.startsWith(prefix))
        .map(([name, entry]) => ({ name, metadata: entry.metadata })),
      list_complete: true as const,
      cacheStatus: null,
    };
  }
}

function env(): Env {
  return {
    ADMIN_KEY: 'admin-secret',
    WWO_INTERNAL_ACCESS: new MemoryKV() as unknown as KVNamespace,
  } as Env;
}

function adminRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, {
    ...init,
    headers: {
      Authorization: 'Bearer admin-secret',
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
}

describe('internal access', () => {
  let workerEnv: Env;

  beforeEach(() => {
    workerEnv = env();
  });

  it('checks one public ID without exposing the allowlist', async () => {
    const before = await handleInternalAccessCheck(workerEnv, PUBLIC_ID);
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ enabled: false });

    await workerEnv.WWO_INTERNAL_ACCESS.put(
      `internal-access:${PUBLIC_ID}`,
      '1',
    );

    const after = await handleInternalAccessCheck(workerEnv, PUBLIC_ID);
    expect(await after.json()).toEqual({ enabled: true });
  });

  it('rejects malformed public IDs', async () => {
    const response = await handleInternalAccessCheck(workerEnv, 'pk_short');

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid public ID' });
  });

  it('requires the WWO admin key for allowlist reads and writes', async () => {
    const response = await handleAdminInternalAccessList(
      new Request('https://worker.example/admin/internal-access'),
      workerEnv,
    );

    expect(response.status).toBe(401);
  });

  it('fails closed when the Worker admin key is missing', async () => {
    workerEnv.ADMIN_KEY = '';
    const response = await handleAdminInternalAccessList(
      new Request('https://worker.example/admin/internal-access', {
        headers: { Authorization: 'Bearer ' },
      }),
      workerEnv,
    );

    expect(response.status).toBe(401);
  });

  it('normalizes public IDs before storing and checking them', async () => {
    const uppercasePublicId = PUBLIC_ID.toUpperCase();
    const add = await handleAdminInternalAccessAdd(
      adminRequest('https://worker.example/admin/internal-access', {
        method: 'POST',
        body: JSON.stringify({ publicId: uppercasePublicId }),
      }),
      workerEnv,
    );

    expect(await add.json()).toEqual({
      publicId: PUBLIC_ID,
      addedAt: expect.any(String),
    });
    const check = await handleInternalAccessCheck(workerEnv, PUBLIC_ID);
    expect(await check.json()).toEqual({ enabled: true });
  });

  it('adds, lists, and removes approved public IDs', async () => {
    const add = await handleAdminInternalAccessAdd(
      adminRequest('https://worker.example/admin/internal-access', {
        method: 'POST',
        body: JSON.stringify({ publicId: PUBLIC_ID }),
      }),
      workerEnv,
    );
    expect(add.status).toBe(201);

    const list = await handleAdminInternalAccessList(
      adminRequest('https://worker.example/admin/internal-access'),
      workerEnv,
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({
      entries: [{ publicId: PUBLIC_ID, addedAt: expect.any(String) }],
    });

    const remove = await handleAdminInternalAccessRemove(
      adminRequest(
        `https://worker.example/admin/internal-access/${encodeURIComponent(PUBLIC_ID)}`,
        { method: 'DELETE' },
      ),
      workerEnv,
      PUBLIC_ID,
    );
    expect(remove.status).toBe(200);

    const after = await handleInternalAccessCheck(workerEnv, PUBLIC_ID);
    expect(await after.json()).toEqual({ enabled: false });
  });
});
