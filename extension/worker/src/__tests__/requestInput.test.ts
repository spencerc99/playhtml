// ABOUTME: Tests the parsers Worker routes use for untrusted path, query, and body input.
// ABOUTME: Malformed input must come back as null or not-ok so routes answer 400.

import { describe, expect, it } from 'vitest';
import {
  decodePathSegment,
  parseOptionalIsoDate,
  parseOptionalPositiveInt,
  readJsonObject,
} from '../lib/requestInput';
import { isParticipantKey } from '../lib/participantKey';

describe('decodePathSegment', () => {
  it('decodes valid escapes and returns null for broken ones', () => {
    expect(decodePathSegment('pk_04%61b')).toBe('pk_04ab');
    expect(decodePathSegment('%E0%A4%A')).toBeNull();
    expect(decodePathSegment('%')).toBeNull();
  });
});

describe('readJsonObject', () => {
  const post = (body: string) =>
    new Request('https://worker.example/', { method: 'POST', body });

  it('returns objects and rejects null, arrays, primitives, and bad JSON', async () => {
    expect(await readJsonObject(post('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJsonObject(post('null'))).toBeNull();
    expect(await readJsonObject(post('[1]'))).toBeNull();
    expect(await readJsonObject(post('"x"'))).toBeNull();
    expect(await readJsonObject(post('{'))).toBeNull();
  });
});

describe('parseOptionalIsoDate', () => {
  const params = (value: string) => new URLSearchParams({ from: value });

  it('accepts dates and ISO date-times', () => {
    expect(parseOptionalIsoDate(params('2026-11-11'), 'from')).toEqual({ ok: true, value: '2026-11-11' });
    expect(parseOptionalIsoDate(params('2026-11-11T10:00:00.000Z'), 'from').ok).toBe(true);
    expect(parseOptionalIsoDate(new URLSearchParams(), 'from')).toEqual({ ok: true, value: null });
  });

  it.each(['yesterday', '1', '2026-13-45', '2026-11-11 10:00'])('rejects %s', (value) => {
    expect(parseOptionalIsoDate(params(value), 'from')).toEqual({ ok: false });
  });
});

describe('parseOptionalPositiveInt', () => {
  const params = (value: string) => new URLSearchParams({ limit: value });

  it('accepts positive integers and absence', () => {
    expect(parseOptionalPositiveInt(params('500'), 'limit')).toEqual({ ok: true, value: 500 });
    expect(parseOptionalPositiveInt(new URLSearchParams(), 'limit')).toEqual({ ok: true, value: null });
  });

  it.each(['abc', '0', '-5', '2.5', '1e3'])('rejects %s', (value) => {
    expect(parseOptionalPositiveInt(params(value), 'limit')).toEqual({ ok: false });
  });
});

describe('isParticipantKey', () => {
  it('accepts only lowercase uncompressed P-256 public keys', () => {
    expect(isParticipantKey(`pk_04${'a'.repeat(128)}`)).toBe(true);
    expect(isParticipantKey(`pk_${'a'.repeat(130)}`)).toBe(false);
    expect(isParticipantKey(`pk_04${'A'.repeat(128)}`)).toBe(false);
    expect(isParticipantKey('pk_04abc')).toBe(false);
    expect(isParticipantKey(42)).toBe(false);
  });
});
