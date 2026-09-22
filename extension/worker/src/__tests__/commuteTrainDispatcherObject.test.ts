// ABOUTME: Verifies new Internet Commute trains avoid recently used communal stops.
// ABOUTME: Keeps fallback routes from silently repeating an active train's domains.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { readFileSync } from 'node:fs';
import type {
  CommuteDestination,
  CommuteTrainAssignment,
} from '@playhtml/extension-types';
import type { Env } from '../lib/supabase';

const getCommuteResponse = vi.hoisted(() => vi.fn());

vi.mock('../routes/commute', () => ({ getCommuteResponse }));

import {
  CommuteTrainDispatcherObject,
  selectCommuteTrainCommunalStops,
} from '../commuteTrainDispatcherObject';

function destination(domain: string): CommuteDestination {
  return {
    id: `https://${domain}/page`,
    domain,
    url: `https://${domain}/page`,
    title: domain,
    visitedAt: 1_000,
    hue: '#4a9a8a',
  };
}

let runtime: Miniflare;
let env: Env;
beforeEach(async () => {
  runtime = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: ['WWO_ADMIN_DB'] });
  const db = await runtime.getD1Database('WWO_ADMIN_DB');
  for (const name of ['0003_internet_place_catalog.sql', '0004_internet_place_placement.sql']) {
    const sql = readFileSync(new URL(`../../migrations/${name}`, import.meta.url), 'utf8');
    for (const statement of sql.replace(/^--.*$/gm, '').split(';').filter((part) => part.trim())) await db.prepare(statement).run();
  }
  env = { WWO_ADMIN_DB: db } as Env;
});
afterEach(async () => { await runtime.dispose(); vi.restoreAllMocks(); });

function dispatcherObject(): CommuteTrainDispatcherObject {
  const storage = new Map<string, unknown>();
  return new CommuteTrainDispatcherObject({
    storage: {
      get: async (key: string) => storage.get(key),
      put: async (key: string, value: unknown) => { storage.set(key, value); },
      setAlarm: async () => {}, deleteAlarm: async () => {},
    },
    blockConcurrencyWhile: <T>(callback: () => Promise<T>) => callback(),
  } as unknown as DurableObjectState, env);
}

function boardRequest(): Request {
  return new Request('https://dispatcher.internal/board', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ riderToken: 'commute-fallback-rider', requestedStop: { kind: 'none' } }),
  });
}

describe('selectCommuteTrainCommunalStops', () => {
  it('skips domains already used by retained trains', () => {
    const stops = selectCommuteTrainCommunalStops(
      [
        destination('love2d.org'),
        destination('jessicabickling.com'),
        destination('fresh-one.example'),
        destination('fresh-two.example'),
      ],
      new Set(['love2d.org', 'jessicabickling.com']),
    );

    expect(stops.map((stop) => stop.domain)).toEqual([
      'fresh-one.example',
      'fresh-two.example',
    ]);
  });

  it('does not reuse fallback domains from retained trains', () => {
    const stops = selectCommuteTrainCommunalStops(
      [],
      new Set(['html.energy', 'special.fish']),
    );

    expect(stops).toEqual([]);
  });

  it('revalidates routes after concurrent destination loads', async () => {
    const destinations = [
      destination('first-one.example'),
      destination('first-two.example'),
      destination('second-one.example'),
      destination('second-two.example'),
    ];
    getCommuteResponse.mockImplementation(async () => {
      await Promise.resolve();
      return { destinations };
    });
    const storage = {
      get: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
      setAlarm: vi.fn().mockResolvedValue(undefined),
      deleteAlarm: vi.fn().mockResolvedValue(undefined),
    };
    const state = {
      storage,
      blockConcurrencyWhile: <T>(callback: () => Promise<T>) => callback(),
    } as unknown as DurableObjectState;
    const dispatcher = new CommuteTrainDispatcherObject(state, env);

    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        dispatcher.fetch(
          new Request('https://dispatcher.internal/board', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              riderToken: `commute-rider-0${index}`,
              requestedStop: { kind: 'none' },
            }),
          }),
        ),
      ),
    );
    const assignments = (await Promise.all(
      responses.map((response) => response.json()),
    )) as CommuteTrainAssignment[];

    expect(responses.map(({ status }) => status)).toEqual([
      200,
      200,
      200,
      200,
      200,
    ]);
    expect(new Set(assignments.slice(0, 4).map(({ trainId }) => trainId))).toEqual(
      new Set([assignments[0].trainId]),
    );
    expect(assignments[4].trainId).not.toBe(assignments[0].trainId);
    expect(assignments[0].stops.map(({ domain }) => domain)).toEqual([
      'first-one.example',
      'first-two.example',
    ]);
    expect(assignments[4].stops.map(({ domain }) => domain)).toEqual([
      'second-one.example',
      'second-two.example',
    ]);
  });

  it('only uses fallback stops after checking their policies', async () => {
    getCommuteResponse.mockRejectedValue(new Error('feed unavailable'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await dispatcherObject().fetch(boardRequest());
    expect(response.status).toBe(200);
    expect((await response.json() as CommuteTrainAssignment).stops.map((stop) => stop.domain))
      .toEqual(['html.energy', 'special.fish']);
    await env.WWO_ADMIN_DB.prepare("INSERT INTO place_policies (scope, place_key, placement, note) VALUES ('hostname', 'html.energy', 'hidden', '')").run();
    expect((await dispatcherObject().fetch(boardRequest())).status).toBe(503);
    await env.WWO_ADMIN_DB.prepare('DROP TABLE place_policies').run();
    expect((await dispatcherObject().fetch(boardRequest())).status).toBe(503);
    expect(warning).toHaveBeenCalledTimes(5);
    expect(warning).toHaveBeenCalledWith('[commute trains] no policy-checked route available:', expect.any(Error));
  });

  it('does not inject hidden fallback stops beside a live destination', async () => {
    getCommuteResponse.mockResolvedValue({ destinations: [destination('live.example')] });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await env.WWO_ADMIN_DB.prepare("INSERT INTO place_policies (scope, place_key, placement, note) VALUES ('site', 'html.energy', 'hidden', ''), ('page', 'https://special.fish/', 'scenery', '')").run();
    const response = await dispatcherObject().fetch(boardRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'No policy-checked train route is available' });
    expect(warning).toHaveBeenCalledWith('[commute trains] no policy-checked route available:', expect.any(Error));
  });
});
