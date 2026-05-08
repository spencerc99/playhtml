#!/bin/bash
# ABOUTME: Regenerate the Chrome Web Store API refresh token via loopback OAuth.
# ABOUTME: Requires CHROME_CLIENT_ID/SECRET in .env.submit to be a Desktop app client.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env.submit"
PORT=8765
REDIRECT="http://127.0.0.1:${PORT}"
SCOPE="https://www.googleapis.com/auth/chromewebstore"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE"
  exit 1
fi

set -a; . "$ENV_FILE"; set +a

if [ -z "${CHROME_CLIENT_ID:-}" ] || [ -z "${CHROME_CLIENT_SECRET:-}" ]; then
  echo "CHROME_CLIENT_ID / CHROME_CLIENT_SECRET missing from .env.submit"
  exit 1
fi

if lsof -i :${PORT} -n -P >/dev/null 2>&1; then
  echo "Port ${PORT} is already in use. Free it and retry."
  exit 1
fi

CODE_FILE=$(mktemp)
trap 'rm -f "$CODE_FILE"' EXIT

python3 - "$PORT" "$CODE_FILE" <<'PYEOF' &
import http.server, socketserver, urllib.parse, sys, json
port = int(sys.argv[1]); out = sys.argv[2]
result = {}
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        result.update(dict(urllib.parse.parse_qsl(urllib.parse.urlparse(self.path).query)))
        self.send_response(200); self.send_header('Content-Type','text/html'); self.end_headers()
        self.wfile.write(b'<h2>Got it. You can close this tab.</h2>')
    def log_message(self,*a,**k): pass
with socketserver.TCPServer(('127.0.0.1', port), H) as httpd:
    while 'code' not in result and 'error' not in result:
        httpd.handle_request()
open(out,'w').write(json.dumps(result))
PYEOF
SERVER_PID=$!

AUTH_URL="https://accounts.google.com/o/oauth2/auth?response_type=code&access_type=offline&prompt=consent&client_id=${CHROME_CLIENT_ID}&scope=${SCOPE}&redirect_uri=${REDIRECT}"

echo ""
echo "Opening Google consent in your default browser..."
echo "If it doesn't open, paste this URL manually:"
echo ""
echo "  $AUTH_URL"
echo ""
echo "Sign in as the Chrome Web Store developer, click through the unverified-app warning,"
echo "and approve. The browser will redirect to ${REDIRECT}/?code=... and this script continues."
echo ""

if command -v open >/dev/null 2>&1; then
  open "$AUTH_URL"
fi

# Wait up to 5 minutes for the local server to capture the code.
for _ in $(seq 1 300); do
  if [ -s "$CODE_FILE" ]; then break; fi
  sleep 1
done

if ! [ -s "$CODE_FILE" ]; then
  echo "Timed out waiting for OAuth callback. Aborting."
  kill "$SERVER_PID" 2>/dev/null || true
  exit 1
fi

CODE=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1])).get('code',''))" "$CODE_FILE")
if [ -z "$CODE" ]; then
  echo "OAuth callback didn't include a code:"
  cat "$CODE_FILE"
  exit 1
fi

RESP=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -d "client_id=${CHROME_CLIENT_ID}" \
  -d "client_secret=${CHROME_CLIENT_SECRET}" \
  -d "code=${CODE}" \
  -d "grant_type=authorization_code" \
  -d "redirect_uri=${REDIRECT}")

NEW_TOKEN=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('refresh_token',''))" "$RESP")
if [ -z "$NEW_TOKEN" ]; then
  echo "Failed to obtain refresh token. Response was:"
  echo "$RESP"
  exit 1
fi

if grep -q '^CHROME_REFRESH_TOKEN=' "$ENV_FILE"; then
  TMP="$(mktemp)"
  awk -v t="$NEW_TOKEN" '
    /^CHROME_REFRESH_TOKEN=/ { printf "CHROME_REFRESH_TOKEN=\"%s\"\n", t; next }
    { print }
  ' "$ENV_FILE" > "$TMP"
  mv "$TMP" "$ENV_FILE"
else
  echo "CHROME_REFRESH_TOKEN=\"${NEW_TOKEN}\"" >> "$ENV_FILE"
fi

echo "Updated CHROME_REFRESH_TOKEN in $ENV_FILE"
