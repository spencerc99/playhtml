# Local model benchmarks (scrap)

For the Mozilla Human-Scale AI application. Not product code.

- `make.ts`: every model writes a single-file playhtml page for each of 7 tasks, with the agent guide and without it. It saves `.html`, `.raw.txt` and `.json` per run, plus `results.json`. The run is resumable.
- `gallery.ts`: builds `index.html` with an iframe grid so you can play with the outputs.
- The animate eval lives in `extension/src/features/social/animate/eval/run.ts`.

Targets: `name=http://localhost:8080/v1/chat/completions` (llama-server, LM Studio, Ollama /v1), or `claude` for the Claude Code CLI.
Env: `RUNS=2`, `CONDITIONS=guide,none`.

## Map

`map.ts` asks each model to place a page for the Internet Commute (hidden / scenery / regular / featured / reserve). It scores the answers against the placements Spencer filed in the commute desk, with Clef's logged call as the baseline.

The fixtures are real participants' pages, so they stay out of the repo. To rebuild them, run `wrangler d1 execute wwo-admin --remote --json --file scratch/local-models/map-fixtures.sql` and keep one row per `page_key`, using the narrowest scope.

Caveat: some of the human placements were made by accepting Clef's call, so Clef's agreement is inflated.
