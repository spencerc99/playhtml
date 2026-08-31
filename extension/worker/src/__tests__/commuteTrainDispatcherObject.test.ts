// ABOUTME: Verifies new Internet Commute trains avoid recently used communal stops.
// ABOUTME: Keeps fallback routes from silently repeating an active train's domains.

import { describe, expect, it } from 'vitest';
import type { CommuteDestination } from '@playhtml/extension-types';
import { selectCommuteTrainCommunalStops } from '../commuteTrainDispatcherObject';

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
});
