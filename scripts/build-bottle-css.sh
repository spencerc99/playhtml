#!/usr/bin/env bash
# ABOUTME: Compile MessageBottle.scss → MessageBottle.styles.ts (CSS-as-string export).
# ABOUTME: Re-run after editing MessageBottle.scss so the extension's shadow-DOM CSS stays in sync.

set -euo pipefail

cd "$(dirname "$0")/.."

SRC="extension/src/components/MessageBottle.scss"
OUT="extension/src/components/MessageBottle.styles.ts"
TMP="$(mktemp)"

( cd extension/website && bunx sass --style=compressed --no-source-map "../../$SRC" "$TMP" )

python3 - <<PY
import sys
with open("$TMP") as f:
    css = f.read()
escaped = css.replace("\\\\", "\\\\\\\\").replace("\`", "\\\\\`").replace("\${", "\\\\\${")
ts = '''// ABOUTME: Compiled CSS for MessageBottle, exported as a string for Shadow DOM injection.
// ABOUTME: Generated from MessageBottle.scss — re-run scripts/build-bottle-css.sh after edits.

export const MESSAGE_BOTTLE_CSS = \`''' + escaped + '''\`;
'''
with open("$OUT", "w") as f:
    f.write(ts)
print(f'wrote {len(ts)} bytes to $OUT')
PY

rm -f "$TMP"
echo "done."
