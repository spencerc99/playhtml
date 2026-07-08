// ABOUTME: Provides participant and session identity for event collection
// ABOUTME: Participant ID is the ECDSA public key from playerIdentity; session ID resets per browser session

import browser from 'webextension-polyfill';
import { getPublicPlayerIdentity } from './playerIdentity';

let fallbackSessionId: string | null = null;
let warnedAboutMissingSessionStorage = false;

function createUuidLikeId(): string {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto?.getRandomValues === 'function') {
    // RFC4122 v4-compatible fallback for browsers missing crypto.randomUUID.
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last-resort fallback for unusual runtimes without Web Crypto.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createPrefixedId(prefix: string): string {
  return `${prefix}${createUuidLikeId()}`;
}

/**
 * Get participant ID (the ECDSA public key from playerIdentity).
 * Falls back to generating a temporary random ID if identity isn't initialized yet.
 */
export async function getParticipantId(): Promise<string> {
  try {
    const identity = await getPublicPlayerIdentity();
    if (identity?.publicKey) {
      return identity.publicKey;
    }

    // Identity not yet initialized — generate temporary ID.
    // This should only happen in a race condition before background.ts runs.
    console.warn('[Participant] playerIdentity not found, using temporary ID');
    return createPrefixedId('pk_temp_');
  } catch (error) {
    console.error('Failed to get participant ID:', error);
    return createPrefixedId('pk_temp_');
  }
}

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
