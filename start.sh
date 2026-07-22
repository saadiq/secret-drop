#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PUBLIC_HOSTNAME="drop.saadiq.xyz"

if [[ ! -f cloudflared-config.yml ]]; then
  echo "cloudflared-config.yml missing — run ./setup.sh first." >&2
  exit 1
fi

if [[ -z "${PASS:-}" ]]; then
  PASS="$(bun -e '
    const words = (await Bun.file("/usr/share/dict/words").text())
      .split("\n").filter((w) => /^[a-z]{4,7}$/.test(w));
    const pick = () =>
      words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
    console.log([pick(), pick(), pick(), pick()].join("-"));
  ')"
fi
export PASS

mkdir -p .run uploads
bun server.ts &
echo $! > .run/server.pid
cloudflared tunnel --config cloudflared-config.yml run &
echo $! > .run/tunnel.pid

sleep 3
echo ""
echo "================================================="
echo "  Link (email it):   https://$PUBLIC_HOSTNAME"
echo "  Code (text it):    $PASS"
echo "================================================="
echo "  Uploads land in ./uploads/ — decrypt with:"
echo "  PASS=\"$PASS\" bun decrypt.ts uploads/<file>.enc"
echo "  Ctrl-C stops everything."
echo ""

trap './teardown.sh' INT TERM
wait
