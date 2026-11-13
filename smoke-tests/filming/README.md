# Filming copy of playhtml.fun

A local copy of the homepage with a snapshot of the live room, plus simulated
people, for screen recordings. Nothing here writes to production: the export
only reads, and the local server keeps all changes in memory.

```sh
bun run film:export          # once: read-only copy of the live homepage room
bun run film                 # local site + server on the snapshot
bun run film:bots -- --count 5   # in another terminal: simulated people
```

Open the URL `bun run film` prints (`http://localhost:5199/?playhtmlHost=localhost:1998`)
and record. Restarting `bun run film` resets the room to the snapshot, so every
take starts from the same state. Re-run `film:export` for a fresher copy.

## Simulated people

Each one is a headless browser with its own cursor color. They wander, rest,
and play with the toys in view: lamp, sign, sticker, plant, and the three
counters. Ctrl+C stops them.

| Flag                       | Default     | What it does                                         |
| -------------------------- | ----------- | ---------------------------------------------------- |
| `--count`                  | 4           | How many people                                      |
| `--pace`                   | 1           | Higher is busier, lower is calmer                    |
| `--only sign,lamp-hanging` | all         | Only touch these element ids                         |
| `--roam`                   | off         | Scroll around the page instead of staying at the top |
| `--rain`                   | off         | Let them click the hydrant (rain covers the screen)  |
| `--duration 60`            | 0 (forever) | Stop after N seconds                                 |
| `--headed`                 | off         | Show their browser windows                           |

First run needs the browser: `bun run --cwd smoke-tests install-browsers`.

## Other pages and ports

`bun run film:export -- --room '<room id>' --out scripts/filming/snapshots/other.json`
exports another room (ids look like `playhtml.fun-/some/path`). Start it
with `bun run film -- --snapshot <file>`, open that page's path, and point the
bots at it with `--url`. Ports: `--site-port` (5199), `--server-port` (1998),
`--db-port` (54398), so it runs next to `bun dev` and `bun dev-server`.
