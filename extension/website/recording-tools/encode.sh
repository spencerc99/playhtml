#!/usr/bin/env bash
# ABOUTME: Encodes a recorded .webm to a clean H.264 mp4 (no audio), with optional upscale.
# ABOUTME: Usage: encode.sh <input.webm> <output.mp4> <WIDTH> <HEIGHT> [crf] [trim_start_sec]
#
# WIDTH/HEIGHT is the final frame size. To upscale (e.g. record at 1080p then
# output 4K because 4K capture drops frames on heavy scenes), pass the larger
# size — flat color fills upscale crisply with lanczos.
#
# trim_start_sec drops that many seconds off the front. capture.mjs reloads the
# page at --wait seconds so the timed window starts on a blank canvas; the
# warm-up before that reload sits at the head of the .webm. Pass ~1s MORE than
# --wait here to clear the reload's navigation + re-init latency (the canvas
# stays on warm-up content for ~0.5s after the reload fires) so the clip opens
# on the blank page, not a leftover warm-up frame.
#
# The seek is placed AFTER -i (accurate/decode-from-zero) on purpose: an input
# seek (-ss before -i) snaps to the nearest prior keyframe, which on these webms
# can be ~2s earlier and drags the full warm-up scene into the output.
#
#   encode.sh in.webm wide-4k.mp4 3840 2160          # upscale to 4K
#   encode.sh in.webm portrait.mp4 1080 1920         # native portrait
#   encode.sh in.webm wide-4k.mp4 3840 2160 18 13    # trim 13s (--wait 12 + 1s)
set -euo pipefail

IN="$1"; OUT="$2"; W="$3"; H="$4"; CRF="${5:-18}"; TRIM="${6:-0}"

ffmpeg -y -i "$IN" -ss "$TRIM" \
  -r 25 -vf "scale=${W}:${H}:flags=lanczos,fps=25" \
  -c:v libx264 -crf "$CRF" -pix_fmt yuv420p -profile:v high \
  -an -movflags +faststart \
  "$OUT"

echo "encoded: $OUT ($(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "$OUT"), $(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$OUT" | cut -d. -f1)s, audio streams: $(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$OUT" | wc -l | tr -d ' '))"
