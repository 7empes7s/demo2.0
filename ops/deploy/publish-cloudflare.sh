#!/usr/bin/env bash
# Publish the running civic-companion service at cracia.techinsiderbytes.com through a
# Cloudflare Tunnel. Run as root on Mulinux after the service is healthy on its PORT
# (from /etc/civic/companion.env, default 8787; override with COMPANION_PORT).
# Idempotent: re-running reuses the tunnel and DNS route.
set -euo pipefail
HOST="${HOST:-cracia.techinsiderbytes.com}"
NAME="${NAME:-cracia}"
CONF="/etc/cloudflared/$NAME.yml"
PORT_FROM_ENV=$(sed -n 's/^PORT=\([0-9][0-9]*\)$/\1/p' /etc/civic/companion.env 2>/dev/null | tail -1 || true)
PORT="${COMPANION_PORT:-${PORT_FROM_ENV:-8787}}"

command -v cloudflared >/dev/null || { echo "cloudflared is not installed"; exit 1; }
curl -fsS --max-time 5 "http://127.0.0.1:$PORT/healthz" >/dev/null || { echo "civic-companion is not healthy on :$PORT"; exit 1; }

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
