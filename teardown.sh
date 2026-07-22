#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")"

for pidfile in .run/server.pid .run/tunnel.pid; do
  if [[ -f "$pidfile" ]]; then
    kill "$(cat "$pidfile")" 2>/dev/null && echo "Stopped $(basename "$pidfile" .pid)."
    rm -f "$pidfile"
  fi
done

if [[ "${1:-}" == "--full" ]]; then
  cloudflared tunnel delete -f secret-drop && echo "Tunnel deleted."
  echo "NOTE: also delete the 'drop' CNAME in the Cloudflare dashboard"
  echo "      (dash.cloudflare.com → saadiq.xyz → DNS → records)."
fi
