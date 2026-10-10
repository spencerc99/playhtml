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

const { fetchPublicPageContext } = vi.hoisted(() => ({
  fetchPublicPageContext: vi.fn(),
}));

vi.mock('../routes/pageMeta', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../routes/pageMeta')>()),
  fetchPublicPageContext,
}));

import {
  handleCommute,
  handleCommuteReview,
  suggestCommuteDestinations,
} from '../routes/commute';
import {
  INTERNET_PLACE_SUGGESTION_MODEL,
  INTERNET_PLACE_SUGGESTION_PROMPT_VERSION,
} from '../routes/internetPlaceSuggestion';

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
    for (const name of ['0005_internet_place_catalog.sql', '0006_internet_place_placement.sql', '0007_internet_place_suggestions.sql', '0008_internet_place_suggestion_evidence.sql']) {
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

  async function saveClefSuggestion(placement: string) {
    await env.WWO_ADMIN_DB.prepare(
      `INSERT INTO place_suggestions (page_key, model, prompt_version, suggestion_json, evidence_hash)
       VALUES (?, ?, ?, ?, 'hash')`,
    ).bind(
      'https://public.example/article',
      INTERNET_PLACE_SUGGESTION_MODEL,
      INTERNET_PLACE_SUGGESTION_PROMPT_VERSION,
      JSON.stringify({ placement, scope: 'site', confidence: 0.4, rationale: 'Clef', uncertainties: [] }),
    ).run();
  }

  function useClef(placement = 'regular') {
    const run = vi.fn(async () => ({
      answers: {
        placement: { choice: placement, confidence: 0.5, probabilities: {} },
        scope: { choice: 'page', confidence: 0.7, probabilities: {} },
        reason: { choice: 'none', confidence: 0.5, probabilities: {} },
      },
    }));
    env.AI = { run } as unknown as Env['AI'];
    return run;
  }

  async function destinations(): Promise<CommuteResponse['destinations']> {
    const response = await handleCommute(new Request('https://worker.example/commute/recent'), env);
    return ((await response.json()) as CommuteResponse).destinations;
  }

  it('holds an unreviewed page as scenery until Clef approves it', async () => {
    useClef();
    expect(await destinations()).toEqual([]);
    await saveClefSuggestion('scenery');
    expect(await destinations()).toEqual([]);
    await env.WWO_ADMIN_DB.prepare('DELETE FROM place_suggestions').run();
    await saveClefSuggestion('regular');
    expect(await destinations()).toHaveLength(1);
  });

  it('lets human policies override the gate and keeps Clef promotions ordinary', async () => {
    useClef();
    await env.WWO_ADMIN_DB.prepare(
      "INSERT INTO place_policies (scope, place_key, placement, note) VALUES ('site', 'public.example', 'regular', '')",
    ).run();
    expect(await destinations()).toHaveLength(1);

    await env.WWO_ADMIN_DB.prepare('DELETE FROM place_policies').run();
    await saveClefSuggestion('featured');
    expect(await destinations()).toHaveLength(1);
  });

  it('asks Clef only about destinations nobody has reviewed or suggested', async () => {
    fetchPublicPageContext.mockResolvedValue({
      title: 'An article',
      inspection: { verdict: 'public', reason: 'public_html', finalUrl: 'https://public.example/article' },
      context: { description: 'A public essay', headings: ['An article'], text: 'Hello there.' },
    });
    const run = useClef('regular');
    expect(await destinations()).toEqual([]);
    expect(await suggestCommuteDestinations(env)).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    const state = (run.mock.calls[0] as unknown[])[1] as { state: { candidate: Record<string, unknown> } };
    expect(state.state.candidate).toMatchObject({
      url: 'https://public.example/article',
      inspection: { verdict: 'public' },
      page: { description: 'A public essay', headings: ['An article'] },
    });
    expect(await suggestCommuteDestinations(env)).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await destinations()).toHaveLength(1);
  });
});
