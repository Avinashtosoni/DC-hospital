#!/bin/sh
# Writes /env.js from environment variables so one image works for every environment.
# Executed automatically by the nginx image entrypoint before nginx starts.
set -eu

TARGET="${ENV_JS_PATH:-/usr/share/nginx/html/env.js}"

# JSON-escape a value (backslashes, quotes, control chars)
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r'; }

URL="$(esc "${VITE_SUPABASE_URL:-}")"
KEY="$(esc "${VITE_SUPABASE_ANON_KEY:-}")"
REQ="$(esc "${REQUIRE_BACKEND:-}")"
TEN="$(esc "${TENANCY:-single}")"
APPENV="$(esc "${APP_ENV:-production}")"

cat > "$TARGET" <<JS
// Generated at container start — do not edit.
window.__ENV__ = { "VITE_SUPABASE_URL": "${URL}", "VITE_SUPABASE_ANON_KEY": "${KEY}", "REQUIRE_BACKEND": "${REQ}", "TENANCY": "${TEN}", "APP_ENV": "${APPENV}" };
JS

if [ -n "$URL" ] && [ -n "$KEY" ]; then
  echo "[dc-hospital] Supabase configured: ${URL}"
elif [ -n "$REQ" ] && [ "$REQ" != "false" ] && [ "$REQ" != "0" ]; then
  echo "[dc-hospital] ERROR: REQUIRE_BACKEND is set but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing — the app will show a setup error"
else
  echo "[dc-hospital] No Supabase env vars set → running in DEMO mode (browser localStorage)"
fi
echo "[dc-hospital] tenancy=${TEN} environment=${APPENV}"
