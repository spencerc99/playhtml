// ABOUTME: Exercises installation reload control against an emulated D1 database.
// ABOUTME: Verifies public reads, admin authentication, atomic increments, and cache headers.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import type { Env } from '../lib/supabase';
import {
  handleAdminInstallationReload,
  handleInstallationControl,
} from '../routes/installationControl';

const schema = readFileSync(fileURLToPath(new URL(
  '../../migrations/0003_installation_control.sql',
  import.meta.url,
)), 'utf8').replace(/^--.*$/gm, '').trim();

let miniflare: Miniflare;
let workerEnv: Env;

function adminRequest(token = 'admin-secret'): Request {
  return new Request('https://worker.example/admin/installation/reload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

beforeEach(async () => {
  miniflare = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
    d1Databases: ['WWO_ADMIN_DB'],
  });
  const db = await miniflare.getD1Database('WWO_ADMIN_DB');
  await db.batch(schema
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
    .map((statement) => db.prepare(statement)));
  workerEnv = {
    ADMIN_KEY: 'admin-secret',
    WWO_ADMIN_DB: db,
  } as Env;
});

afterEach(async () => miniflare.dispose());

describe('installation control', () => {
  it('returns the public generation without allowing caches to retain it', async () => {
    const response = await handleInstallationControl(workerEnv);

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(await response.json()).toMatchObject({
      generation: 0,
      updatedAt: expect.any(String),
    });
  });

  it('rejects missing and incorrect admin credentials', async () => {
    const missing = await handleAdminInstallationReload(
      new Request('https://worker.example/admin/installation/reload', { method: 'POST' }),
      workerEnv,
    );
    const incorrect = await handleAdminInstallationReload(adminRequest('wrong'), workerEnv);

    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
  });

  it('atomically increments concurrent reload requests', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => handleAdminInstallationReload(adminRequest(), workerEnv)),
    );
    const generations = await Promise.all(responses.map(async (response) => {
      expect(response.status).toBe(200);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      return (await response.json() as { generation: number }).generation;
    }));

    expect([...generations].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(await (await handleInstallationControl(workerEnv)).json()).toMatchObject({ generation: 8 });
  });
});
