# Deploying the citizen app on Mulinux

One service, `civic-companion`, serves three things from one Node process: the citizen app (`apps/citizen/dist`), the Docket snapshot, and the Companion API. Caddy sits in front. A second service, `civic-provenance`, grades the claims residents check (`modules/provenance`, `POST /claims/grade`). It listens on loopback only (`127.0.0.1:8090`) and only the Companion calls it (`/api/factcheck`, `PROVENANCE_URL`), so Caddy does not route it. A third, `civic-agora`, holds the ideas residents post (`modules/agora`); it too listens on loopback only (`127.0.0.1:8091`), and the Companion only reads its queue (`GET /api/ideas`, `AGORA_URL`). Posting and supporting ideas are not proxied until secure sign-in exists. Deploys use brain's pull-based deployer (`templates/deploy/` in 7empes7s/brain). It ships only CI-green `main` commits and rolls back if the health checks fail.

## Files

| File | Goes to |
|---|---|
| `deploy.env.example` | `/etc/civic/deploy.env` (mode 600), read by `app-deploy@civic` |
| `companion.env.example` | `/etc/civic/companion.env` (mode 600), read by the service |
| `civic-companion.service` | `/etc/systemd/system/` |
| `civic-provenance.service` | `/etc/systemd/system/` (`PartOf=civic-companion.service`: every deploy, and every Docket refresh, restarts it with the Companion, so it reads the same release and snapshot) |
| `civic-agora.service` | `/etc/systemd/system/` (`PartOf=civic-companion.service`, like Provenance; its database is `/var/lib/civic-agora/agora.db`, outside the release tree, and starts empty) |
| `civic-docket.service`, `civic-docket.timer` | `/etc/systemd/system/` (refreshes Chamber and Esch-sur-Alzette data twice a day; the Esch part reads at 1 request per 3 seconds, so a run takes several minutes) |
| `cloudflared.yml`, `publish-cloudflare.sh` | public URL `https://cracia.techinsiderbytes.com` through a Cloudflare Tunnel (no open port) |
| `Caddyfile` | only if Caddy terminates TLS for this site instead of the tunnel |

## One-time install (as root on Mulinux)

```sh
# Node 22 and uv must be on /usr/local/bin or /usr/bin (systemd units do not see ~/.local/bin),
# plus git, curl and jq. Nothing heavy is built here (the app build takes about 1 s).
useradd --system --home /opt/civic --shell /usr/sbin/nologin civic
# uv's environment, cache and Python live in shared/ (civic-docket and civic-provenance use them;
# civic-provenance may write only there, so they must exist before its first start).
mkdir -p /opt/civic/shared/{venv,uv-cache,python} /etc/civic
# An empty snapshot so the first release can start before Docket has run.
echo '{"schema":"d2.docket.snapshot/2","generated_at":"1970-01-01T00:00:00Z","sources":[],"items":[],"meetings":[],"errors":[]}' > /opt/civic/shared/lu-chd.json
chown -R civic: /opt/civic
# Brain's deployer
cp brain/templates/deploy/deploy.sh /usr/local/bin/app-deploy
cp brain/templates/deploy/app-deploy@.* /etc/systemd/system/
# This repo's units and settings
cp ops/deploy/civic-*.service ops/deploy/civic-docket.timer /etc/systemd/system/
install -m 600 ops/deploy/deploy.env.example /etc/civic/deploy.env       # then fill GH_TOKEN
install -m 600 ops/deploy/companion.env.example /etc/civic/companion.env # then fill ANTHROPIC_API_KEY
# Agora's nym key: 32 random bytes, base64-encoded so the file holds no whitespace bytes that
# Agora's loader would trim (it strips the file, then needs at least 32 bytes). Never in git, never
# copied off the box; keep it for the life of the database (a new key changes every pseudonym).
(umask 077; head -c 32 /dev/urandom | base64 > /etc/civic/agora-nym.key)
chown civic: /etc/civic/agora-nym.key && chmod 600 /etc/civic/agora-nym.key
systemctl daemon-reload
systemctl enable civic-provenance.service civic-agora.service  # started with the Companion from now on
systemctl start app-deploy@civic.service       # first release; wait until it logs "live"
curl -s 127.0.0.1:8787/healthz                 # {"ok":true,"items":0,...,"provenance":true}
systemctl start civic-docket.service           # first real snapshot (needs /opt/civic/current); restarts both services
curl -s 127.0.0.1:8090/healthz                 # {"ok": true, "items": N, "sentences": M}
curl -s 127.0.0.1:8091/healthz                 # {"ok": true, "ideas": 0}
systemctl enable --now app-deploy@civic.timer civic-docket.timer
# Once the deployer has made the first release live (curl 127.0.0.1:8787/healthz):
ops/deploy/publish-cloudflare.sh       # tunnel + DNS for cracia.techinsiderbytes.com
```

The service starts even without `ANTHROPIC_API_KEY`. It then serves the app and the data, and the Companion routes answer 503. The app shows that the explainer is switched off. Claim checking needs no key: it works whenever `civic-provenance` is up. When it is down, `/api/factcheck` answers 503 and the app says the checker is unavailable. It never shows a grade Provenance did not give, and a grade that does not match `spec/schemas/grade.schema.json` is refused (502).

## Health

`GET /healthz` returns `{"ok":true,"items":N,"companion":true|false,"provenance":true|false,"agora":true|false}`. The deployer checks it (`HEALTH_URLS`) and requires five healthy checks in a row before a release counts as live.

The claim checker is optional and does not gate deploys. `provenance` says whether `civic-provenance` answered its own `/healthz` (checked at most every 30 s, waiting at most 1 s); `false` never fails the Companion's health check, and the app then says the checker is unavailable. To see why it is down: `curl -s 127.0.0.1:8090/healthz` (`{"ok": true, "items": N, "sentences": M}`) and `journalctl -u civic-provenance`.

The ideas list is optional in the same way, and Agora is deliberately not in `HEALTH_URLS`. `agora` says whether `civic-agora` answered its own `/healthz`; `false` never fails a deploy, and the app's Ideas page says the list is unavailable. `/api/ideas` answers 503 when Agora is unreachable or slow (3 s), 502 when its answer does not match `spec/schemas/idea.schema.json`, and 405 to any method other than GET. To see why it is down: `curl -s 127.0.0.1:8091/healthz` and `journalctl -u civic-agora`. If it logs `cannot read the nym key file` or `the nym key must be at least 32 bytes`, recreate the key as above (only on a new, empty database).
