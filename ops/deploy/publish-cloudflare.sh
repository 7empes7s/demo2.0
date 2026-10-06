#!/usr/bin/env bash
# Publish the running civic-companion service at cracia.techinsiderbytes.com through a
# Cloudflare Tunnel. Run as root on Mulinux after the service is healthy on its PORT
# (from /etc/civic/companion.env, default 8787; override with COMPANION_PORT).
# Idempotent: re-running reuses the tunnel and DNS route.
set -euo pipefail
HOST="${HOST:-cracia.techinsiderbytes.com}"
NAME="${NAME:-cracia}"
CONF="/etc/cloudflared/$NAME.yml"
ENV_FILE=/etc/civic/companion.env
PORT_FROM_ENV=""
if [ -z "${COMPANION_PORT:-}" ] && [ -r "$ENV_FILE" ] && grep -qE '^[[:space:]]*(export[[:space:]]+)?PORT[[:space:]]*=' "$ENV_FILE"; then
  PORT_FROM_ENV=$(sed -nE "s/^[[:space:]]*(export[[:space:]]+)?PORT[[:space:]]*=[[:space:]]*[\"']?([0-9]+)[\"']?[[:space:]]*\r?\$/\2/p" "$ENV_FILE" | tail -1)
  [ -n "$PORT_FROM_ENV" ] || { echo "cannot read PORT from $ENV_FILE; set COMPANION_PORT"; exit 1; }
fi
PORT="${COMPANION_PORT:-${PORT_FROM_ENV:-8787}}"
case "$PORT" in ''|*[!0-9]*) echo "PORT must be a number, got '$PORT'"; exit 1;; esac

command -v cloudflared >/dev/null || { echo "cloudflared is not installed"; exit 1; }
curl -fsS --max-time 5 "http://127.0.0.1:$PORT/healthz" | grep -q '"companion"' || { echo "civic-companion is not healthy on :$PORT"; exit 1; }

id=$(cloudflared tunnel list --output json | jq -r --arg n "$NAME" '.[] | select(.name == $n) | .id' | head -1)
if [ -z "$id" ]; then
  cloudflared tunnel create "$NAME"
  id=$(cloudflared tunnel list --output json | jq -r --arg n "$NAME" '.[] | select(.name == $n) | .id' | head -1)
fi
creds="$HOME/.cloudflared/$id.json"
install -d -m 700 /etc/cloudflared
[ -f "/etc/cloudflared/$id.json" ] || install -m 600 "$creds" "/etc/cloudflared/$id.json"
sed "s/TUNNEL_ID/$id/g; s/cracia.techinsiderbytes.com/$HOST/; s/127.0.0.1:8787/127.0.0.1:$PORT/" "$(dirname "$0")/cloudflared.yml" > "$CONF"
chmod 600 "$CONF"
cloudflared tunnel route dns --overwrite-dns "$NAME" "$HOST"

cat > /etc/systemd/system/cloudflared-$NAME.service <<UNIT
[Unit]
Description=Cloudflare Tunnel for $HOST
After=network-online.target civic-companion.service
Wants=network-online.target

[Service]
ExecStart=$(command -v cloudflared) --no-autoupdate tunnel --config $CONF run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now "cloudflared-$NAME.service"

for i in $(seq 1 20); do
  if curl -fsS --max-time 5 "https://$HOST/healthz"; then echo; echo "live: https://$HOST"; exit 0; fi
  sleep 3
done
echo "tunnel started but https://$HOST/healthz is not answering yet; check: journalctl -u cloudflared-$NAME"
exit 1
