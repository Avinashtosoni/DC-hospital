#!/usr/bin/env bash
# Hospital Comrade — server monitor agent.
#
# Every 5 minutes (cron) it reads CPU, memory, disk, Docker containers and SSL expiry on this server and posts them to the
# `ops` Edge Function. The control panel shows them on Health (group "Server") and raises alerts when a limit is crossed
# (Platform settings → Alerts → thresholds). If reports stop for 15 minutes the database itself raises "server silent".
#
# Install (as root, on the Coolify server):
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/scripts/server/hc-monitor.sh -o /usr/local/bin/hc-monitor
#   chmod +x /usr/local/bin/hc-monitor
#   cat > /etc/hc-monitor.env <<'ENV'
#   SUPABASE_URL=https://<project>.supabase.co
#   SUPABASE_ANON_KEY=<the public anon key>
#   SERVER_MONITOR_KEY=<the same long random value you saved as the ops function's SERVER_MONITOR_KEY secret>
#   SSL_DOMAINS="hospital.digitalcomrade.in airbase.digitalcomrade.in"
#   ENV
#   chmod 600 /etc/hc-monitor.env
#   hc-monitor --dry-run          # prints the report without sending
#   hc-monitor                    # sends one report; check Control panel → Health
#   echo '*/5 * * * * root /usr/local/bin/hc-monitor >/dev/null 2>&1' > /etc/cron.d/hc-monitor
#
# Needs: bash, coreutils, curl. Optional: docker (containers), openssl (SSL). Sends no logs, files or secrets.
set -euo pipefail

ENV_FILE="${HC_MONITOR_ENV:-/etc/hc-monitor.env}"
# shellcheck disable=SC1090
[ -r "$ENV_FILE" ] && . "$ENV_FILE"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\037'; }

host="$(hostname -s 2>/dev/null || hostname)"

# CPU: two /proc/stat samples one second apart
read -r _ u1 n1 s1 i1 w1 q1 sq1 st1 _ < /proc/stat
sleep 1
read -r _ u2 n2 s2 i2 w2 q2 sq2 st2 _ < /proc/stat
busy=$(( (u2+n2+s2+q2+sq2+st2) - (u1+n1+s1+q1+sq1+st1) ))
idle=$(( (i2+w2) - (i1+w1) ))
cpu=0; [ $((busy+idle)) -gt 0 ] && cpu=$(( 100 * busy / (busy+idle) ))
cores="$(nproc 2>/dev/null || echo 1)"
load1="$(cut -d' ' -f1 /proc/loadavg)"

# memory: MemAvailable (what can still be used without swapping)
mt=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
ma=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
ram=$(( 100 * (mt - ma) / mt ))

# disks: every real filesystem; "disk" = the fullest
disk=0; disks=""
while read -r pct mount; do
  p="${pct%\%}"
  [ "$p" -gt "$disk" ] && disk="$p"
  disks="${disks:+$disks,}{\"mount\":\"$(esc "$mount")\",\"pct\":$p}"
done < <(df -P -x tmpfs -x devtmpfs -x overlay -x squashfs 2>/dev/null | awk 'NR>1 && $6 !~ /^\/(snap|boot\/efi)/ {print $5, $6}' | head -10)

uptime_s="$(uptime -p 2>/dev/null | sed 's/^up //' || true)"

# containers (Coolify runs everything in Docker): stopped / restarting / unhealthy ones are reported by name
containers=""
if command -v docker >/dev/null 2>&1; then
  total=0; running=0; down=""
  while IFS='|' read -r name state status; do
    [ -z "$name" ] && continue
    total=$((total+1))
    if [ "$state" = "running" ] && [[ "$status" != *unhealthy* ]]; then running=$((running+1))
    elif [ "$state" != "exited" ] || [[ "$status" != "Exited (0)"* ]]; then down="${down:+$down,}\"$(esc "$name")\""; fi
  done < <(docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}' 2>/dev/null || true)
  containers=",\"containers\":{\"total\":$total,\"running\":$running,\"down\":[${down}]}"
fi

# SSL certificates: days until expiry
ssl=""
if command -v openssl >/dev/null 2>&1; then
  for d in ${SSL_DOMAINS:-}; do
    end="$(echo | timeout 10 openssl s_client -servername "$d" -connect "$d:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || true)"
    [ -z "$end" ] && { ssl="${ssl:+$ssl,}{\"domain\":\"$(esc "$d")\",\"days\":0}"; continue; }
    days=$(( ( $(date -d "$end" +%s) - $(date +%s) ) / 86400 ))
    ssl="${ssl:+$ssl,}{\"domain\":\"$(esc "$d")\",\"days\":$days}"
  done
fi

report="{\"host\":\"$(esc "$host")\",\"cpu\":$cpu,\"cores\":$cores,\"load1\":\"$load1\",\"ram\":$ram,\"disk\":$disk,\"disks\":[${disks}],\"uptime\":\"$(esc "$uptime_s")\"${containers},\"ssl\":[${ssl}]}"

if [ "$DRY" = 1 ]; then echo "$report"; exit 0; fi
: "${SUPABASE_URL:?set SUPABASE_URL in $ENV_FILE}" "${SUPABASE_ANON_KEY:?set SUPABASE_ANON_KEY}" "${SERVER_MONITOR_KEY:?set SERVER_MONITOR_KEY}"

curl -fsS --max-time 20 -X POST "${SUPABASE_URL%/}/functions/v1/ops" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" -H "apikey: ${SUPABASE_ANON_KEY}" \
  -H "x-monitor-key: ${SERVER_MONITOR_KEY}" -H 'Content-Type: application/json' \
  --data "{\"server\":${report}}"
echo
