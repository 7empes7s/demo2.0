# Deploying the citizen app on Mulinux

One service, `civic-companion`, serves three things from one Node process: the citizen app (`apps/citizen/dist`), the Docket snapshot, and the Companion API. Caddy sits in front. Deploys use brain's pull-based deployer (`templates/deploy/` in 7empes7s/brain). It ships only CI-green `main` commits and rolls back if the health checks fail.

## Files

| File | Goes to |
|---|---|
| `deploy.env.example` | `/etc/civic/deploy.env` (mode 600), read by `app-deploy@civic` |
| `companion.env.example` | `/etc/civic/companion.env` (mode 600), read by the service |
| `civic-companion.service` | `/etc/systemd/system/` |
| `civic-docket.service`, `civic-docket.timer` | `/etc/systemd/system/` (refreshes Chamber data daily) |
| `cloudflared.yml`, `publish-cloudflare.sh` | public URL `https://cracia.techinsiderbytes.com` through a Cloudflare Tunnel (no open port) |
| `Caddyfile` | only if Caddy terminates TLS for this site instead of the tunnel |

## One-time install (as root on Mulinux)

```sh
# Node 22 and uv must be on /usr/local/bin or /usr/bin (systemd units do not see ~/.local/bin),
# plus git, curl and jq. Nothing heavy is built here (the app build takes about 1 s).
useradd --system --home /opt/civic --shell /usr/sbin/nologin civic
mkdir -p /opt/civic/shared /etc/civic
# An empty snapshot so the first release can start before Docket has run.
echo '{"schema":"d2.docket.snapshot/1","generated_at":"1970-01-01T00:00:00Z","items":[],"meetings":[],"errors":[]}' > /opt/civic/shared/lu-chd.json
chown -R civic: /opt/civic
# Brain's deployer
cp brain/templates/deploy/deploy.sh /usr/local/bin/app-deploy
cp brain/templates/deploy/app-deploy@.* /etc/systemd/system/
# This repo's units and settings
cp ops/deploy/civic-*.service ops/deploy/civic-docket.timer /etc/systemd/system/
install -m 600 ops/deploy/deploy.env.example /etc/civic/deploy.env       # then fill GH_TOKEN
install -m 600 ops/deploy/companion.env.example /etc/civic/companion.env # then fill ANTHROPIC_API_KEY
systemctl daemon-reload
systemctl start app-deploy@civic.service       # first release; wait until it logs "live"
curl -s 127.0.0.1:8787/healthz                 # {"ok":true,"items":0,...}
systemctl start civic-docket.service           # first real snapshot (needs /opt/civic/current)
systemctl enable --now app-deploy@civic.timer civic-docket.timer
# Once the deployer has made the first release live (curl 127.0.0.1:8787/healthz):
ops/deploy/publish-cloudflare.sh       # tunnel + DNS for cracia.techinsiderbytes.com
```

The service starts even without `ANTHROPIC_API_KEY`. It then serves the app and the data, and the Companion routes answer 503. The app shows that the explainer is switched off.

## Health

`GET /healthz` returns `{"ok":true,"items":N,"companion":true|false}`. The deployer requires five healthy checks in a row before a release counts as live.
