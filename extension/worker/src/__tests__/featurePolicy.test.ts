// ABOUTME: Verifies code-defined features remain resolvable without seeded production policy rows.
// ABOUTME: Covers mutable stage overrides, beta-stage access, and cohort grants without a D1 emulator.

import { describe, expect, it } from 'vitest';
import {
  resolveFeaturePolicies,
  resolveFeatureStage,
} from '../lib/featurePolicy';

describe('feature policy', () => {
  it('grants code-defined features to internal members without stored stages', () => {
    const features = resolveFeaturePolicies({
      storedStages: new Map(),
      grantsAllUnreleased: true,
      inBetaCohort: false,
      grantedFeatureIds: new Set(),
    });

    expect(features.QUARANTINE_TAPE).toEqual({
      stage: 'internal',
      available: true,
    });
  });

  it('keeps ungranted code-defined features unavailable to the public', () => {
    const features = resolveFeaturePolicies({
      storedStages: new Map(),
      grantsAllUnreleased: false,
      inBetaCohort: false,
      grantedFeatureIds: new Set(),
    });

    expect(features.QUARANTINE_TAPE).toEqual({
      stage: 'internal',
      available: false,
    });
  });

  it('applies stored stages and explicit cohort grants', () => {
    const storedStages = new Map<string, string>([
      ['EMOTES', 'released'],
      ['QUARANTINE_TAPE', 'invalid'],
    ]);
    const features = resolveFeaturePolicies({
      storedStages,
      grantsAllUnreleased: false,
      inBetaCohort: false,
      grantedFeatureIds: new Set(['BOTTLES']),
    });

    expect(features.EMOTES).toEqual({ stage: 'released', available: true });
    expect(features.BOTTLES.available).toBe(true);
    expect(resolveFeatureStage('QUARANTINE_TAPE', storedStages)).toBe('internal');
  });

  it('grants beta-stage features to the closed beta cohort only', () => {
    const storedStages = new Map<string, string>([
      ['EMOTES', 'beta'],
      ['BOTTLES', 'internal'],
    ]);
    const tester = resolveFeaturePolicies({
      storedStages,
      grantsAllUnreleased: false,
      inBetaCohort: true,
      grantedFeatureIds: new Set(),
    });
    const outsider = resolveFeaturePolicies({
      storedStages,
      grantsAllUnreleased: false,
      inBetaCohort: false,
      grantedFeatureIds: new Set(),
    });

    expect(tester.EMOTES).toEqual({ stage: 'beta', available: true });
    expect(tester.BOTTLES.available).toBe(false);
    expect(outsider.EMOTES.available).toBe(false);
  });
});
