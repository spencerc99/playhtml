// ABOUTME: Verifies the per-isolate timed memo used by public routes.
// ABOUTME: Covers in-flight sharing, expiry from load completion, failures, and abandoned loads.

import { describe, expect, it } from 'vitest';
import { createTimedMemo } from '../lib/timedMemo';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(ttlMs = 30_000, abandonLoadAfterMs = 20_000) {
  let clock = 0;
  let loads = 0;
  const pending: Array<ReturnType<typeof deferred<string>>> = [];
  const memo = createTimedMemo<string>({ ttlMs, abandonLoadAfterMs, now: () => clock });
  const load = () => {
    loads += 1;
    const next = deferred<string>();
    pending.push(next);
    return next.promise;
  };
  return {
    memo,
    load,
    pending,
    loads: () => loads,
    advance: (ms: number) => { clock += ms; },
  };
}

describe('createTimedMemo', () => {
  it('shares one in-flight load between concurrent callers', async () => {
    const { memo, load, pending, loads } = setup();
    const first = memo.get(load);
    const second = memo.get(load);
    expect(loads()).toBe(1);
    pending[0].resolve('route');
    await expect(Promise.all([first, second])).resolves.toEqual(['route', 'route']);
  });

  it('serves the value until the ttl after the load finished, then reloads', async () => {
    const { memo, load, pending, loads, advance } = setup();
    const first = memo.get(load);
    advance(5_000);
    pending[0].resolve('first');
    await first;

    advance(29_999);
    await expect(memo.get(load)).resolves.toBe('first');
    expect(loads()).toBe(1);

    advance(1);
    const reloaded = memo.get(load);
    expect(loads()).toBe(2);
    pending[1].resolve('second');
    await expect(reloaded).resolves.toBe('second');
  });

  it('does not cache a failed load', async () => {
    const { memo, load, pending, loads } = setup();
    const failed = memo.get(load);
    pending[0].reject(new Error('database unavailable'));
    await expect(failed).rejects.toThrow('database unavailable');

    const retried = memo.get(load);
    expect(loads()).toBe(2);
    pending[1].resolve('route');
    await expect(retried).resolves.toBe('route');
  });

  it('starts a fresh load once an in-flight load is presumed abandoned', async () => {
    const { memo, load, pending, loads, advance } = setup();
    void memo.get(load);
    advance(19_999);
    void memo.get(load);
    expect(loads()).toBe(1);

    advance(1);
    const fresh = memo.get(load);
    expect(loads()).toBe(2);
    pending[1].resolve('fresh');
    await expect(fresh).resolves.toBe('fresh');

    // The abandoned load settling later does not replace the fresh value.
    pending[0].resolve('stale');
    await pending[0].promise;
    await expect(memo.get(load)).resolves.toBe('fresh');
    expect(loads()).toBe(2);
  });

  it('clear forces the next caller to load', async () => {
    const { memo, load, pending, loads } = setup();
    const first = memo.get(load);
    pending[0].resolve('route');
    await first;
    memo.clear();
    void memo.get(load);
    expect(loads()).toBe(2);
  });
});
