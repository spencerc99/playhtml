// ABOUTME: Handles POST /subscribe by adding signup emails to Resend.
// ABOUTME: Public endpoint, validated and rate-limited; sends email based on signup source.

import { createResendClient, type SignupSource } from '../lib/resend';
import type { Env } from '../lib/supabase';
import { createIpRateLimiter } from '../lib/ipRateLimit';
import { VERBOSE } from '../config';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_SOURCES: SignupSource[] = ['website', 'extension-setup'];

const rateLimiter = createIpRateLimiter(5, 60_000);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

interface SubscribeBody {
  email?: unknown;
  source?: unknown;
}

export async function handleSubscribe(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  if (rateLimiter.isLimited(ip, Date.now())) {
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
  const signupSource = source as SignupSource;

  const resend = createResendClient({
    apiKey: env.RESEND_API_KEY,
    segmentId: env.RESEND_SEGMENT_ID,
  });

  let result: { created: boolean };
  try {
    result = await resend.addContact(email, signupSource);
  } catch (err) {
    console.error('[Subscribe] addContact failed:', err);
    return jsonResponse(503, { error: 'Email service temporarily unavailable' });
  }

  if (signupSource === 'website') {
    try {
      await resend.sendWelcomeEmail(email);
    } catch (err) {
      console.error('[Subscribe] sendWelcomeEmail failed:', err);
      return jsonResponse(503, { error: 'Email service temporarily unavailable' });
    }
  } else {
    try {
      await resend.sendUpdatesEmail(email);
    } catch (err) {
      console.error('[Subscribe] sendUpdatesEmail failed:', err);
      return jsonResponse(503, { error: 'Email service temporarily unavailable' });
    }
  }

  if (VERBOSE) {
    console.log(`[Subscribe] ${email} (${signupSource}) — created=${result.created}`);
  }

  return jsonResponse(200, { ok: true, alreadySubscribed: !result.created });
}

// Exported for tests that want to clear in-memory rate-limit state between cases.
export function __resetRateLimitForTests(): void {
  rateLimiter.reset();
}
