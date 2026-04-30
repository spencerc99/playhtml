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

## Adding a new page

Add its URL path to `PAGES`. Add new error patterns to
`FATAL_CONSOLE_PATTERNS` when a new class of regression is found.

## CI

The `smoke` job in `.github/workflows/pr-validation.yml` builds the site,
installs Chromium, and runs this suite on every PR.
