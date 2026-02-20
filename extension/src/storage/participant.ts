import browser from 'webextension-polyfill';

const PARTICIPANT_ID_KEY = 'collection_participant_id';
const SESSION_ID_KEY = 'collection_session_id';

/**
 * Generate a random anonymous participant ID
 * This ID persists across browser sessions but is anonymous
 */
function generateParticipantId(): string {
  // Generate a random string (similar to ULID but simpler)
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `pid_${timestamp}_${random}`;
}

/**
 * Generate a session ID (unique per browser session)
 */
function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 15);
  return `sid_${timestamp}_${random}`;
}

/**
 * Get or create participant ID
 * This ID is persistent and anonymous
 */
export async function getParticipantId(): Promise<string> {
  try {
    const result = await browser.storage.local.get([PARTICIPANT_ID_KEY]);
    
    if (result[PARTICIPANT_ID_KEY]) {
      return result[PARTICIPANT_ID_KEY];
    }
    
    // Generate new participant ID
    const participantId = generateParticipantId();
    await browser.storage.local.set({ [PARTICIPANT_ID_KEY]: participantId });
    
    return participantId;
  } catch (error) {
    console.error('Failed to get participant ID:', error);
    // Fallback to in-memory ID if storage fails
    return generateParticipantId();
  }
}

/**
 * Get or create session ID
 * This ID is unique per browser session
 */
export async function getSessionId(): Promise<string> {
  try {
    const result = await browser.storage.local.get([SESSION_ID_KEY]);
    
    if (result[SESSION_ID_KEY]) {
      return result[SESSION_ID_KEY];
    }
    
    // Generate new session ID
    const sessionId = generateSessionId();
    await browser.storage.local.set({ [SESSION_ID_KEY]: sessionId });
    
    return sessionId;
  } catch (error) {
    console.error('Failed to get session ID:', error);
    // Fallback to in-memory ID if storage fails
    return generateSessionId();
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
