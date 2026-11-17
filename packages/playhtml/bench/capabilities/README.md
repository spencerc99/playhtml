# Per-capability benchmarks

Each `<capability>.perf.ts` here runs a few realistic scenarios for one capability and writes deterministic counts to `bench/out/metrics.<capability>.json`. `bench/run.mjs` merges them with the core benchmark, and the Library Performance Report on every PR shows each capability in its own section, comparing `main` to the PR.

`can-mirror.perf.ts` starts from the demos on the docs' can-mirror playground (`apps/docs/src/content/docs/advanced/mirror-playground.mdx`) and adds a 50-field form, a 1,000-item list and a board of nested cards.

## Budget

Keep each capability to about 4 scenarios and 12 report rows, and its file under about 4 seconds. Bench files run in parallel, so a file shorter than `client.perf.ts` adds almost no time to the check. Pick the scenarios that would catch the regressions that capability has actually had.

## What to measure

Prefer counts that don't change between runs:

- sync traffic this client sends (`measureTraffic`: messages, bytes, document growth);
- DOM writes to show someone else's change (`remotePeer` + `countDomWrites`).

Timings (`*_ms`, via `now()`) are fine as context but are never flagged.

## Adding a capability

1. Add `<capability>.perf.ts` here, using `harness.ts`. Give every scenario its own element ids: playhtml keeps one document across resets in a file.
2. Call `writeCapabilityMetrics("<capability>", metrics)` in `afterAll`.
3. List the metrics in `scripts/compare-library-performance.mjs` inside a `capability("<capability>", [...])` block so the report shows and checks them.

Run it alone with:

```sh
cd packages/playhtml
NODE_OPTIONS=--no-experimental-webstorage npx vitest run --config bench/vitest.config.ts bench/capabilities
cat bench/out/metrics.can-mirror.json
```
