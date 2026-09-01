// ABOUTME: Verifies new Internet Commute trains avoid recently used communal stops.
// ABOUTME: Keeps fallback routes from silently repeating an active train's domains.

import { describe, expect, it, vi } from 'vitest';
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
      2_000,
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
      2_000,
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
    const dispatcher = new CommuteTrainDispatcherObject(state, {} as Env);

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
});
