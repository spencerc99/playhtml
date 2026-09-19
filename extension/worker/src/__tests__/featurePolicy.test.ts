// ABOUTME: Verifies code-defined features remain resolvable without seeded production policy rows.
// ABOUTME: Covers mutable stage overrides and cohort grants without requiring a D1 emulator.

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
      grantedFeatureIds: new Set(['BOTTLES']),
    });

    expect(features.EMOTES).toEqual({ stage: 'released', available: true });
    expect(features.BOTTLES.available).toBe(true);
    expect(resolveFeatureStage('QUARANTINE_TAPE', storedStages)).toBe('internal');
  });
});
