#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

PORT=8787
ENV_FILE=".drop.env"

# Re-running offers the saved answers as defaults. Values already set in the
# environment skip the prompt, so setup can run non-interactively.
env_hostname="${PUBLIC_HOSTNAME:-}" env_name="${OPERATOR_NAME:-}" env_tunnel="${TUNNEL_NAME:-}"
PUBLIC_HOSTNAME="" OPERATOR_NAME="" TUNNEL_NAME=""
# ./ so bash's `source` doesn't search $PATH for the file first.
[[ -f "$ENV_FILE" ]] && source "./$ENV_FILE"

ask() { # ask <prompt> <default> → answer on stdout
  local answer
  read -rp "$1${2:+ [$2]}: " answer
  echo "${answer:-$2}"
}

PUBLIC_HOSTNAME="${env_hostname:-$(ask "Public hostname (e.g. drop.example.com)" "$PUBLIC_HOSTNAME")}"
OPERATOR_NAME="${env_name:-$(ask "Your name, as the sender will see it" "$OPERATOR_NAME")}"
TUNNEL_NAME="${env_tunnel:-${TUNNEL_NAME:-secret-drop}}"

if [[ ! "$PUBLIC_HOSTNAME" =~ ^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$ ]]; then
  echo "Not a hostname: '$PUBLIC_HOSTNAME'" >&2
  exit 1
fi
if [[ -z "${OPERATOR_NAME//[[:space:]]/}" ]]; then
  echo "A name is required — the page tells the sender who they're sending to." >&2
  exit 1
fi

{
  echo "# Written by setup.sh; read by start.sh and teardown.sh."
  printf 'PUBLIC_HOSTNAME=%q\n' "$PUBLIC_HOSTNAME"
  printf 'OPERATOR_NAME=%q\n' "$OPERATOR_NAME"
  printf 'TUNNEL_NAME=%q\n' "$TUNNEL_NAME"
} > "$ENV_FILE"
echo "Saved settings to $ENV_FILE."

# stderr is left visible: under pipefail a failed list aborts the script, and
# silencing it would make that exit look like nothing happened.
existing_id() {
  cloudflared tunnel list | awk -v n="$TUNNEL_NAME" '$2 == n { print $1 }'
}

if ! TUNNEL_ID="$(existing_id)"; then
  echo "Could not list tunnels — has 'cloudflared tunnel login' been run?" >&2
  exit 1
fi
if [[ -z "$TUNNEL_ID" ]]; then
  echo "Creating tunnel ${TUNNEL_NAME}…"
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID="$(existing_id)"
fi
if [[ -z "$TUNNEL_ID" ]]; then
  echo "Tunnel $TUNNEL_NAME not found after creating it — check 'cloudflared tunnel list'." >&2
  exit 1
fi
echo "Tunnel: $TUNNEL_NAME ($TUNNEL_ID)"

cat > cloudflared-config.yml <<CONFIG
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json
ingress:
  - hostname: $PUBLIC_HOSTNAME
    service: http://localhost:$PORT
  - service: http_status:404
CONFIG

echo "Routing DNS $PUBLIC_HOSTNAME → tunnel…"
if ! cloudflared tunnel route dns "$TUNNEL_NAME" "$PUBLIC_HOSTNAME"; then
  echo ""
  echo "DNS routing failed. Your cert.pem is likely scoped to a different zone."
  echo "Fix: cloudflared tunnel login   (pick the zone that contains $PUBLIC_HOSTNAME), then re-run ./setup.sh"
  exit 1
fi
echo "Setup complete. Run ./start.sh next."
