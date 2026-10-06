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
PNAME="$(esc "${PLATFORM_NAME:-Hospital Comrade}")"
PDOMAIN="$(esc "${PLATFORM_DOMAIN:-hospital.digitalcomrade.in}")"

# optional: company details for the legal pages, error reporting (empty = app defaults / off)
EXTRA=""
# TENANT_SUBDOMAINS=on: every hospital at <slug>.PLATFORM_DOMAIN (needs wildcard DNS + SSL — docs/MULTI_TENANCY.md)
for k in PLATFORM_LEGAL_NAME PLATFORM_ADDRESS PLATFORM_EMAIL PLATFORM_PHONE PLATFORM_GRIEVANCE_OFFICER PLATFORM_JURISDICTION SENTRY_DSN TENANT_SUBDOMAINS; do
  eval "v=\${$k:-}"
  if [ -n "$v" ]; then EXTRA="${EXTRA}, \"${k}\": \"$(esc "$v")\""; fi
done

cat > "$TARGET" <<JS
// Generated at container start — do not edit.
window.__ENV__ = { "VITE_SUPABASE_URL": "${URL}", "VITE_SUPABASE_ANON_KEY": "${KEY}", "REQUIRE_BACKEND": "${REQ}", "TENANCY": "${TEN}", "APP_ENV": "${APPENV}", "PLATFORM_NAME": "${PNAME}", "PLATFORM_DOMAIN": "${PDOMAIN}"${EXTRA} };
JS

# Multi-hospital: index.html is shared by every hospital's domain, and link previews (WhatsApp, Facebook…) don't run
# JavaScript — so the sample hospital's name must not be in it. Swap the marked block for neutral text; the app sets
# each hospital's own title / description as soon as it loads.
INDEX="${INDEX_HTML_PATH:-$(dirname "$TARGET")/index.html}"
if [ "$TEN" = "multi" ] && [ -f "$INDEX" ] && grep -q '<!-- seo:start' "$INDEX"; then
  html() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'; }
  HP="$(html "${PLATFORM_NAME:-Hospital Comrade}")"
  awk -v p="$HP" '
    /<!-- seo:start/ {
      print "    <meta name=\"description\" content=\"Book doctor appointments online, get digital prescriptions and lab reports on your phone.\" />"
      print "    <meta name=\"apple-mobile-web-app-title\" content=\"Hospital\" />"
      print "    <meta property=\"og:title\" content=\"Book appointments online\" />"
      print "    <meta property=\"og:description\" content=\"Book doctor appointments online, get digital prescriptions and lab reports on your phone.\" />"
      print "    <meta name=\"generator\" content=\"" p "\" />"
      print "    <title>Book appointments online</title>"
      skip = 1; next
    }
    /<!-- seo:end -->/ { skip = 0; next }
    !skip
  ' "$INDEX" > "$INDEX.tmp" && cat "$INDEX.tmp" > "$INDEX" && rm -f "$INDEX.tmp"
  echo "[dc-hospital] index.html: neutral title / link-preview text for multi-hospital mode"
fi

# Content-Security-Policy + HSTS (nginx snippets included by docker/nginx.conf)
#   CSP_MODE=enforce (default) | report-only (browser console only, nothing blocked) | off
#   CSP_SCRIPT_EXTRA="https://www.googletagmanager.com …" adds script hosts · HSTS=on (default) | off
SNIP_DIR="${NGINX_SNIPPETS_DIR:-/etc/nginx/snippets}"
if [ -d "$SNIP_DIR" ] && [ -w "$SNIP_DIR" ]; then
  SCRIPT_EXTRA="$(printf '%s' "${CSP_SCRIPT_EXTRA:-}" | tr -cd 'a-zA-Z0-9:/.* _-')"
  CSP="default-src 'self'; script-src 'self' https://checkout.razorpay.com https://*.razorpay.com https://www.gstatic.com${SCRIPT_EXTRA:+ $SCRIPT_EXTRA}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' https: wss:; frame-src 'self' https:; worker-src 'self' blob:; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self' https:"
  case "${CSP_MODE:-enforce}" in
    report-only) CSP_HEADER="Content-Security-Policy-Report-Only" ;;
    off) CSP_HEADER="" ;;
    *) CSP_HEADER="Content-Security-Policy" ;;
  esac
  snippet() {
    {
      if [ -n "$CSP_HEADER" ]; then printf 'add_header %s "%s; frame-ancestors %s; upgrade-insecure-requests" always;\n' "$CSP_HEADER" "$CSP" "$2"; fi
      if [ "${HSTS:-on}" != "off" ]; then printf 'add_header Strict-Transport-Security "max-age=31536000" always;\n'; fi
    } > "$1"
  }
  snippet "$SNIP_DIR/security-headers.conf" "'self'"
  snippet "$SNIP_DIR/security-headers-panel.conf" "'none'"
  echo "[dc-hospital] security headers: CSP=${CSP_HEADER:-off} HSTS=${HSTS:-on}"
fi

if [ -n "$URL" ] && [ -n "$KEY" ]; then
  echo "[dc-hospital] Supabase configured: ${URL}"
else
  echo "[dc-hospital] ERROR: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are missing — the app will show 'Database not connected'"
fi
echo "[dc-hospital] tenancy=${TEN} environment=${APPENV}"
