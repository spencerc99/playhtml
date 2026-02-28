# Participant Identity + Session-Hue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the disconnected pid/publicKey identity systems with a single ECDSA P-256 keypair, store participant cursor colors server-side, and derive time-based trail colors from the participant's chosen color.

**Architecture:** Extension generates an ECDSA keypair on install (public key = participant ID everywhere). A new `participants` table in Supabase stores cursor color. The worker hydrates cursor color into event responses. The movement visualization derives per-trail colors from the participant's base color + event timestamp using a minute-faces-inspired time-of-day model.

**Tech Stack:** Web Crypto API (ECDSA P-256), Supabase (Postgres), Cloudflare Workers, React

**Design doc:** `internal-docs/2026-02-27-participant-identity-design.md`

---

### Task 1: Create participants table migration

**Files:**
- Create: `extension/supabase/migrations/002_participants.sql`

**Step 1: Write migration SQL**

```sql
-- Participant identity and preferences
-- Keyed by ECDSA P-256 public key hex (prefixed 'pk_')

CREATE TABLE IF NOT EXISTS participants (
  pid TEXT PRIMARY KEY,
  cursor_color TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_participants_updated
  ON participants (updated_at DESC);

COMMENT ON TABLE participants IS 'Participant identity and display preferences';
COMMENT ON COLUMN participants.pid IS 'ECDSA P-256 public key hex, prefixed pk_';
COMMENT ON COLUMN participants.cursor_color IS 'Hex color string chosen by participant';
```

**Step 2: Apply migration to Supabase**

Run the SQL in Supabase dashboard or via CLI. Verify the table exists.

**Step 3: Commit**

```bash
git add extension/supabase/migrations/002_participants.sql
git commit -m "Add participants table migration"
```

---

### Task 2: ECDSA keypair generation in background.ts

**Files:**
- Modify: `extension/src/entrypoints/background.ts` (lines 53-92, the identity init + key generation functions)

**Step 1: Replace key generation with ECDSA P-256**

Replace `generatePublicKey()` and `generatePrivateKey()` with:

```ts
async function generateEcdsaKeypair(): Promise<{ publicKey: string; privateKey: JsonWebKey }> {
  const keypair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );

  const pubRaw = await crypto.subtle.exportKey('raw', keypair.publicKey);
  const pubHex = 'pk_' + Array.from(new Uint8Array(pubRaw))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const privJwk = await crypto.subtle.exportKey('jwk', keypair.privateKey);

  return { publicKey: pubHex, privateKey: privJwk };
}
```

**Step 2: Detect old-format keys and auto-upgrade**

An ECDSA P-256 raw public key is 65 bytes (uncompressed) = 130 hex chars + `pk_` prefix = 133 chars. Old keys are `pk_` + ~13 random chars. Check length:

```ts
function isOldFormatKey(publicKey: string): boolean {
  return !publicKey.startsWith('pk_') || publicKey.length < 100;
}
```

**Step 3: Update `initializePlayerIdentity()` to use ECDSA and auto-upgrade**

```ts
async function initializePlayerIdentity() {
  try {
    const existing = await browser.storage.local.get(['playerIdentity']);

    if (existing.playerIdentity && !isOldFormatKey(existing.playerIdentity.publicKey)) {
      return; // Valid ECDSA key, nothing to do
    }

    // Generate new ECDSA keypair (fresh install or upgrading old key)
    const { publicKey, privateKey } = await generateEcdsaKeypair();

    const identity = {
      publicKey,
      privateKey,
      playerStyle: existing.playerIdentity?.playerStyle ?? {
        colorPalette: [randomHslColor()],
        animationStyle: 'gentle' as const,
        interactionPatterns: []
      },
      createdAt: existing.playerIdentity?.createdAt ?? Date.now(),
      discoveredSites: existing.playerIdentity?.discoveredSites ?? []
    };

    await browser.storage.local.set({ playerIdentity: identity });

    // Clear legacy participant ID key so getParticipantId() reads from playerIdentity
    await browser.storage.local.remove('collection_participant_id');
  } catch (error) {
    console.error('Failed to initialize player identity:', error);
  }
}
```

**Step 4: Remove old `generatePublicKey()` and `generatePrivateKey()` functions**

Delete lines ~86-92 (the old `Math.random` key generators).

**Step 5: Build extension to verify compilation**

Run: `cd extension && bun run build`
Expected: Clean build, no type errors.

**Step 6: Commit**

```bash
git add extension/src/entrypoints/background.ts
git commit -m "Replace identity keys with ECDSA P-256 keypair"
```

---

### Task 3: Unify participant ID to read from playerIdentity

**Files:**
- Modify: `extension/src/storage/participant.ts`

**Step 1: Rewrite `getParticipantId()` to read publicKey from playerIdentity**

```ts
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
```

**Step 2: Fix session ID to use `browser.storage.session`**

```ts
/**
 * Get or create session ID.
 * Uses browser.storage.session so it resets when the browser closes.
 */
export async function getSessionId(): Promise<string> {
  const SESSION_ID_KEY = 'collection_session_id';
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
```

**Step 3: Keep `getTimezone()` unchanged**

No changes needed.

**Step 4: Remove old constants and `generateParticipantId()`/`generateSessionId()` functions**

Delete `PARTICIPANT_ID_KEY`, `SESSION_ID_KEY` (the module-level one for local storage), `generateParticipantId()`, and `generateSessionId()`.

**Step 5: Build and verify**

Run: `cd extension && bun run build`
Expected: Clean build.

**Step 6: Run existing tests**

Run: `cd extension && bun test`
Expected: Tests may need updates if they mock `getParticipantId`. Fix any failures.

**Step 7: Commit**

```bash
git add extension/src/storage/participant.ts
git commit -m "Unify participant ID to ECDSA public key, fix session ID lifecycle"
```

---

### Task 4: Worker PUT /participants/:pid endpoint

**Files:**
- Create: `extension/worker/src/routes/participants.ts`
- Modify: `extension/worker/src/index.ts`

**Step 1: Create participants route handler**

Create `extension/worker/src/routes/participants.ts`:

```ts
// ABOUTME: Handles participant profile upserts
// ABOUTME: Public endpoint for syncing participant cursor color to Supabase

import { createSupabaseClient, type Env } from '../lib/supabase';

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const HSL_COLOR_REGEX = /^hsl\(\s*\d{1,3}\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*\)$/;

function isValidColor(color: string): boolean {
  return HEX_COLOR_REGEX.test(color) || HSL_COLOR_REGEX.test(color);
}

function isValidPid(pid: string): boolean {
  return pid.startsWith('pk_') && pid.length > 10;
}

/**
 * PUT /participants/:pid
 * Upsert participant profile (cursor color).
 * Public endpoint — validated but no auth required.
 */
export async function handleParticipantUpsert(
  request: Request,
  env: Env,
  pid: string,
): Promise<Response> {
  try {
    if (!isValidPid(pid)) {
      return new Response(
        JSON.stringify({ error: 'Invalid participant ID format' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const body = await request.json() as Record<string, unknown>;
    const cursorColor = body.cursor_color;

    if (typeof cursorColor !== 'string' || !isValidColor(cursorColor)) {
      return new Response(
        JSON.stringify({ error: 'Invalid or missing cursor_color (expected hex like #4a9a8a or hsl)' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const supabase = createSupabaseClient(env);

    const { error } = await supabase
      .from('participants')
      .upsert(
        {
          pid,
          cursor_color: cursorColor,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'pid' }
      );

    if (error) {
      console.error('Participant upsert error:', error);
      return new Response(
        JSON.stringify({ error: 'Failed to save participant', details: error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (error) {
    console.error('Participant upsert error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
```

**Step 2: Wire route in worker index**

In `extension/worker/src/index.ts`, add import and route. The CORS preflight also needs PUT in allowed methods:

```ts
import { handleParticipantUpsert } from './routes/participants';
```

Add route matching (before the 404):

```ts
// Match PUT /participants/:pid
const participantMatch = path.match(/^\/participants\/(.+)$/);
if (participantMatch && request.method === 'PUT') {
  return handleParticipantUpsert(request, env, decodeURIComponent(participantMatch[1]));
}
```

Update CORS preflight to include PUT:

```ts
'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
```

**Step 3: Build worker**

Run: `cd extension/worker && bun run build` (or `npx wrangler deploy --dry-run`)
Expected: Clean build.

**Step 4: Commit**

```bash
git add extension/worker/src/routes/participants.ts extension/worker/src/index.ts
git commit -m "Add PUT /participants/:pid endpoint for cursor color sync"
```

---

### Task 5: Hydrate cursor_color in GET /events/recent

**Files:**
- Modify: `extension/worker/src/routes/recent.ts`

**Step 1: After fetching events, look up participant colors**

After the pagination loop (after `const rows = allRows.slice(0, limit);`), add a bulk participant lookup:

```ts
// Look up cursor colors for all participants in this result set
const participantIds = [...new Set(rows.map((row) => row.participant_id as string))];
const participantColors = new Map<string, string>();

if (participantIds.length > 0) {
  const { data: participants } = await supabase
    .from('participants')
    .select('pid, cursor_color')
    .in('pid', participantIds);

  if (participants) {
    for (const p of participants) {
      participantColors.set(p.pid, p.cursor_color);
    }
  }
}
```

**Step 2: Hydrate cursor_color into event meta during transform**

Update the `events` mapping to include `cursor_color`:

```ts
const events: CollectionEvent[] = rows.map((row: Record<string, unknown>) => ({
  id: row.id as string,
  type: row.type as CollectionEvent['type'],
  ts: new Date(row.ts as string).getTime(),
  data: row.data as CollectionEvent['data'],
  meta: {
    pid: row.participant_id,
    sid: row.session_id,
    url: row.url,
    vw: row.viewport_width,
    vh: row.viewport_height,
    tz: row.timezone,
    cursor_color: participantColors.get(row.participant_id as string) ?? null,
  } as EventMeta,
}));
```

**Step 3: Add cursor_color to EventMeta type**

In `extension/src/shared/types.ts`, add the optional field:

```ts
export interface EventMeta {
  sid: string;
  pid: string;
  url: string;
  vw: number;
  vh: number;
  tz: string;
  cursor_color?: string | null;  // Hydrated by server from participants table
}
```

**Step 4: Build worker and extension**

Run: `cd extension/worker && bun run build && cd .. && bun run build`
Expected: Clean builds.

**Step 5: Commit**

```bash
git add extension/worker/src/routes/recent.ts extension/src/shared/types.ts
git commit -m "Hydrate participant cursor_color into event responses"
```

---

### Task 6: Extension syncs cursor color to server

**Files:**
- Modify: `extension/src/storage/sync.ts` (add participant sync helper)
- Modify: `extension/src/components/SetupPage.tsx` (sync after save)
- Modify: `extension/src/entrypoints/background.ts` (sync on startup)

**Step 1: Add `syncParticipantColor` to sync.ts**

Add after the existing `uploadEvents` function:

```ts
/**
 * Sync participant cursor color to the server.
 * Fire-and-forget — failures are logged but don't block.
 */
export async function syncParticipantColor(pid: string, cursorColor: string): Promise<void> {
  try {
    const workerUrl = await getWorkerUrl();
    const response = await fetch(`${workerUrl}/participants/${encodeURIComponent(pid)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursor_color: cursorColor }),
    });

    if (!response.ok) {
      console.warn('[Sync] Failed to sync participant color:', response.status);
    }
  } catch (error) {
    console.warn('[Sync] Failed to sync participant color:', error);
  }
}
```

**Step 2: Call sync from SetupPage after saving identity**

In `extension/src/components/SetupPage.tsx`, in the `applyConsent` function, after `await browser.storage.local.set({ playerIdentity })` succeeds, add:

```ts
import { syncParticipantColor } from '../storage/sync';
import { getParticipantId } from '../storage/participant';

// ... inside applyConsent, after playerIdentity is saved:
try {
  const pid = await getParticipantId();
  syncParticipantColor(pid, color); // fire-and-forget, no await
} catch {}
```

**Step 3: Sync on background startup**

In `extension/src/entrypoints/background.ts`, after `initializePlayerIdentity()` completes, add a sync call:

```ts
import { syncParticipantColor } from '../storage/sync';

// After initializePlayerIdentity() in the onInstalled or startup flow:
async function syncIdentityToServer() {
  try {
    const { playerIdentity } = await browser.storage.local.get(['playerIdentity']);
    if (!playerIdentity?.publicKey || !playerIdentity.playerStyle?.colorPalette?.[0]) return;
    syncParticipantColor(playerIdentity.publicKey, playerIdentity.playerStyle.colorPalette[0]);
  } catch {}
}
```

Call this after identity init. It's fire-and-forget.

**Step 4: Build**

Run: `cd extension && bun run build`
Expected: Clean build.

**Step 5: Commit**

```bash
git add extension/src/storage/sync.ts extension/src/components/SetupPage.tsx extension/src/entrypoints/background.ts
git commit -m "Sync participant cursor color to server on setup and startup"
```

---

### Task 7: One-time migration script for existing events

**Files:**
- Create: `extension/worker/scripts/migrate-participant-id.ts`

**Step 1: Write migration script**

This script updates all `collection_events` rows with old `pid_*` participant IDs to Spencer's new ECDSA public key. It needs to be run once after Spencer's extension generates the new key.

```ts
// ABOUTME: One-time migration to rewrite old pid_* participant IDs to ECDSA public key
// ABOUTME: Run manually after extension generates new keypair

// Usage: SUPABASE_URL=... SUPABASE_SECRET_KEY=... NEW_PID=pk_04a3... bun run scripts/migrate-participant-id.ts

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const NEW_PID = process.env.NEW_PID;

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !NEW_PID) {
  console.error('Required: SUPABASE_URL, SUPABASE_SECRET_KEY, NEW_PID');
  process.exit(1);
}

if (!NEW_PID.startsWith('pk_') || NEW_PID.length < 100) {
  console.error('NEW_PID does not look like an ECDSA public key (expected pk_ + ~130 hex chars)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

async function migrate() {
  // Find all distinct old-format participant IDs
  const { data: oldPids, error: queryError } = await supabase
    .rpc('get_distinct_participant_ids');

  // Fallback: use a raw query if RPC not available
  // We'll just update all rows where participant_id starts with 'pid_'
  const { count, error } = await supabase
    .from('collection_events')
    .update({ participant_id: NEW_PID })
    .like('participant_id', 'pid_%');

  if (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }

  console.log(`Migrated ${count ?? 'unknown number of'} events to new participant ID: ${NEW_PID}`);
}

migrate();
```

**Step 2: Commit**

```bash
git add extension/worker/scripts/migrate-participant-id.ts
git commit -m "Add one-time migration script for participant ID rewrite"
```

**Step 3: Run after Task 2 generates new key**

After installing the updated extension (which generates the ECDSA keypair), copy the new public key from `browser.storage.local > playerIdentity.publicKey` and run:

```bash
cd extension/worker
SUPABASE_URL=... SUPABASE_SECRET_KEY=... NEW_PID=pk_04a3b2... bun run scripts/migrate-participant-id.ts
```

---

### Task 8: Update movement visualization types

**Files:**
- Modify: `website/internet-series/movement/types.ts`

**Step 1: Add cursor_color to CollectionEvent meta**

The movement page has its own `CollectionEvent` type (separate from the extension's shared types). Add `cursor_color`:

In `website/internet-series/movement/types.ts`, update the `meta` field of `CollectionEvent`:

```ts
meta: {
  pid: string;
  sid: string;
  url: string;
  vw: number;
  vh: number;
  tz: string;
  cursor_color?: string | null;  // Participant's chosen color, hydrated by server
};
```

**Step 2: Build**

Run: `bun build-site`
Expected: Clean build (cursor_color is optional, so existing code won't break).

**Step 3: Commit**

```bash
git add website/internet-series/movement/types.ts
git commit -m "Add cursor_color to movement visualization event type"
```

---

### Task 9: Session-hue color derivation

**Files:**
- Modify: `website/internet-series/movement/utils/eventUtils.ts`

**Step 1: Add SESSION_HUE_CONFIG constants**

Add after the existing `RISO_COLORS` block:

```ts
// Tunable constants for time-based color derivation from a participant's
// chosen cursor color. Inspired by minute-faces' time-of-day color model.
export const SESSION_HUE_CONFIG = {
  // Hue offset cycles fully each hour within this range (+/- half)
  HOUR_HUE_RANGE: 40,
  // Saturation offset cycles each hour within this range (+/- half)
  HOUR_SAT_RANGE: 10,
  // Lightness offset driven by hour-of-day (midnight = min, noon = max)
  DAY_LIGHT_MIN: -15,
  DAY_LIGHT_MAX: 10,
};
```

**Step 2: Add hex-to-HSL parser**

```ts
/**
 * Parse a hex color string to { h, s, l } (h: 0-360, s: 0-100, l: 0-100).
 * Accepts #RGB, #RRGGBB, or hsl(...) strings.
 */
export function parseColorToHsl(color: string): { h: number; s: number; l: number } | null {
  // Handle hsl() strings
  const hslMatch = color.match(/^hsl\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?\s*\)$/);
  if (hslMatch) {
    return { h: parseInt(hslMatch[1]), s: parseInt(hslMatch[2]), l: parseInt(hslMatch[3]) };
  }

  // Handle hex strings
  let hex = color.replace('#', '');
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  if (hex.length !== 6) return null;

  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}
```

**Step 3: Add `deriveSessionColor`**

```ts
/**
 * Derive a time-varying color from a participant's base color and an event timestamp.
 *
 * - Hue + saturation cycle within their ranges each hour (driven by minute-of-hour)
 * - Lightness varies across the day (darker at midnight, lighter at noon)
 *
 * Uses the participant's local timezone if available, otherwise UTC.
 */
export function deriveSessionColor(baseColor: string, timestamp: number, timezone?: string): string {
  const base = parseColorToHsl(baseColor);
  if (!base) return baseColor; // Unparseable — return as-is

  const date = new Date(timestamp);
  // Use participant's timezone for time-of-day if available
  let hour: number;
  let minute: number;
  if (timezone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric', minute: 'numeric', hour12: false,
      }).formatToParts(date);
      hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0');
      minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0');
    } catch {
      hour = date.getUTCHours();
      minute = date.getUTCMinutes();
    }
  } else {
    hour = date.getUTCHours();
    minute = date.getUTCMinutes();
  }

  const cfg = SESSION_HUE_CONFIG;

  // Hue: sinusoidal cycle each hour within HOUR_HUE_RANGE
  const minuteFraction = minute / 60;
  const hueOffset = Math.sin(minuteFraction * Math.PI * 2) * (cfg.HOUR_HUE_RANGE / 2);

  // Saturation: cosine cycle each hour (offset from hue) within HOUR_SAT_RANGE
  const satOffset = Math.cos(minuteFraction * Math.PI * 2) * (cfg.HOUR_SAT_RANGE / 2);

  // Lightness: cosine across 24h, peak at noon (hour 12), trough at midnight (hour 0)
  const hourFraction = (hour + minute / 60) / 24;
  const lightOffset = cfg.DAY_LIGHT_MIN +
    (cfg.DAY_LIGHT_MAX - cfg.DAY_LIGHT_MIN) * (0.5 + 0.5 * Math.cos((hourFraction - 0.5) * Math.PI * 2));

  const h = ((base.h + hueOffset) % 360 + 360) % 360;
  const s = Math.max(0, Math.min(100, base.s + satOffset));
  const l = Math.max(0, Math.min(100, base.l + lightOffset));

  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`;
}
```

**Step 4: Build**

Run: `bun build-site`
Expected: Clean build.

**Step 5: Commit**

```bash
git add website/internet-series/movement/utils/eventUtils.ts
git commit -m "Add session-hue color derivation with tunable constants"
```

---

### Task 10: Wire session-hue into useCursorTrails

**Files:**
- Modify: `website/internet-series/movement/hooks/useCursorTrails.ts`

**Step 1: Import deriveSessionColor**

Add to imports:

```ts
import {
  RISO_COLORS,
  TRAIL_TIME_THRESHOLD,
  getColorForParticipant,
  extractDomain,
  deriveSessionColor,
} from "../utils/eventUtils";
```

**Step 2: Update color assignment logic**

Replace the color determination block (around lines 146-156) in the `eventsByParticipantAndUrl.forEach` callback. The key change: if the first event in a group has `meta.cursor_color`, use `deriveSessionColor` with that trail's start timestamp. Otherwise fall back to the existing palette logic.

```ts
let trailColorIndex = 0;
eventsByParticipantAndUrl.forEach((groupEvents) => {
  groupEvents.sort((a, b) => a.ts - b.ts);

  const pid = groupEvents[0].meta.pid;
  const cursorColor = (groupEvents[0].meta as { cursor_color?: string | null }).cursor_color;
  const timezone = groupEvents[0].meta.tz;

  // Determine base color for this trail group
  let color: string;
  if (settings.randomizeColors) {
    color = RISO_COLORS[trailColorIndex % RISO_COLORS.length];
    trailColorIndex++;
  } else if (cursorColor) {
    // Derive from participant's chosen color + trail start time
    color = deriveSessionColor(cursorColor, groupEvents[0].ts, timezone);
  } else {
    // Fallback: hash pid into palette
    if (!participantColors.has(pid)) {
      participantColors.set(pid, getColorForParticipant(pid));
    }
    color = participantColors.get(pid)!;
  }
```

**Step 3: Build**

Run: `bun build-site`
Expected: Clean build.

**Step 4: Commit**

```bash
git add website/internet-series/movement/hooks/useCursorTrails.ts
git commit -m "Use participant cursor color with session-hue derivation for trails"
```

---

### Task 11: Final build verification and deploy

**Step 1: Build everything**

Run all three builds:

```bash
bun build-site
cd extension && bun run build
cd extension/worker && bun run build
```

Expected: All clean.

**Step 2: Apply the migration**

Run `002_participants.sql` against Supabase (dashboard or CLI).

**Step 3: Deploy worker**

```bash
cd extension/worker && npx wrangler deploy
```

**Step 4: Install updated extension**

Load the built extension in Chrome. Verify:
- `browser.storage.local > playerIdentity.publicKey` is a long `pk_...` string (~133 chars)
- `browser.storage.local > collection_participant_id` is gone
- Session ID resets when browser restarts

**Step 5: Run migration script**

Copy the new public key and run:

```bash
cd extension/worker
SUPABASE_URL=... SUPABASE_SECRET_KEY=... NEW_PID=pk_... bun run scripts/migrate-participant-id.ts
```

**Step 6: Verify end-to-end**

- Open extension setup, pick a color, save → check worker logs for PUT /participants
- Open movement visualization → trails should use the participant's color with time-of-day variation
- Toggle "Randomize Colors" → should override to palette cycling
- Events without cursor_color (if any remain) → fall back to palette hash

**Step 7: Commit any final fixes**

```bash
git add -A  # after git status review
git commit -m "Participant identity + session-hue: final verification"
```
