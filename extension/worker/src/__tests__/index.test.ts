// ABOUTME: Verifies public and guarded routes at the extension Worker boundary.
// ABOUTME: Covers headerless access to the sanitized Internet Commute response.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../lib/supabase';

const { handleCommute } = vi.hoisted(() => ({
  handleCommute: vi.fn(
    async () =>
      new Response(JSON.stringify({ destinations: [] }), {
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
}));

vi.mock('../routes/installationControl', () => ({
  handleAdminInstallationReload,
  handleInstallationControl,
}));

import worker from '../index';

describe('Worker route access', () => {
  beforeEach(() => {
    handleCommute.mockClear();
    handleAdminInstallationReload.mockClear();
    handleInstallationControl.mockClear();
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
});
