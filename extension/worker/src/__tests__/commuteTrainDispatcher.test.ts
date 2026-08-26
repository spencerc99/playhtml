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

function rider(
  riderToken: string,
  domain?: string,
): CommuteTrainBoardRequest {
  return {
    riderToken,
    requestedStop: domain
      ? { kind: 'domain', domain }
      : { kind: 'none' },
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

    expect(new Set(assignments.map((assignment) => assignment.trainId)).size).toBe(25);
    expect(Math.max(...assignments.map((assignment) => assignment.riderCount))).toBe(4);
  });

  it('returns the same assignment for an idempotent rider request', () => {
    const subject = dispatcher();
    const first = subject.board(rider('rider-a', 'example.com'), COMMUNAL_STOPS, NOW);
    const repeated = subject.board(rider('rider-a', 'other.example'), [], NOW + 10_000);

    expect(repeated.trainId).toBe(first.trainId);
    expect(repeated.routeVersion).toBe(first.routeVersion);
    expect(repeated.stops).toEqual(first.stops);
  });

  it('appends new domains without reordering existing stops', () => {
    const subject = dispatcher();
    const first = subject.board(rider('rider-a', 'a.example'), COMMUNAL_STOPS, NOW);
    const second = subject.board(rider('rider-b', 'b.example'), [], NOW + 20_000);

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
    expect(
      subject.board(rider('rider-0'), [], NOW + 1).trainId,
    ).toBe(assignments[0].trainId);
    expect(subject.snapshot().trains).toHaveLength(MAX_RETAINED_COMMUTE_TRAINS);
  });
});
