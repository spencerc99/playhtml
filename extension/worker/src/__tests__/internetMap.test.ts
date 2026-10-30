// ABOUTME: Tests the admin-only internet map bundle route.
// ABOUTME: Verifies auth, path validation, and that private bytes are never cached.

import { describe, expect, it, vi } from 'vitest';
import { handleInternetMapFile, internetMapObjectKey } from '../routes/internetMap';
import type { Env } from '../lib/supabase';

function makeEnv(objects: Record<string, string>) {
  const get = vi.fn(async (key: string) =>
    key in objects ? { body: new Response(objects[key]).body } : null,
  );
  return {
    env: { ADMIN_KEY: 'secret', INTERNET_MAP_BUNDLES: { get } } as unknown as Env,
    get,
  };
}

function request(path: string, token?: string) {
  return new Request(`https://worker.test${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe('internetMapObjectKey', () => {
  it('maps known bundle files to R2 keys', () => {
    expect(internetMapObjectKey('/internet-map/data-small/map.json')).toBe('data-small/map.json');
    expect(internetMapObjectKey('/internet-map/full/labels.json.gz')).toBe('full/labels.json.gz');
  });

  it('rejects unknown files, traversal, and nested paths', () => {
    expect(internetMapObjectKey('/internet-map/data-small/secrets.txt')).toBeNull();
    expect(internetMapObjectKey('/internet-map/../map.json')).toBeNull();
    expect(internetMapObjectKey('/internet-map/a/b/map.json')).toBeNull();
    expect(internetMapObjectKey('/internet-map/map.json')).toBeNull();
  });
});

describe('handleInternetMapFile', () => {
  it('refuses requests without the admin key before touching R2', async () => {
    const { env, get } = makeEnv({ 'data-small/map.json': '{}' });
    for (const token of [undefined, 'wrong']) {
      const path = '/internet-map/data-small/map.json';
      const res = await handleInternetMapFile(request(path, token), env, path);
      expect(res.status).toBe(401);
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('serves a stored file to the admin without caching it', async () => {
    const { env } = makeEnv({ 'data-small/map.json': '{"counts":{}}' });
    const path = '/internet-map/data-small/map.json';
    const res = await handleInternetMapFile(request(path, 'secret'), env, path);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await res.text()).toBe('{"counts":{}}');
  });

  it('opens bundles with the map password, and not when none is set', async () => {
    const { env } = makeEnv({ 'data-small/map.json': '{}' });
    const path = '/internet-map/data-small/map.json';
    const locked = await handleInternetMapFile(request(path, 'share'), env, path);
    expect(locked.status).toBe(401);
    env.INTERNET_MAP_PASSWORD = 'share';
    const res = await handleInternetMapFile(request(path, 'share'), env, path);
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
  });

  it('returns 404 for a missing bundle', async () => {
    const { env } = makeEnv({});
    const path = '/internet-map/nope/map.bin';
    const res = await handleInternetMapFile(request(path, 'secret'), env, path);
    expect(res.status).toBe(404);
  });
});
