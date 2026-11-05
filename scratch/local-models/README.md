# Local model benchmarks (scrap)

For the Mozilla Human-Scale AI application. Not product code.

- `make.ts`: every model writes a single-file playhtml page for each of 7 tasks, with the agent guide and without it. It saves `.html`, `.raw.txt` and `.json` per run, plus `results.json`. The run is resumable.
- `gallery.ts`: builds `index.html` with an iframe grid so you can play with the outputs.
- The animate eval lives in `extension/src/features/social/animate/eval/run.ts`.

Targets: `name=http://localhost:8080/v1/chat/completions` (llama-server, LM Studio, Ollama /v1), or `claude` for the Claude Code CLI.
Env: `RUNS=2`, `CONDITIONS=guide,none`.
