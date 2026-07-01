<!-- ABOUTME: Documents PlayHTML's Playwright artificial-user scene runner. -->
<!-- ABOUTME: Explains how to run, watch, and author stochastic browser actors. -->

# Playwright Artificial Users

This package runs Playwright browser actors against real PlayHTML pages.
Use it when Spencer wants to test a collaborative page by watching other
cursors move, type, drag, and share state in real time.

Natural language stays in Codex:

1. Spencer describes the behavior to test.
2. Codex maps that behavior onto reusable helpers in `src/`.
3. Codex creates or edits a scene in `scenes/`.
4. The scene is run from this package.

The runner does not parse prompts. The TypeScript scene is the repeatable test
artifact.

## Run A Scene

Start the website in another terminal:

```bash
bun run dev -- --host 127.0.0.1 --port 5173
```

Start local realtime sync in another terminal. The transient mode command uses
the repo's existing PartyKit server without requiring Supabase secrets:

```bash
SUPABASE_URL=http://127.0.0.1:9 SUPABASE_KEY=bad ADMIN_TOKEN=dev \
  bunx wrangler dev --config partykit/wrangler.jsonc --port 1999 \
  --var SUPABASE_LOAD_TIMEOUT_MS:100
```

Run artificial users:

```bash
bun tools/playwright/src/runner.ts \
  --scene fridge-artificial-users \
  --base-url http://127.0.0.1:5173 \
  --actors 4 \
  --duration 120000 \
  --seed fridge-local \
  --headless
```

```bash
bun tools/playwright/src/runner.ts \
  --scene walking-together-artificial-users \
  --base-url http://127.0.0.1:5173 \
  --actors 4 \
  --duration 120000 \
  --seed walking-local \
  --headless
```

The scene logs the URL to open in a normal browser. Open that same URL to
interact with the artificial users while they run. Use `--headless` for demo
recordings that should not open actor windows on your desktop. Omit it when you
want to watch or debug the actor browsers directly.

When a scene sets `camera: true`, the runner records a passive observer page
instead of an actor page. Scenes can call `sync.markRecordingStart()` after
setup so the saved demo focuses on the active test window. If `ffmpeg` is
available locally, the runner saves a trimmed `.mp4` plus the raw Playwright
`.webm`; otherwise it keeps the raw `.webm`.

## Flags

- `--scene <name>`: scene file in `scenes/<name>.ts`.
- `--actors <number>`: number of browser actors.
- `--duration <ms>`: run length for loop-based scenes.
- `--seed <string>`: reproducible personas and stochastic choices.
- `--base-url <url>`: page origin for local or deployed targets.
- `--host-url <url>`: optional URL to print for Spencer when the watch URL
  differs from actor URLs.
- `--headless`: run actor browsers offscreen while still recording video.
- `--no-video`: skip recording.

## Authoring Behavior

Reusable pieces live in `src/`:

- `random.ts`: deterministic randomness.
- `personas.ts`: actor names, colors, rhythm, motion, and prompt traits.
- `actions.ts`: human-like Playwright actions, delays, and cursor jitter.
- `runtime.ts`: browser launch mode, recorded actor selection, and movement
  cadence helpers.
- `video.ts`: local video trim planning and ffmpeg execution.
- `session.ts`: duration and URL helpers.
- `errors.ts`: fatal browser error collection.

For a fresh behavior request, create a scene that:

1. builds an isolated room URL from `options.seed`,
2. seeds each actor identity before navigation,
3. navigates `camera` to the same isolated URL when the scene records from an
   observer,
4. calls `sync.markRecordingStart()` after setup and before the visible test,
5. runs actor loops until `createRunUntil(options.durationMs)` expires,
6. waits for `persona.rhythm.startDelayMs` before each actor loop,
7. calls `actions.pauseBeforeAction()` and `actions.betweenActions()` inside
   loops,
8. varies actions with `persona.random.weighted(...)`,
9. asserts that page-visible state changed,
10. lets runner error collection fail on fatal page errors.

Keep scenes small and page-specific. Put shared browser actions in `src/` only
after two scenes need the same behavior.
