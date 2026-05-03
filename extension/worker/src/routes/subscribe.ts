// ABOUTME: Handles POST /subscribe — adds an email to the Resend Audience and sends welcome on first signup.
// ABOUTME: Public endpoint, validated and rate-limited; never logs or stores anything beyond email + source.

import { createResendClient, type SignupSource } from '../lib/resend';
import type { Env } from '../lib/supabase';
import { VERBOSE } from '../config';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SOURCES: SignupSource[] = ['website', 'extension-setup'];

const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60_000;
// Hard cap on the in-memory map. Workers isolates are short-lived so this
// rarely matters, but a long-lived isolate seeing 100k unique IPs would
// otherwise grow ipHits unboundedly. When we hit the cap, drop the oldest
// half to keep the most recent activity.
const RATE_LIMIT_MAX_TRACKED_IPS = 10_000;
const ipHits = new Map<string, number[]>();

function rateLimited(ip: string, now: number): boolean {
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const hits = (ipHits.get(ip) || []).filter((t) => t > cutoff);
  if (hits.length >= RATE_LIMIT_MAX) {
    ipHits.set(ip, hits);
    return true;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  if (ipHits.size > RATE_LIMIT_MAX_TRACKED_IPS) {
    // Drop oldest entries (Map iteration is insertion-ordered).
    const toDrop = Math.floor(RATE_LIMIT_MAX_TRACKED_IPS / 2);
    let i = 0;
    for (const key of ipHits.keys()) {
      if (i++ >= toDrop) break;
      ipHits.delete(key);
    }
  }
  return false;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

interface SubscribeBody {
  email?: unknown;
  source?: unknown;
}

export async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (rateLimited(ip, Date.now())) {
    return jsonResponse(429, { error: 'Too many requests. Try again in a minute.' });
  }

  let body: SubscribeBody;
  try {
    body = (await request.json()) as SubscribeBody;
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body' });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_REGEX.test(email)) {
    return jsonResponse(400, { error: 'Invalid email address' });
  }

  const source = body.source as string;
  if (!VALID_SOURCES.includes(source as SignupSource)) {
    return jsonResponse(400, { error: 'Invalid or missing source' });
  }

  const resend = createResendClient({
    apiKey: env.RESEND_API_KEY,
    segmentId: env.RESEND_SEGMENT_ID,
  });

  let result: { created: boolean };
  try {
    result = await resend.addContact(email, source as SignupSource);
  } catch (err) {
    console.error('[Subscribe] addContact failed:', err);
    return jsonResponse(503, { error: 'Email service temporarily unavailable' });
  }

  if (result.created) {
    try {
      await resend.sendWelcomeEmail(email);
    } catch (err) {
      // Contact was created; welcome failed. Log but return success — the
      // user is on the list, and we'd rather not double-charge them with
      // a retry that creates duplicate entries.
      console.error('[Subscribe] sendWelcomeEmail failed:', err);
    }
  }

  if (VERBOSE) {
    console.log(`[Subscribe] ${email} (${source}) — created=${result.created}`);
  }

  return jsonResponse(200, { ok: true, alreadySubscribed: !result.created });
}

// Exported for tests that want to clear in-memory rate-limit state between cases.
export function __resetRateLimitForTests(): void {
  ipHits.clear();
}
