// ABOUTME: Handles popup feedback submissions and adds them to the Coda triage table.
// ABOUTME: Public endpoint with bounded input validation and per-IP rate limiting.

import { createIpRateLimiter } from '../lib/ipRateLimit';
import type { Env } from '../lib/supabase';

const CODA_ROWS_URL =
  'https://coda.io/apis/v1/docs/_zKy9BTw1m/tables/grid-wsf3jOpRC3/rows';
const MAX_FEEDBACK_LENGTH = 4000;
const MAX_VERSION_LENGTH = 50;
const MAX_BROWSER_LENGTH = 500;

const COLUMN_IDS = {
  feedback: 'c-pXnSC1ZoEI',
  status: 'c-rHstNuQ2MN',
  type: 'c-nnuwiW7Ue4',
  extensionVersion: 'c-Pz-CBsMdC_',
  browser: 'c-sb6OLuDn_A',
  source: 'c-DL0lexYSPt',
} as const;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const rateLimiter = createIpRateLimiter(5, 60_000);

interface FeedbackBody {
  message?: unknown;
  extensionVersion?: unknown;
  browser?: unknown;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function optionalString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export async function handleFeedback(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (rateLimiter.isLimited(ip, Date.now())) {
    return jsonResponse(429, { error: 'Too many requests. Try again in a minute.' });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const feedbackBody = body as FeedbackBody;

  const message =
    typeof feedbackBody.message === 'string' ? feedbackBody.message.trim() : '';
  if (!message) {
    return jsonResponse(400, { error: 'Feedback is required' });
  }
  if (message.length > MAX_FEEDBACK_LENGTH) {
    return jsonResponse(400, { error: 'Feedback is too long' });
  }

  const extensionVersion = optionalString(
    feedbackBody.extensionVersion,
    MAX_VERSION_LENGTH,
  );
  const browser = optionalString(feedbackBody.browser, MAX_BROWSER_LENGTH);
  const codaBody = {
    rows: [
      {
        cells: [
          { column: COLUMN_IDS.feedback, value: message },
          { column: COLUMN_IDS.status, value: 'New' },
          { column: COLUMN_IDS.type, value: 'Untriaged' },
          { column: COLUMN_IDS.extensionVersion, value: extensionVersion },
          { column: COLUMN_IDS.browser, value: browser },
          { column: COLUMN_IDS.source, value: 'extension-popup' },
        ],
      },
    ],
  };

  try {
    const response = await fetch(CODA_ROWS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CODA_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(codaBody),
    });
    if (!response.ok) {
      throw new Error(`Coda returned ${response.status}`);
    }
  } catch (error) {
    console.error('[Feedback] Coda submission failed:', error);
    return jsonResponse(503, { error: 'Feedback service temporarily unavailable' });
  }

  return jsonResponse(200, { ok: true });
}

export function __resetRateLimitForTests(): void {
  rateLimiter.reset();
}
