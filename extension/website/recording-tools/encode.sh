#!/usr/bin/env bash
# ABOUTME: Encodes a recorded .webm to a clean H.264 mp4 (no audio), with optional upscale.
# ABOUTME: Usage: encode.sh <input.webm> <output.mp4> <WIDTH> <HEIGHT> [crf] [trim_start_sec]
#
# WIDTH/HEIGHT is the final frame size. To upscale (e.g. record at 1080p then
# output 4K because 4K capture drops frames on heavy scenes), pass the larger
# size — flat color fills upscale crisply with lanczos.
#
# trim_start_sec drops that many seconds off the front. Playwright records from
# context creation, so the capture's settle wait (--wait) lands at the head of
# the .webm as a blank/half-empty lead-in (visible on typing/scroll scenes that
# populate over time). Pass the same value as --wait to start on a full scene.
#
#   encode.sh in.webm wide-4k.mp4 3840 2160          # upscale to 4K
#   encode.sh in.webm portrait.mp4 1080 1920         # native portrait
#   encode.sh in.webm wide-4k.mp4 3840 2160 18 12    # also trim 12s settle lead-in
set -euo pipefail

IN="$1"; OUT="$2"; W="$3"; H="$4"; CRF="${5:-18}"; TRIM="${6:-0}"

ffmpeg -y -ss "$TRIM" -i "$IN" \
  -r 25 -vf "scale=${W}:${H}:flags=lanczos,fps=25" \
  -c:v libx264 -crf "$CRF" -pix_fmt yuv420p -profile:v high \
  -an -movflags +faststart \
  "$OUT"

echo "encoded: $OUT ($(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT"), $(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUT" | cut -d. -f1)s, audio streams: $(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$OUT" | wc -l | tr -d ' '))"
