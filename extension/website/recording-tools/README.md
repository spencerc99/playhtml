# recording-tools

Headless capture of the `wewere.online` archive visualization (cursor trails,
scroll windows, typing) to video — for installation pieces, social clips, and
festival submissions. Uses Playwright + a local dev server, then encodes with
ffmpeg.

These run **headless against the dev server** (not the deployed site), so they
capture at any resolution/aspect with a real viewport size — which the live
preview tab can't do reliably.

## Prereqs

- Dev server running: `bun run -C extension/website dev` (serves on `:5174`).
- Playwright + a Chromium build installed (`bunx playwright install chromium`).
  The scripts default to a pinned `ms-playwright/chromium-1217` path; override
  with `--chrome <path>` or the `PW_CHROME` env var if yours differs.
- `ffmpeg` on PATH.
- Run the `.mjs` scripts with `NODE_PATH` pointing at the website's
  `node_modules` so Playwright resolves:
  ```sh
  cd extension/website
  NODE_PATH="$PWD/node_modules" bun recording-tools/capture.mjs --url ... --out ...
  ```

## Scripts

- **`capture.mjs`** — records a `.webm`. Flags: `--url --out --seconds --width
  --height --swap-every --slow/--fast/--ramp-at --settings --wait`. See the file
  header for details.
- **`frame.mjs`** — grabs a single PNG frame for quick eyeballing before a full
  recording.
- **`encode.sh`** — `.webm` → clean H.264 `.mp4` (no audio), with optional
  upscale.

## Building the URL

The page reads most settings from a base64 `?s=` blob in the URL (the dev
panel's **Copy URL** button produces one with your current settings). Pass that
URL verbatim. Useful query params on top:

- `viz=trails,scrolling,typing` — which visualizations to show (comma list).
- `clean=2` — hide all chrome (sound, date picker, readouts, wordmark) for a
  bare capture.
- `day=YYYY-MM-DD` — which archive day. Add `tod=00:00&todRadius=15` for a
  recurring time-of-day window (e.g. the midnight moment).
- `trailVisualStyle=color|monochrome` — color vs ink for cursors AND the
  window/typing visualizations.
- Cinematic camera: `cinematic=1` (follow) or `cinematic=reveal` (scripted
  pull-back), plus `cinemaZoom`, `cinemaTransition`, `cinemaReveal`,
  `cinemaStartZoom`. In-page keys: `Shift+C` toggle, `N` swap subject.

Scroll/window settings (`scrollSpeed`, `maxConcurrentScrolls`, `windowScale`,
…) are NOT URL params — they ride in the `?s=` blob. If you only have panel
values (not a blob URL), pass them via `--settings '{"scrollSpeed":0.2,...}'`,
which seeds them into localStorage before load.

## Performance note (why we record at 1080p and upscale)

Heavy SVG-filter scenes (the scroll windows) drop frames at native 4K — the
rasterizer can't keep up, so windows render half-formed (look transparent).
Record those at **1920×1080** (smooth) and upscale to 4K in `encode.sh`; the
flat color fills upscale crisply. Portrait/lighter scenes can capture native.

## Examples

```sh
cd extension/website
REPO_NM="$PWD/node_modules"
BLOB="<paste the ?s= blob value>"

# Wide windows-only, 1080p → upscaled 4K
NODE_PATH="$REPO_NM" bun recording-tools/capture.mjs \
  --url "http://localhost:5174/archive/?viz=scrolling&s=$BLOB&clean=2&day=2026-06-27" \
  --out /tmp/cap_wide --seconds 50 --width 1920 --height 1080
bash recording-tools/encode.sh /tmp/cap_wide/*.webm ~/Downloads/windows-wide-4k.mp4 3840 2160

# Portrait cinematic reveal (10s pull-back)
NODE_PATH="$REPO_NM" bun recording-tools/capture.mjs \
  --url "http://localhost:5174/archive/?viz=scrolling&s=$BLOB&clean=2&day=2026-06-20&cinematic=reveal&cinemaReveal=10&cinemaStartZoom=0.14" \
  --out /tmp/cap_port --seconds 50 --width 1080 --height 1920
bash recording-tools/encode.sh /tmp/cap_port/*.webm ~/Downloads/windows-portrait.mp4 1080 1920

# Cinematic cursor-follow with N-swaps every 10s
NODE_PATH="$REPO_NM" bun recording-tools/capture.mjs \
  --url "http://localhost:5174/archive/?viz=trails&s=$BLOB&clean=2&day=2026-06-27&cinematic=1&cinemaZoom=0.22" \
  --out /tmp/cap_cine --seconds 45 --swap-every 10 --width 3840 --height 2160
```
