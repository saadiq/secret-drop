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
  if [[ ! -f .drop.env ]]; then
    echo ".drop.env missing, so the tunnel name is unknown. Run ./setup.sh to recreate it," >&2
    echo "or delete the tunnel by hand: cloudflared tunnel delete -f <name>" >&2
    exit 1
  fi
  source ./.drop.env
  cloudflared tunnel delete -f "$TUNNEL_NAME" && echo "Tunnel deleted."
  echo "NOTE: also delete the CNAME record for $PUBLIC_HOSTNAME in the Cloudflare"
  echo "      dashboard (dash.cloudflare.com → your domain → DNS → records)."
fi
