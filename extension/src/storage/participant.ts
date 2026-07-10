// ABOUTME: Provides the background-owned browser session ID for event collection.
// ABOUTME: Coordinates content scripts through messaging with an in-memory fallback.

import browser from 'webextension-polyfill';
import { createPrefixedId } from './ids';

let fallbackSessionId: string | null = null;
let sessionIdPromise: Promise<string> | null = null;

const SESSION_ID_KEY = 'collection_session_id';

async function readOrCreateSessionId(): Promise<string> {
  const sessionStorage = (browser.storage as unknown as {
    session?: Pick<typeof browser.storage.local, 'get' | 'set'>;
  }).session;

  try {
    if (!sessionStorage) {
      throw new Error('browser.storage.session unavailable');
    }

    const result = await sessionStorage.get([SESSION_ID_KEY]);

    if (typeof result[SESSION_ID_KEY] === 'string') {
      return result[SESSION_ID_KEY];
    }

    const sessionId = createPrefixedId('sid_');
    await sessionStorage.set({ [SESSION_ID_KEY]: sessionId });
    return sessionId;
  } catch (error) {
    console.error('[Participant] Failed to access browser session storage:', error);
    if (!fallbackSessionId) {
      fallbackSessionId = createPrefixedId('sid_');
    }
    return fallbackSessionId;
  }
}

/**
 * Get or create the background-owned browser session ID.
 * Uses browser.storage.session so it resets when the browser closes.
 */
export function getSessionId(): Promise<string> {
  if (!sessionIdPromise) {
    sessionIdPromise = readOrCreateSessionId();
  }
  return sessionIdPromise;
}

/**
 * Request the browser session ID from the background context.
 */
export async function requestSessionId(): Promise<string> {
  const sessionId = await browser.runtime.sendMessage({ type: 'GET_SESSION_ID' });
  if (typeof sessionId !== 'string' || !sessionId.startsWith('sid_')) {
    throw new Error('Background returned an invalid session ID');
  }
  return sessionId;
}

/**
 * Get timezone string (e.g., "America/New_York")
 */
export function getTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}
