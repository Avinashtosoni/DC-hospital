#!/bin/sh
# Writes /env.js from environment variables so one image works for every environment.
# Executed automatically by the nginx image entrypoint before nginx starts.
set -eu

TARGET="${ENV_JS_PATH:-/usr/share/nginx/html/env.js}"

# JSON-escape a value (backslashes, quotes, control chars)
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r'; }

URL="$(esc "${VITE_SUPABASE_URL:-}")"
KEY="$(esc "${VITE_SUPABASE_ANON_KEY:-}")"

cat > "$TARGET" <<JS
// Generated at container start — do not edit.
window.__ENV__ = { "VITE_SUPABASE_URL": "${URL}", "VITE_SUPABASE_ANON_KEY": "${KEY}" };
JS

if [ -n "$URL" ] && [ -n "$KEY" ]; then
  echo "[dc-hospital] Supabase configured: ${URL}"
else
  echo "[dc-hospital] No Supabase env vars set → running in DEMO mode (browser localStorage)"
fi
