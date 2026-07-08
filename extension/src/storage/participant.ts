// ABOUTME: Provides per-browser-session identity for event collection.
// ABOUTME: Uses browser session storage with an in-memory fallback where unavailable.

import browser from 'webextension-polyfill';
import { createPrefixedId } from './ids';

let fallbackSessionId: string | null = null;
let warnedAboutMissingSessionStorage = false;

const SESSION_ID_KEY = 'collection_session_id';

/**
 * Get or create session ID.
 * Uses browser.storage.session so it resets when the browser closes.
 */
export async function getSessionId(): Promise<string> {
  const sessionStorage = (
    browser.storage as unknown as { session?: typeof browser.storage.local }
  ).session;
  const supportsSessionStorage =
    typeof sessionStorage?.get === 'function' && typeof sessionStorage?.set === 'function';

  if (!supportsSessionStorage) {
    // Firefox can omit storage.session in content scripts. Keep one in-memory
    // fallback ID so event creation keeps working instead of failing per emit.
    if (!fallbackSessionId) {
      fallbackSessionId = createPrefixedId('sid_');
    }
    if (!warnedAboutMissingSessionStorage) {
      warnedAboutMissingSessionStorage = true;
      console.warn('[Participant] browser.storage.session unavailable; using in-memory session id');
    }
    return fallbackSessionId;
  }

  try {
    const result = await sessionStorage.get([SESSION_ID_KEY]);

    if (result[SESSION_ID_KEY]) {
      return result[SESSION_ID_KEY];
    }

    const sessionId = createPrefixedId('sid_');
    await sessionStorage.set({ [SESSION_ID_KEY]: sessionId });
    return sessionId;
  } catch (error) {
    console.error('Failed to get session ID:', error);
    if (!fallbackSessionId) {
      fallbackSessionId = createPrefixedId('sid_');
    }
    return fallbackSessionId;
  }
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
