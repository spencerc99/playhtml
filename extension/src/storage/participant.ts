// ABOUTME: Provides participant and session identity for event collection
// ABOUTME: Participant ID is the ECDSA public key from playerIdentity; session ID resets per browser session

import browser from 'webextension-polyfill';

/**
 * Get participant ID (the ECDSA public key from playerIdentity).
 * Falls back to generating a temporary random ID if identity isn't initialized yet.
 */
export async function getParticipantId(): Promise<string> {
  try {
    const result = await browser.storage.local.get(['playerIdentity']);
    if (result.playerIdentity?.publicKey) {
      return result.playerIdentity.publicKey;
    }

    // Identity not yet initialized — generate temporary ID.
    // This should only happen in a race condition before background.ts runs.
    console.warn('[Participant] playerIdentity not found, using temporary ID');
    return 'pk_temp_' + crypto.randomUUID();
  } catch (error) {
    console.error('Failed to get participant ID:', error);
    return 'pk_temp_' + crypto.randomUUID();
  }
}

const SESSION_ID_KEY = 'collection_session_id';

/**
 * Get or create session ID.
 * Uses browser.storage.session so it resets when the browser closes.
 */
export async function getSessionId(): Promise<string> {
  try {
    const result = await browser.storage.session.get([SESSION_ID_KEY]);

    if (result[SESSION_ID_KEY]) {
      return result[SESSION_ID_KEY];
    }

    const sessionId = 'sid_' + crypto.randomUUID();
    await browser.storage.session.set({ [SESSION_ID_KEY]: sessionId });
    return sessionId;
  } catch (error) {
    console.error('Failed to get session ID:', error);
    return 'sid_' + crypto.randomUUID();
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
