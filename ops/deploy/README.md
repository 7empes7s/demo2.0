# Deploying the citizen app on Mulinux

One service, `civic-companion`, serves three things from one Node process: the citizen app (`apps/citizen/dist`), the Docket snapshot, and the Companion API. Caddy sits in front. A second service, `civic-provenance`, grades the claims residents check (`modules/provenance`, `POST /claims/grade`). It listens on loopback only (`127.0.0.1:8090`) and only the Companion calls it (`/api/factcheck`, `PROVENANCE_URL`), so Caddy does not route it. A third, `civic-agora`, holds the ideas residents post (`modules/agora`); it too listens on loopback only (`127.0.0.1:8091`), and the Companion only reads its queue (`GET /api/ideas`, `AGORA_URL`). Until secure sign-in (Door) is deployed, Agora runs with `--read-only`: it needs no identity or key and refuses every post and upvote itself (`403 read_only`), and the Companion does not forward them either. A fourth, `civic-commons`, serves the argument library the Companion's devil's advocate draws from first (`modules/commons`, the seed library shipped in the release, `modules/commons/seed/esch.json`); it listens on loopback only (`127.0.0.1:8093`) and only the Companion reads it (`COMMONS_URL`). A fifth, `civic-desk`, holds what residents file, post and vote on and what staff answer (`modules/desk`); it listens on loopback only (`127.0.0.1:8094`), the Companion forwards `/api/desk/*` to it (`DESK_URL`) and serves the staff portals it needs from `apps/portal/dist` (`PORTAL_DIR`, under `/portal/`). The Companion listens on `PORT` from `companion.env` (default 8787); every `8787` below means that port, and `HEALTH_URLS` and the Caddy or tunnel upstream must use the same one (see [Mulinux notes](#mulinux-notes)). Deploys use brain's pull-based deployer (`templates/deploy/` in 7empes7s/brain). It ships only CI-green `main` commits and rolls back if the health checks fail.

## Files

| File | Goes to |
|---|---|
| `deploy.env.example` | `/etc/civic/deploy.env` (mode 600), read by `app-deploy@civic` |
| `companion.env.example` | `/etc/civic/companion.env` (mode 600), read by the service |
| `civic-companion.service` | `/etc/systemd/system/` |
| `civic-provenance.service` | `/etc/systemd/system/` (`PartOf=civic-companion.service`: every deploy, and every Docket refresh, restarts it with the Companion, so it reads the same release and snapshot) |
| `civic-agora.service` | `/etc/systemd/system/` (`PartOf=civic-companion.service`, like Provenance; its database is `/var/lib/civic-agora/agora.db`, outside the release tree, and starts empty) |
| `civic-desk.service` | `/etc/systemd/system/` (`PartOf=civic-companion.service`; reads `/etc/civic/desk.env`, mode 600, from `desk.env.example`; its database is `/var/lib/civic-desk/desk.db`, outside the release tree, seeded once from `modules/desk/seed/esch.json`) |
| `civic-commons.service` | `/etc/systemd/system/` (`PartOf=civic-companion.service`, like Provenance; serves the release's seed library read only, nothing is written) |
| `civic-docket.service`, `civic-docket.timer` | `/etc/systemd/system/` (refreshes Chamber and Esch-sur-Alzette data twice a day; the Esch part reads at 1 request per 3 seconds, so a run takes several minutes) |
| `cloudflared.yml`, `publish-cloudflare.sh` | public URL `https://cracia.techinsiderbytes.com` through a Cloudflare Tunnel (no open port) |
| `Caddyfile` | only if Caddy serves this site instead of the dedicated tunnel (on Mulinux it does, behind the main tunnel) |

## One-time install (as root on Mulinux)

```sh
# Node 22 and uv must be on /usr/local/bin or /usr/bin (systemd units do not see ~/.local/bin),
# plus git, curl and jq. Nothing heavy is built here (the app build takes about 1 s).
useradd --system --home /opt/civic --shell /usr/sbin/nologin civic
# uv's environment, cache and Python live in shared/ (civic-docket and civic-provenance use them;
# civic-provenance, civic-agora and civic-commons may write only there, so they must exist before their first start).
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
install -m 600 ops/deploy/companion.env.example /etc/civic/companion.env # then fill LLM_API_KEY (and LLM_BASE_URL, LLM_MODEL)
systemctl daemon-reload
systemctl enable civic-provenance.service civic-agora.service civic-commons.service civic-desk.service  # started with the Companion from now on
systemctl start app-deploy@civic.service       # first release; wait until it logs "live"
curl -s 127.0.0.1:8787/healthz                 # {"ok":true,"items":0,"companion":true,"model":{...},...,"provenance":true}
systemctl start civic-docket.service           # first real snapshot (needs /opt/civic/current); restarts all four services
curl -s 127.0.0.1:8090/healthz                 # {"ok": true, "items": N, "sentences": M}
curl -s 127.0.0.1:8091/healthz                 # {"ok": true, "ideas": 0, "identity": "none"}
curl -s 127.0.0.1:8093/healthz                 # {"ok": true, "arguments": 14, "matters": 2} (the seed library)
systemctl enable --now app-deploy@civic.timer civic-docket.timer
# Once the deployer has made the first release live (curl 127.0.0.1:8787/healthz):
ops/deploy/publish-cloudflare.sh       # tunnel + DNS for cracia.techinsiderbytes.com (reads PORT from companion.env)
```

The model is any OpenAI-compatible endpoint (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`; `modules/companion/README.md`, "Choosing a model"). Nothing heavy runs on Mulinux, so a local model there is not the plan: the bridge is a free tier with an open-weight model (Groq or OpenRouter) until Marouane's own hardware runs Ollama, and then `LLM_BASE_URL` points at it. The service starts even without a model configured. It then serves the app and the data, and the Companion routes answer 503. The app shows that the explainer is switched off. Claim checking needs no key: it works whenever `civic-provenance` is up. When it is down, `/api/factcheck` answers 503 and the app says the checker is unavailable. It never shows a grade Provenance did not give, and a grade that does not match `spec/schemas/grade.schema.json` is refused (502).

## Health

`GET /healthz` returns `{"ok":true,"items":N,"companion":true|false,"model":{"kind":"openai|anthropic","name":"..."}|null,"provenance":true|false,"agora":true|false,"desk":true|false}` (never a key). The service also logs `companion model: <kind> <name> at <scheme://host>` at start, host only. The deployer checks it (`HEALTH_URLS`) and requires five healthy checks in a row before a release counts as live.

The claim checker is optional and does not gate deploys. `provenance` says whether `civic-provenance` answered its own `/healthz` (checked at most every 30 s, waiting at most 1 s); `false` never fails the Companion's health check, and the app then says the checker is unavailable. To see why it is down: `curl -s 127.0.0.1:8090/healthz` (`{"ok": true, "items": N, "sentences": M}`) and `journalctl -u civic-provenance`.

The ideas list is optional in the same way, and Agora is deliberately not in `HEALTH_URLS`. `agora` says whether `civic-agora` answered its own `/healthz`; `false` never fails a deploy, and the app's Ideas page says the list is unavailable. `/api/ideas` answers 503 when Agora is unreachable or slow (3 s), 502 when its answer does not match `spec/schemas/idea.schema.json`, and 405 to any method other than GET. To see why it is down: `curl -s 127.0.0.1:8091/healthz` and `journalctl -u civic-agora`.

Opening posts and upvotes later needs, in this order: a `civic-door-verify.service` running a `d2-door` binary built in CI (nothing is built on Mulinux), Agora started with `DOOR_URL` and `DOOR_EPOCH` instead of `--read-only` (it then refuses to start if the database was opened with another epoch, unless `--new-epoch` is given), a per-client rate limit at the edge (Caddy or the Companion) on the routes that forward Agora's `GET /challenge` and its writes (Agora refuses new challenges with `503 challenge_capacity` when 10,000 are open, and never cancels one it handed out), and a Companion that forwards writes only while Agora's `/healthz` says `"identity": "door"`. Agora's development identity (`--dev-identity`) is never used here.

The argument library is optional in the same way and is not in `HEALTH_URLS`. The Companion does not report it in `/healthz`: when `civic-commons` is down or slow (2 s), the devil's advocate argues from the file's documents only and logs `commons unavailable`. To see why it is down: `curl -s 127.0.0.1:8093/healthz` (`{"ok": true, "arguments": N, "matters": M}`) and `journalctl -u civic-commons`.

## Mulinux notes

The live install (2026-10-05) differs from the steps above in three ways. Keep these when changing the files here.

- **Companion on port 8788.** Another service already listens on `127.0.0.1:8787`. `/etc/civic/companion.env` has `PORT=8788`, `/etc/civic/deploy.env` has `HEALTH_URLS="http://127.0.0.1:8788/healthz"`, and the Caddy upstream is `127.0.0.1:8788`. Every `8787` in this README means 8788 there. The loopback ports of the other services (8090, 8091, 8093) do not change.
- **Node 22 from `/opt/node22`.** The system Node is older and other services use it, so it stays. Drop-ins `civic-companion.service.d/node22.conf`, `civic-docket.service.d/node22.conf` and `civic-desk.service.d/node22.conf` put Node 22 first on `PATH` (Desk needs Node 22's `node:sqlite`, so its unit starts `node` from `PATH` like the Companion), and `deploy.env` does the same for the build. `BUILD_CMD` builds the citizen app and the staff portals (`apps/portal/dist`, served under `/portal/`). `uv` is in `/usr/local/bin`.
- **Public URL through the host's main tunnel and Caddy, not a `cracia` tunnel.** `publish-cloudflare.sh` and `cloudflared.yml` were not used. The main tunnel has an ingress rule `cracia.techinsiderbytes.com -> http://localhost:80` with a proxied CNAME, and the host Caddyfile has a host block for the site that reverse-proxies to `127.0.0.1:8788` with the headers from `Caddyfile` here.
