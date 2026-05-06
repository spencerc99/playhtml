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

# Verifies empty-room compaction, reset rejection, and fresh reconnect.
SMOKE_ENV_FILE=/path/to/.dev.vars bun smoke:partykit:compaction

# Verifies connected-room high-watermark compaction.
SMOKE_ENV_FILE=/path/to/.dev.vars bun smoke:partykit:emergency

# Runs the standard PartyKit checks.
SMOKE_ENV_FILE=/path/to/.dev.vars bun smoke:partykit
```

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
- `SMOKE_ENV_FILE`: optional `.dev.vars` or `.env` file to load before the script reads `ADMIN_TOKEN`.
- `ADMIN_TOKEN`: required for `test:partykit:compaction`.
- `PARTYKIT_HIBERNATION_WAIT_MS`: idle wait for the hibernation smoke. Defaults to `90000`.
- `PARTYKIT_EMPTY_ROOM_COMPACT_DELAY_MS`: expected server empty-room compaction delay. Defaults to `300000`.
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
