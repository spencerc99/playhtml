import browser from 'webextension-polyfill';
import type { CollectionEvent } from '../collectors/types';
import { VERBOSE } from '../config';

const STORAGE_KEYS = {
  WORKER_URL: 'collection_worker_url',
};

/**
 * Production worker URL
 */
const PROD_WORKER_URL = 'https://playhtml-game-api.spencerc99.workers.dev';

/**
 * Development worker URL (localhost)
 * Run with: cd packages/extension/worker && wrangler dev
 */
const DEV_WORKER_URL = 'http://localhost:8787';

/**
 * Detect if we're in development mode
 * Checks build environment (WXT sets this when running `wxt dev`)
 */
function isDevelopment(): boolean {
  try {
    // Check build mode (WXT sets this when running `wxt dev`)
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      const isDev = import.meta.env.DEV === true || import.meta.env.MODE === 'development';
      if (isDev) {
        console.log('[Sync] Development mode detected from build environment');
      }
      return isDev;
    }
    
    return false;
  } catch (error) {
    console.error('[Sync] Error detecting development mode:', error);
    return false;
  }
}

/**
 * Get worker URL
 * Uses localhost in development, production URL otherwise
 * Can be overridden via storage if needed
 */
async function getWorkerUrl(): Promise<string> {
  try {
    // Check if custom URL is set in storage (for testing/override - highest priority)
    const result = await browser.storage.local.get([STORAGE_KEYS.WORKER_URL]);
    if (result[STORAGE_KEYS.WORKER_URL]) {
      const customUrl = result[STORAGE_KEYS.WORKER_URL];
      console.log('[Sync] Using custom worker URL from storage:', customUrl);
      return customUrl;
    }
    
    // Use dev URL if in development mode
    const isDev = isDevelopment();
    if (isDev) {
      console.log('[Sync] Using development worker URL:', DEV_WORKER_URL);
      console.log('[Sync] Make sure wrangler dev is running: cd packages/extension/worker && wrangler dev');
      return DEV_WORKER_URL;
    }
    
    console.log('[Sync] Using production worker URL:', PROD_WORKER_URL);
    return PROD_WORKER_URL;
  } catch (error) {
    console.error('[Sync] Error getting worker URL:', error);
    // Fallback to production
    console.log('[Sync] Falling back to production worker URL:', PROD_WORKER_URL);
    return PROD_WORKER_URL;
  }
}

/**
 * Upload events to Cloudflare Worker API
 * 
 * The ingest endpoint is public (no auth required) because:
 * - Extension code is client-side, so any API key would be visible
 * - The worker validates event structure and applies rate limits
 * - The data is anonymous cursor movements (low abuse risk)
 */
export async function uploadEvents(events: CollectionEvent[]): Promise<void> {
  if (events.length === 0) {
    return;
  }
  
  const workerUrl = await getWorkerUrl();
  
  try {
    const response = await fetch(`${workerUrl}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      // If it's a 500 error, it might have partially succeeded
      // But we'll still throw to be safe - upsert handles duplicates
      throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    const inserted = result.inserted || 0;
    const duplicates = result.duplicates || 0;
    
    if (VERBOSE) {
      if (duplicates > 0) {
        console.log(`[Sync] Uploaded ${inserted} new events, ${duplicates} duplicates (already existed)`);
      } else {
        console.log(`[Sync] Uploaded ${inserted} events`);
      }
    }
  } catch (error) {
    console.error('[Sync] Failed to upload events to', workerUrl, ':', error);
    
    // If using a non-existent URL (like localhost:9999), don't retry - it's disabled for testing
    if (workerUrl.includes('localhost:9999')) {
      console.log('[Sync] Uploads disabled for testing - events stored locally only');
      return; // Don't throw, so EventBuffer doesn't retry
    }
    
    // If using localhost:8787 and it fails, provide helpful message
    if (workerUrl.includes('localhost:8787')) {
      console.warn('[Sync] Local worker not responding. Make sure wrangler dev is running:');
      console.warn('[Sync]   cd packages/extension/worker && wrangler dev');
      // Still throw so EventBuffer can retry when worker comes online
    }
    
    // Note: Even if this throws, the server might have received and inserted the events
    // The upsert with ignoreDuplicates handles this gracefully
    throw error; // Re-throw so EventBuffer can retry
  }
}

/**
 * Set worker URL (for configuration)
 */
export async function setWorkerUrl(url: string): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEYS.WORKER_URL]: url });
}

/**
 * Get current configuration
 */
export async function getConfig(): Promise<{ workerUrl: string }> {
  const workerUrl = await getWorkerUrl();
  return { workerUrl };
}

