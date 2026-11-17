// ABOUTME: Verifies public and guarded routes at the extension Worker boundary.
// ABOUTME: Covers headerless commute access and 400s for malformed paths, queries, and bodies.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const { handleCommute, handleCommuteReview } = vi.hoisted(() => ({
  handleCommute: vi.fn(
    async () =>
      new Response(JSON.stringify({ destinations: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  ),
  handleCommuteReview: vi.fn(
    async () =>
      new Response(JSON.stringify({ items: [] }), {
        headers: { 'Content-Type': 'application/json' },
      }),
  ),
}));

const { handleAdminInstallationReload, handleInstallationControl } = vi.hoisted(() => ({
  handleAdminInstallationReload: vi.fn(async () => new Response(null, { status: 204 })),
  handleInstallationControl: vi.fn(async () => new Response(null, { status: 204 })),
}));

vi.mock('../routes/commute', () => ({
  handleCommute,
  handleCommuteReview,
}));

vi.mock('../routes/installationControl', () => ({
  handleAdminInstallationReload,
  handleInstallationControl,
}));

import worker from '../index';

describe('Worker route access', () => {
  beforeEach(() => {
    handleCommute.mockClear();
    handleCommuteReview.mockClear();
    handleAdminInstallationReload.mockClear();
    handleInstallationControl.mockClear();
  });

  it('serves the commute review queue only to allowed browser origins', async () => {
    const allowed = await worker.fetch(
      new Request('https://worker.example/commute/review', {
        headers: { Origin: 'https://wewere.online' },
      }),
      {} as Env,
      {} as ExecutionContext,
    );
    const forbidden = await worker.fetch(
      new Request('https://worker.example/commute/review'),
      {} as Env,
      {} as ExecutionContext,
    );

    expect(allowed.status).toBe(200);
    expect(forbidden.status).toBe(403);
    expect(handleCommuteReview).toHaveBeenCalledTimes(1);
  });

  it('serves the sanitized commute route without browser origin headers', async () => {
    const response = await worker.fetch(
      new Request('https://worker.example/commute/recent'),
      {} as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(200);
    expect(handleCommute).toHaveBeenCalledTimes(1);
  });

  it('keeps raw recent events unavailable without browser origin headers', async () => {
    const response = await worker.fetch(
      new Request('https://worker.example/events/recent'),
      {} as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(403);
    expect(handleCommute).not.toHaveBeenCalled();
  });

  it('routes public installation control reads', async () => {
    const env = {} as Env;
    const response = await worker.fetch(
      new Request('https://worker.example/installation/control'),
      env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(204);
    expect(handleInstallationControl).toHaveBeenCalledWith(env);
  });

  it('routes installation reload mutations to the authenticated handler', async () => {
    const env = {} as Env;
    const request = new Request('https://worker.example/admin/installation/reload', {
      method: 'POST',
    });
    const response = await worker.fetch(request, env, {} as ExecutionContext);

    expect(response.status).toBe(204);
    expect(handleAdminInstallationReload).toHaveBeenCalledWith(request, env);
  });
  const ORIGIN = { Origin: 'https://wewere.online' };

  it.each([
    ['GET', '/feature-access/%E0%A4%A'],
    ['PUT', '/participants/%zz'],
    ['PUT', '/admin/access-control/features/%'],
    ['PUT', '/admin/access-control/cohorts/%E0'],
    ['PUT', '/admin/access-control/people/%E0%A4%A'],
  ])('answers 400 to a broken percent escape on %s %s', async (method, path) => {
    const response = await worker.fetch(
      new Request(`https://worker.example${path}`, { method }),
      {} as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid path encoding' });
  });

  it.each([
    '/events/recent?limit=abc',
    '/events/recent?limit=0',
    '/events/recent?from=yesterday',
    '/events/recent?to=2026-99-99',
    '/events/daily-counts?from=nope',
    '/events/daily-counts?to=12345',
  ])('answers 400 to malformed query %s', async (path) => {
    const response = await worker.fetch(
      new Request(`https://worker.example${path}`, { headers: ORIGIN }),
      {} as Env,
      {} as ExecutionContext,
    );

    expect(response.status).toBe(400);
  });

  it.each(['/subscribe', '/quarantine/strip', '/quarantine/rip'])(
    'answers 400 to a JSON null body on %s',
    async (path) => {
      const response = await worker.fetch(
        new Request(`https://worker.example${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': `198.51.100.${path.length}` },
          body: 'null',
        }),
        {} as Env,
        {} as ExecutionContext,
      );

      expect(response.status).toBe(400);
    },
  );
});
