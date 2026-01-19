import type { CollectionEvent } from '../collectors/types';

/**
 * Configuration for the sync service
 * Worker URL should be set via environment or config
 */
const WORKER_URL = process.env.COLLECTION_WORKER_URL || 
  'https://collection-api.example.workers.dev';

/**
 * API key for authenticating with the worker
 * This should be stored securely (not in code)
 */
const API_KEY = process.env.COLLECTION_API_KEY || '';

/**
 * Upload events to Cloudflare Worker API
 */
export async function uploadEvents(events: CollectionEvent[]): Promise<void> {
  if (events.length === 0) {
    return;
  }
  
  try {
    const response = await fetch(`${WORKER_URL}/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({ events }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upload failed: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    console.log(`Uploaded ${result.inserted || events.length} events`);
  } catch (error) {
    console.error('Failed to upload events:', error);
    throw error; // Re-throw so EventBuffer can retry
  }
}

/**
 * Get worker URL (can be configured via storage)
 */
export async function getWorkerUrl(): Promise<string> {
  // In the future, this could read from browser.storage
  // For now, use the default
  return WORKER_URL;
}

/**
 * Set worker URL (for configuration)
 */
export async function setWorkerUrl(url: string): Promise<void> {
  // Store in browser.storage.local for persistence
  // Implementation can be added later if needed
  console.log('Worker URL would be set to:', url);
}
