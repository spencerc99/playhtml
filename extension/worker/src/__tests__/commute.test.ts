// ABOUTME: Covers the sanitized Internet Commute HTTP response.
// ABOUTME: Verifies raw recent events are reduced before they leave the Worker.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import type {
  CollectionEvent,
  CommuteResponse,
} from '@playhtml/extension-types';
import type { Env } from '../lib/supabase';

const { handleRecent } = vi.hoisted(() => ({
  handleRecent: vi.fn(),
}));

vi.mock('../routes/recent', () => ({
  handleRecent,
}));

import { handleCommute, handleCommuteReview } from '../routes/commute';

let env: Env;
let miniflare: Miniflare;

function event(type: CollectionEvent['type'], url: string): CollectionEvent {
  return {
    id: `${type}-event`,
    type,
    ts: Date.now(),
    data: type === 'navigation' ? { title: 'A public page' } : {},
    meta: {
      pid: 'private-participant-id',
      sid: 'private-session-id',
      url,
      vw: 1200,
      vh: 800,
      tz: 'UTC',
      cursor_color: '#5b8db8',
    },
  };
}

describe('handleCommute', () => {
  beforeEach(async () => {
    miniflare = new Miniflare({
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
      d1Databases: ['WWO_ADMIN_DB'],
    });
    const db = await miniflare.getD1Database('WWO_ADMIN_DB');
    for (const name of ['0003_internet_place_catalog.sql', '0004_internet_place_placement.sql']) {
      const sql = readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
      for (const statement of sql.replace(/^--.*$/gm, '').split(';').filter((part) => part.trim())) {
        await db.prepare(statement).run();
      }
    }
    env = { WWO_ADMIN_DB: db } as Env;
    handleRecent.mockReset();
    handleRecent.mockImplementation(async (request: Request) => {
      const type = new URL(request.url).searchParams.get('type');
      const events =
        type === 'navigation'
          ? [event('navigation', 'https://public.example/article')]
          : [event('keyboard', 'https://private.example/account')];
      return new Response(JSON.stringify(events), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  afterEach(async () => {
    await miniflare.dispose();
    vi.restoreAllMocks();
  });

  it('returns a commute-specific response without raw event metadata', async () => {
    const response = await handleCommute(
      new Request('https://worker.example/commute/recent'),
      env,
    );
    const payload = (await response.json()) as CommuteResponse;

    expect(response.status).toBe(200);
    expect(handleRecent).toHaveBeenCalledTimes(2);
    expect(
      new URL(handleRecent.mock.calls[1][0].url).searchParams.get('type'),
    ).toBe('all');
    expect(payload.destinations).toEqual([
      expect.objectContaining({
        domain: 'public.example',
        url: 'https://public.example/article',
      }),
    ]);
    expect(payload.activePeople).toBe(1);
    expect(JSON.stringify(payload)).not.toContain('private-participant-id');
    expect(JSON.stringify(payload)).not.toContain('private-session-id');
    expect(JSON.stringify(payload)).not.toContain('private.example/account');
  });

  it('applies hidden policies and fails closed when the catalog is unavailable', async () => {
    await env.WWO_ADMIN_DB.prepare(
      "INSERT INTO place_policies (scope, place_key, placement, note) VALUES ('hostname', 'public.example', 'hidden', '')",
    ).run();
    const request = new Request('https://worker.example/commute/recent');
    const filtered = await handleCommute(request, env);
    expect(await filtered.json()).toMatchObject({ destinations: [], scenery: [] });
    await env.WWO_ADMIN_DB.prepare('DROP TABLE place_policies').run();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unavailable = await handleCommute(request, env);
    expect(unavailable.status).toBe(500);
    expect(await unavailable.json()).toEqual({ error: 'Failed to build recent commute route' });
    expect(error).toHaveBeenCalledWith('[commute] recent route failed:', expect.any(Error));
  });

  it('requires admin authentication before exposing the uncurated review feed', async () => {
    env.ADMIN_KEY = 'test-admin-key';
    const response = await handleCommuteReview(new Request('https://worker.example/commute/review', {
      headers: { Origin: 'https://wewere.online' },
    }), env);
    expect(response.status).toBe(401);
    expect(handleRecent).not.toHaveBeenCalled();
    const authenticated = await handleCommuteReview(new Request('https://worker.example/commute/review', {
      headers: { Authorization: 'Bearer test-admin-key' },
    }), env);
    expect(authenticated.status).toBe(200);
  });
});
