// ABOUTME: Covers bounded oldest-first assignment and append-only train routes.
// ABOUTME: Verifies rolling joins, domain coalescing, idempotency, and cleanup.

import { describe, expect, it } from 'vitest';
import type {
  CommuteTrainBoardRequest,
  CommuteTrainCommunalStop,
} from '@playhtml/extension-types';
import {
  CommuteTrainDispatcher,
  CommuteTrainCapacityError,
  COMMUTE_TRAIN_RIDER_LEASE_MS,
  EMPTY_COMMUTE_TRAIN_DISPATCHER_STATE,
  MAX_RETAINED_COMMUTE_TRAINS,
} from '../commuteTrainDispatcher';

const NOW = 1_000_000;
const COMMUNAL_STOPS: CommuteTrainCommunalStop[] = [
  {
    kind: 'communal',
    id: 'communal-1',
    domain: 'html.energy',
    url: 'https://html.energy/',
    title: null,
    visitedAt: NOW,
    hue: '#d4b85c',
  },
  {
    kind: 'communal',
    id: 'communal-2',
    domain: 'special.fish',
    url: 'https://special.fish/',
    title: null,
    visitedAt: NOW,
    hue: '#5b8db8',
  },
];

function rider(riderToken: string, domain?: string): CommuteTrainBoardRequest {
  return {
    riderToken,
    requestedStop: domain ? { kind: 'domain', domain } : { kind: 'none' },
  };
}

function dispatcher() {
  let id = 0;
  return new CommuteTrainDispatcher(
    structuredClone(EMPTY_COMMUTE_TRAIN_DISPATCHER_STATE),
    () => `generated-${++id}`,
  );
}

describe('CommuteTrainDispatcher', () => {
  it('assigns at most four simultaneous riders to each train', () => {
    const subject = dispatcher();
    const assignments = Array.from({ length: 100 }, (_, index) =>
      subject.board(rider(`rider-${index}`), COMMUNAL_STOPS, NOW),
    );

    expect(
      new Set(assignments.map((assignment) => assignment.trainId)).size,
    ).toBe(25);
    expect(
      Math.max(...assignments.map((assignment) => assignment.riderCount)),
    ).toBe(4);
  });

  it('returns the same assignment for an idempotent rider request', () => {
    const subject = dispatcher();
    const first = subject.board(
      rider('rider-a', 'example.com'),
      COMMUNAL_STOPS,
      NOW,
    );
    const repeated = subject.board(
      rider('rider-a', 'other.example'),
      [],
      NOW + 10_000,
    );

    expect(repeated.trainId).toBe(first.trainId);
    expect(repeated.routeVersion).toBe(first.routeVersion);
    expect(repeated.stops).toEqual(first.stops);
  });

  it('reuses capacity after disconnected rider leases expire', () => {
    const subject = dispatcher();
    const first = subject.board(rider('rider-a'), COMMUNAL_STOPS, NOW);
    subject.board(rider('rider-b'), [], NOW);
    subject.board(rider('rider-c'), [], NOW);
    subject.board(rider('rider-d'), [], NOW);

    const replacement = subject.board(
      rider('rider-e'),
      [],
      NOW + COMMUTE_TRAIN_RIDER_LEASE_MS + 1,
    );

    expect(replacement.trainId).toBe(first.trainId);
    expect(replacement.riderCount).toBe(1);
  });

  it('keeps refreshed rider leases active', () => {
    const subject = dispatcher();
    const first = subject.board(rider('rider-a'), COMMUNAL_STOPS, NOW);

    subject.board(rider('rider-a'), [], NOW + COMMUTE_TRAIN_RIDER_LEASE_MS - 1);
    const joined = subject.board(
      rider('rider-b'),
      [],
      NOW + COMMUTE_TRAIN_RIDER_LEASE_MS + 1,
    );

    expect(joined.trainId).toBe(first.trainId);
    expect(joined.riderCount).toBe(2);
  });

  it('moves an expired rider when replacement riders fill their train', () => {
    const subject = dispatcher();
    const first = subject.board(rider('rider-a'), COMMUNAL_STOPS, NOW);
    subject.board(rider('rider-b'), [], NOW);
    subject.board(rider('rider-c'), [], NOW);
    subject.board(rider('rider-d'), [], NOW);
    const replacementsAt = NOW + COMMUTE_TRAIN_RIDER_LEASE_MS + 1;
    subject.board(rider('rider-e'), [], replacementsAt);
    subject.board(rider('rider-f'), [], replacementsAt);
    subject.board(rider('rider-g'), [], replacementsAt);
    subject.board(rider('rider-h'), [], replacementsAt);

    expect(subject.needsCommunalStops('rider-a', replacementsAt + 1)).toBe(
      true,
    );
    const moved = subject.board(
      rider('rider-a'),
      COMMUNAL_STOPS,
      replacementsAt + 1,
    );

    expect(moved.trainId).not.toBe(first.trainId);
    expect(moved.riderCount).toBe(1);
  });

  it('treats deployed rider records without leases as active', () => {
    const subject = dispatcher();
    subject.board(rider('rider-a'), COMMUNAL_STOPS, NOW);
    const state = subject.snapshot();
    delete state.trains[0].riders['rider-a'].activeUntil;

    const restored = new CommuteTrainDispatcher(state, () => 'restored-id');
    const joined = restored.board(rider('rider-b'), [], NOW + 20_000);

    expect(joined.riderCount).toBe(2);
  });

  it('boards the same rider onto a fresh train after their route completes', () => {
    const subject = dispatcher();
    const first = subject.board(rider('rider-a'), COMMUNAL_STOPS, NOW);
    const next = subject.board(
      rider('rider-a'),
      COMMUNAL_STOPS,
      first.routeEndsAt,
    );

    expect(next.trainId).not.toBe(first.trainId);
    expect(next.phase).toBe('boarding');
  });

  it('appends new domains without reordering existing stops', () => {
    const subject = dispatcher();
    const first = subject.board(
      rider('rider-a', 'a.example'),
      COMMUNAL_STOPS,
      NOW,
    );
    const second = subject.board(
      rider('rider-b', 'b.example'),
      [],
      NOW + 20_000,
    );

    expect(second.trainId).toBe(first.trainId);
    expect(second.stops.map((stop) => stop.domain)).toEqual([
      'html.energy',
      'special.fish',
      'a.example',
      'b.example',
    ]);
  });

  it('coalesces riders with the same pending domain', () => {
    const subject = dispatcher();
    subject.board(rider('rider-a', 'a.example'), COMMUNAL_STOPS, NOW);
    const assignment = subject.board(
      rider('rider-b', 'a.example'),
      [],
      NOW + 20_000,
    );

    expect(assignment.stops).toHaveLength(3);
    expect(assignment.stops[2]).toMatchObject({
      kind: 'domain',
      domain: 'a.example',
      claimantCount: 2,
    });
  });

  it('starts a new train after the previous train begins returning home', () => {
    const subject = dispatcher();
    const first = subject.board(rider('rider-a'), COMMUNAL_STOPS, NOW);
    const later = subject.board(rider('rider-b'), COMMUNAL_STOPS, NOW + 54_000);

    expect(later.trainId).not.toBe(first.trainId);
  });

  it('reports communal domains used by retained trains', () => {
    const subject = dispatcher();
    subject.board(rider('rider-a'), COMMUNAL_STOPS, NOW);

    expect(subject.getRecentCommunalDomains(NOW)).toEqual(
      new Set(['html.energy', 'special.fish']),
    );
  });

  it('deletes completed trains after the retention window', () => {
    const subject = dispatcher();
    subject.board(rider('rider-a'), COMMUNAL_STOPS, NOW);

    subject.cleanup(NOW + 124_000);

    expect(subject.snapshot().trains).toEqual([]);
  });

  it('rejects new trains at the retained-state ceiling', () => {
    const subject = dispatcher();
    const admittedRiders = MAX_RETAINED_COMMUTE_TRAINS * 4;
    const assignments = Array.from({ length: admittedRiders }, (_, index) =>
      subject.board(rider(`rider-${index}`), COMMUNAL_STOPS, NOW),
    );

    expect(subject.snapshot().trains).toHaveLength(MAX_RETAINED_COMMUTE_TRAINS);
    expect(() =>
      subject.board(rider('rider-over-capacity'), COMMUNAL_STOPS, NOW),
    ).toThrow(CommuteTrainCapacityError);
    expect(subject.board(rider('rider-0'), [], NOW + 1).trainId).toBe(
      assignments[0].trainId,
    );
    expect(subject.snapshot().trains).toHaveLength(MAX_RETAINED_COMMUTE_TRAINS);
  });
});
