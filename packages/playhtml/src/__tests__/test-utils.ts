// ABOUTME: Helpers for tests that need to reach into the FakeProvider mock.
// ABOUTME: Provides typed access to the instance list set up in vitest.setup.ts.

interface FakeProvider {
  emit(event: string, ...args: unknown[]): void;
  sendMessage: (...args: unknown[]) => void;
  synced: boolean;
  on(event: string, cb: (...args: unknown[]) => void): void;
}

function allFakeProviders(): FakeProvider[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((globalThis as any).__playhtmlFakeProviders as FakeProvider[]) ?? [];
}

/**
 * Returns the most recently created FakeProvider. In tests that create
 * multiple providers (e.g. a page provider and a room provider), this is
 * the last one constructed — typically the one just created by the unit
 * under test. For multi-provider tests, prefer captureNextProvider().
 */
export function latestFakeProvider(): FakeProvider {
  const list = allFakeProviders();
  const last = list[list.length - 1];
  if (!last) throw new Error("No FakeProvider has been constructed yet");
  return last;
}

/**
 * Runs `fn`, then returns the provider that was constructed during that
 * invocation. Use when a test creates a new provider and wants to drive
 * it without worrying about earlier providers in the process.
 */
export function captureNextProvider<T>(fn: () => T): { provider: FakeProvider; result: T } {
  const before = allFakeProviders().length;
  const result = fn();
  const after = allFakeProviders();
  const provider = after[before];
  if (!provider) throw new Error("No new FakeProvider was constructed by fn");
  return { provider, result };
}
