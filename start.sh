#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PUBLIC_HOSTNAME="drop.saadiq.xyz"

if [[ ! -f cloudflared-config.yml ]]; then
  echo "cloudflared-config.yml missing — run ./setup.sh first." >&2
  exit 1
fi

# A second start would overwrite the pidfiles and orphan the running instance.
for pidfile in .run/server.pid .run/tunnel.pid; do
  if [[ -f "$pidfile" ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "Already running ($(basename "$pidfile" .pid), pid $(cat "$pidfile")) — run ./teardown.sh first." >&2
    exit 1
  fi
done

mkdir -p .run uploads
bun server.ts &
echo $! > .run/server.pid
cloudflared tunnel --config cloudflared-config.yml run &
echo $! > .run/tunnel.pid

sleep 3

for pidfile in .run/server.pid .run/tunnel.pid; do
  if ! kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    echo "ERROR: $(basename "$pidfile" .pid) failed to start — check output above." >&2
    ./teardown.sh
    exit 1
  fi
done

echo ""
echo "================================================="
echo "  Link (send it):    https://$PUBLIC_HOSTNAME"
echo "================================================="
echo "  Uploads land in ./uploads/ — decrypt with:"
echo "  bun decrypt.ts uploads/<file>.enc"
echo "  Ctrl-C stops everything."
echo ""

trap './teardown.sh' INT TERM
wait
