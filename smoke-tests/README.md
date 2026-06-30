# smoke-tests

Headless browser checks against the prebuilt site. Catches regressions that
unit tests miss because they only show up when real bundled JS runs in a real
browser — e.g. the April 2026 PR #102 incident, where bare `<PlayProvider>`
stopped bootstrapping playhtml and every experiment page broke in production.

## Running locally

```bash
# From repo root
bun build-site
bun run -C smoke-tests install-browsers   # one-time
bun smoke
```

## What it checks

For each page in `smoke.spec.ts`'s `PAGES` list:

- HTTP status < 400.
- No uncaught `pageerror` (rendering threw).
- No fatal `console.error` matching `FATAL_CONSOLE_PATTERNS` (playhtml runtime
  errors, missing PlayProvider, etc.).
- No same-origin asset 4xx/5xx (a renamed JS chunk would surface here).

Cross-origin failures (PartyKit WebSocket, Google Fonts) are deliberately
ignored — this is a build-output smoke test, not a backend integration test.

## PartyKit staging smoke tests

The PartyKit smoke scripts run against a real deployed Worker and Supabase.
They are manual because they take several minutes, wait for real Durable Object
alarms, and need staging secrets.

```bash
# Verifies bridge observers reattach after Durable Object hibernation.
bun smoke:partykit:hibernation

# Verifies normal traffic survives while oversized requests and burst clients are closed.
bun smoke:partykit:limits

# Verifies empty-room compaction, reset rejection, and fresh reconnect.
SMOKE_ENV_FILE=/path/to/.dev.vars bun smoke:partykit:compaction

# Recreates a stale live compaction source while the documents row contains
# newer data, and verifies automatic compaction leaves the newer row intact.
SMOKE_ENV_FILE=/path/to/.dev.vars bun smoke:partykit:stale-compaction

# Verifies connected-room high-watermark compaction.
SMOKE_ENV_FILE=/path/to/.dev.vars bun smoke:partykit:emergency

# Verifies local realtime sync and awareness when Supabase startup load fails.
SUPABASE_URL=http://127.0.0.1:9 SUPABASE_KEY=bad ADMIN_TOKEN=dev \
  bunx wrangler dev --config partykit/wrangler.jsonc --port 1999 \
  --var SUPABASE_LOAD_TIMEOUT_MS:100
PARTYKIT_HOST=localhost:1999 bun smoke:partykit:transient

# Simulates many participants upserting a keyed roster; asserts the room
# document stays bounded and no client is dropped (regression guard for the
# write-loop / doc-bloat incident). Tunables: PARTYKIT_SOAK_CLIENTS,
# PARTYKIT_SOAK_UPSERTS_PER_CLIENT, PARTYKIT_SOAK_MAX_STRUCT_ITEMS.
SMOKE_ENV_FILE=/path/to/.dev.vars bun smoke:partykit:soak

# Simulates many participants sending cursor-rate traffic through the generic
# presence transport. Tunables: PARTYKIT_PRESENCE_SOAK_CLIENTS,
# PARTYKIT_PRESENCE_SOAK_CURSOR_HZ, PARTYKIT_PRESENCE_SOAK_DURATION_MS,
# PARTYKIT_PRESENCE_SOAK_SETTLE_MS, PARTYKIT_PRESENCE_SOAK_CONNECT_TIMEOUT_MS.
PARTYKIT_HOST=playhtml-staging.spencerc99.workers.dev \
  bun smoke:partykit:presence-cursor

# Runs the standard PartyKit checks.
SMOKE_ENV_FILE=/path/to/.dev.vars bun smoke:partykit
```

The soak test is the regression guard for the runaway-write incident
(a self-triggering effect over an array roster grew a room to ~1.2M Yjs ops /
23MB and crashed the Durable Object). It connects N clients, has each
repeatedly re-upsert its own keyed entry (what a re-rendering effect does), and
fails if the roster doesn't converge to N unique entries, if the document grows
past the struct-item ceiling, or if any client is disconnected (a 503/overloaded
DO drops sockets). Run it against staging after any change to the roster data
model or the server's persistence/limit logic.

The emergency smoke expects the deployed Worker to use a low threshold, so it
can exercise the reset path without sending a production-sized document. One
staging workflow is:

```bash
bunx wrangler deploy --config partykit/wrangler.jsonc --env staging \
  --var EMERGENCY_COMPACT_CHECK_BYTES:60000 \
  --var EMERGENCY_COMPACT_RECHECK_DELAY_MS:1000
SMOKE_ENV_FILE=/path/to/.dev.vars bun smoke:partykit:emergency
bunx wrangler deploy --config partykit/wrangler.jsonc --env staging
```

Config:

- `PARTYKIT_HOST`: Worker host. Defaults to `playhtml-staging.spencerc99.workers.dev`.
- `PARTYKIT_SMOKE_MAX_REQUEST_BYTES`: expected server request-body limit for the limits smoke. Defaults to `16777216`.
- `PARTYKIT_SMOKE_MAX_WEBSOCKET_MESSAGE_BYTES`: expected server WebSocket message limit for the limits smoke. Defaults to `8388608`.
- `PARTYKIT_SMOKE_MESSAGE_RATE_LIMIT`: expected server per-window message limit for the limits smoke. Defaults to `1000`.
- `PARTYKIT_SMOKE_NORMAL_MESSAGES`: normal Yjs updates sent quickly before the abusive raw-client cases. Defaults to `420`.
- `PARTYKIT_PRESENCE_SOAK_CLIENTS`: number of clients for the presence cursor soak. Defaults to `20`.
- `PARTYKIT_PRESENCE_SOAK_CURSOR_HZ`: cursor updates per client per second for the presence cursor soak. Defaults to `60`.
- `PARTYKIT_PRESENCE_SOAK_DURATION_MS`: duration for the presence cursor soak. Defaults to `20000`.
- `PARTYKIT_PRESENCE_SOAK_SETTLE_MS`: wait after sends for final broadcasts. Defaults to `1000`.
- `PARTYKIT_PRESENCE_SOAK_CONNECT_TIMEOUT_MS`: connection timeout per smoke client. Defaults to `20000`.
- `SMOKE_ENV_FILE`: optional `.dev.vars` or `.env` file to load before the script reads `ADMIN_TOKEN`.
- `ADMIN_TOKEN`: required for `test:partykit:compaction`.
- `PARTYKIT_HIBERNATION_WAIT_MS`: idle wait for the hibernation smoke. Defaults to `90000`.
- `PARTYKIT_EMPTY_ROOM_COMPACT_DELAY_MS`: expected server empty-room compaction delay. Defaults to `300000`.
- `PARTYKIT_STALE_COMPACTION_SETTLE_MS`: extra wait after the empty-room compaction delay for the stale-source smoke. Defaults to `20000`.
- `PARTYKIT_SKIP_COMPACTION_SETTLE_CHECK=1`: skips the extra no-op alarm wait after reconnect.
- `PARTYKIT_EMERGENCY_TARGET_RAW_BYTES`: target local raw Y.Doc size for the emergency smoke. Defaults to `120000`.
- `PARTYKIT_EMERGENCY_BATCH_SIZE`: temp entry batch size while building the emergency smoke doc. Defaults to `2000`.
- `PARTYKIT_EMERGENCY_RESET_TIMEOUT_MS`: timeout while waiting for emergency reset. Defaults to `180000`.

## Adding a new page

Add its URL path to `PAGES`. Add new error patterns to
`FATAL_CONSOLE_PATTERNS` when a new class of regression is found.

## CI

The `smoke` job in `.github/workflows/pr-validation.yml` builds the site,
installs Chromium, and runs this suite on every PR.
