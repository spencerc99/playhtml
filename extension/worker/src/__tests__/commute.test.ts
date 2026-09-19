// ABOUTME: Covers the sanitized Internet Commute HTTP response.
// ABOUTME: Verifies raw recent events are reduced before they leave the Worker.

import { beforeEach, describe, expect, it, vi } from 'vitest';
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

import { handleCommute } from '../routes/commute';

const ENV = {} as Env;

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
  beforeEach(() => {
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

  it('returns a commute-specific response without raw event metadata', async () => {
    const response = await handleCommute(
      new Request('https://worker.example/commute/recent'),
      ENV,
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
});
