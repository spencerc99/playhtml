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
  suggestIngestedDestinations,
} from '../routes/commute';
import { handleClefLog } from '../routes/clefLog';
import {
  handleInternetPlaceSuggestion,
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
    for (const name of ['0005_internet_place_catalog.sql', '0006_internet_place_placement.sql', '0007_internet_place_suggestions.sql', '0008_internet_place_suggestion_evidence.sql', '0009_internet_place_clef_log.sql']) {
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

  /** Answers page questions with `placement` and name checks with `name`; returns the page-question spy. */
  function useClef(placement = 'regular', name = 'scenery') {
    const pageRun = vi.fn(async (_model: string, _input: unknown) => ({
      answers: {
        placement: { choice: placement, confidence: 0.5, probabilities: {} },
        scope: { choice: 'page', confidence: 0.7, probabilities: {} },
        reason: { choice: 'none', confidence: 0.5, probabilities: {} },
      },
    }));
    const nameRun = vi.fn(async () => ({
      answers: { placement: { choice: name, confidence: 0.8, probabilities: {} } },
    }));
    const run = vi.fn(async (model: string, input: { questions: Record<string, unknown> }) =>
      'scope' in input.questions ? pageRun(model, input) : nameRun());
    env.AI = { run } as unknown as Env['AI'];
    return Object.assign(pageRun, { names: nameRun });
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
    expect(await suggestCommuteDestinations(env)).toBe(2);
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

  it('judges from the URL and title alone when the logged-out fetch is blocked', async () => {
    fetchPublicPageContext.mockResolvedValue({
      inspection: { verdict: 'unknown', reason: 'access_restricted', finalUrl: 'https://public.example/article' },
      context: { headings: ['Access denied'], text: '403 Forbidden' },
    });
    const run = useClef('regular');
    expect(await suggestCommuteDestinations(env)).toBe(2);
    const state = (run.mock.calls[0] as unknown[])[1] as { state: { candidate: Record<string, unknown> } };
    expect(state.state.candidate.page).toBeUndefined();
    expect(state.state.candidate.inspection).toBeUndefined();
  });

  it('asks Clef about a newly ingested destination right away', async () => {
    fetchPublicPageContext.mockResolvedValue({
      inspection: { verdict: 'public', reason: 'public_html', finalUrl: 'https://fresh.example/post' },
      context: { headings: ['A post'], text: 'Hello.' },
    });
    const run = useClef('regular');
    const batch = [event('navigation', 'https://fresh.example/post'), event('keyboard', 'https://fresh.example/post')];
    expect(await suggestIngestedDestinations(env, batch)).toBe(2);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await suggestIngestedDestinations(env, batch)).toBe(0);
    expect(await suggestIngestedDestinations(env, [event('keyboard', 'https://other.example/')])).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('skips ingested pages a human already decided', async () => {
    await env.WWO_ADMIN_DB.prepare(
      "INSERT INTO place_policies (scope, place_key, placement, note) VALUES ('site', 'fresh.example', 'regular', '')",
    ).run();
    const run = useClef('regular');
    expect(await suggestIngestedDestinations(env, [event('navigation', 'https://fresh.example/post')])).toBe(0);
    expect(run).not.toHaveBeenCalled();
  });

  it('hides a page outright when Clef says its name is sensitive', async () => {
    useClef();
    await saveClefSuggestion('hidden');
    const response = await handleCommute(new Request('https://worker.example/commute/recent'), env);
    const payload = (await response.json()) as CommuteResponse;
    expect(payload.destinations).toEqual([]);
    expect(JSON.stringify(payload.scenery)).not.toContain('public.example');
  });

  it('tells the desk which undecided pages need a human', async () => {
    env.ADMIN_KEY = 'test-admin-key';
    const review = async () => {
      const response = await handleCommuteReview(new Request('https://worker.example/commute/review', {
        headers: { Authorization: 'Bearer test-admin-key' },
      }), env);
      return ((await response.json()) as { destinations: Array<{ review: Record<string, unknown> }> }).destinations;
    };
    expect((await review())[0].review).toMatchObject({ need: 'pending', visits: 1 });
    await saveClefSuggestion('featured');
    expect((await review())[0].review).toMatchObject({ need: 'promote', clef: { placement: 'featured' } });
    await env.WWO_ADMIN_DB.prepare(
      "INSERT INTO place_policies (scope, place_key, placement, note) VALUES ('site', 'public.example', 'regular', '')",
    ).run();
    expect((await review())[0].review.need).toBeNull();
  });

  it('hides a scenery name Clef calls sensitive and flags it for review', async () => {
    const run = useClef('regular', 'hidden');
    expect(await suggestCommuteDestinations(env)).toBe(2);
    expect(run.names).toHaveBeenCalledTimes(1);
    const response = await handleCommute(new Request('https://worker.example/commute/recent'), env);
    const payload = (await response.json()) as CommuteResponse;
    expect(JSON.stringify(payload)).not.toContain('public.example');

    env.ADMIN_KEY = 'test-admin-key';
    const review = await handleCommuteReview(new Request('https://worker.example/commute/review', {
      headers: { Authorization: 'Bearer test-admin-key' },
    }), env);
    const body = (await review.json()) as { scenery: Array<{ domain: string; review: { need: string | null } }> };
    expect(body.scenery.find((item) => item.domain === 'public.example')?.review.need).toBe('hidden');
    const log = await env.WWO_ADMIN_DB.prepare('SELECT kind FROM place_clef_log ORDER BY id').all<{ kind: string }>();
    expect(log.results?.map((row) => row.kind).sort()).toEqual(['name', 'page']);
  });

  it('logs each Clef answer with what it saw and whether the curator agreed', async () => {
    fetchPublicPageContext.mockResolvedValue({
      inspection: { verdict: 'public', reason: 'public_html', finalUrl: 'https://public.example/article' },
      context: { description: 'A public essay', headings: ['An article'], text: 'Hello there.' },
    });
    useClef('regular');
    await suggestCommuteDestinations(env);
    env.ADMIN_KEY = 'test-admin-key';
    const readLog = async () => {
      const response = await handleClefLog(new Request('https://worker.example/admin/internet-places/clef-log', {
        headers: { Authorization: 'Bearer test-admin-key' },
      }), env);
      return (await response.json()) as {
        entries: Array<{ kind: string; input: Record<string, unknown>; agreed: boolean | null }>;
        summary: { decided: number; agreed: number };
      };
    };
    const before = await readLog();
    const pageEntry = before.entries.find((entry) => entry.kind === 'page');
    expect(pageEntry?.input).toMatchObject({ page: { description: 'A public essay' } });
    expect(pageEntry?.agreed).toBeNull();
    await env.WWO_ADMIN_DB.prepare(
      "INSERT INTO place_policies (scope, place_key, placement, note) VALUES ('site', 'public.example', 'scenery', '')",
    ).run();
    const after = await readLog();
    expect(after.entries.find((entry) => entry.kind === 'page')?.agreed).toBe(false);
    expect(after.summary).toEqual({ decided: 2, agreed: 1 });
  });

  it('shows the desk the answer the gate already used', async () => {
    fetchPublicPageContext.mockResolvedValue({
      inspection: { verdict: 'public', reason: 'public_html', finalUrl: 'https://public.example/article' },
      context: { description: 'A public essay', headings: ['An article'], text: 'Hello there.' },
    });
    const run = useClef('regular');
    await suggestCommuteDestinations(env);
    env.ADMIN_KEY = 'test-admin-key';
    const response = await handleInternetPlaceSuggestion(new Request('https://worker.example/admin/internet-places/suggestion', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-admin-key', 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidate: { url: 'https://public.example/article', title: 'A public page' } }),
    }), env);
    expect(((await response.json()) as { source: string }).source).toBe('cache');
    expect(run).toHaveBeenCalledTimes(1);
  });
});
