#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

TUNNEL_NAME="secret-drop"
PUBLIC_HOSTNAME="drop.saadiq.xyz"
PORT=8787

existing_id() {
  cloudflared tunnel list 2>/dev/null | awk -v n="$TUNNEL_NAME" '$2 == n { print $1 }'
}

TUNNEL_ID="$(existing_id)"
if [[ -z "$TUNNEL_ID" ]]; then
  echo "Creating tunnel ${TUNNEL_NAME}…"
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID="$(existing_id)"
fi
echo "Tunnel: $TUNNEL_NAME ($TUNNEL_ID)"

cat > cloudflared-config.yml <<EOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json
ingress:
  - hostname: $PUBLIC_HOSTNAME
    service: http://localhost:$PORT
  - service: http_status:404
EOF

echo "Routing DNS $PUBLIC_HOSTNAME → tunnel…"
if ! cloudflared tunnel route dns "$TUNNEL_NAME" "$PUBLIC_HOSTNAME"; then
  echo ""
  echo "DNS routing failed. Your cert.pem is likely scoped to a different zone."
  echo "Fix: cloudflared tunnel login   (pick the saadiq.xyz zone), then re-run ./setup.sh"
  exit 1
fi
echo "Setup complete. Run ./start.sh next."
