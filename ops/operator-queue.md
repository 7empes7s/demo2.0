# Operator queue (Mulinux)

Server work for the cracia deploy (`https://cracia.techinsiderbytes.com`) that the cloud sessions cannot do themselves. Newest first.

How it works:

- A builder adds an entry here in the same PR as the change that needs it, then sends the steps to the operator session on Mulinux **as a message**. That session does the server work and confirms it with live checks.
- When the work is done, the entry moves to **Done** with the date and a link to the evidence (the live checks, posted on a demo2.0 issue or PR).
- Secrets never go in this file, an issue, a PR or chat. Marouane gives a key to the operator session directly, which writes it into `/etc/civic/*.env` (mode 600).
- Install steps themselves live in `ops/deploy/README.md`; an entry says only what changes and how to tell it worked.

History: from 2026-10-05 to 2026-10-07 this queue lived in the keel repo (`ops/operator-queue.md` there). It moved here on 2026-10-08; keel no longer carries cracia work.

## Open

### 2026-11-04: install the nightly backup and run the first restore drill

- Why: nothing backed up `/var/lib/civic-desk/desk.db` (the hash-chained log, ballots, staff accounts) or `/var/lib/civic-agora/agora.db` (issue #82).
- Waits on: the release with `modules/desk/src/backup.ts` being live (any deploy after the PR merges).
- Steps (details in `ops/deploy/README.md`, "Backups and the restore drill"):
  1. Copy `civic-backup.service` and `civic-backup.timer` from the live release to `/etc/systemd/system/`, and add the drop-in `civic-backup.service.d/node22.conf` (same content as `civic-desk.service.d/node22.conf`).
  2. `systemctl daemon-reload && systemctl enable --now civic-backup.timer && systemctl start civic-backup.service`.
  3. Run the restore drill once, at a quiet hour.
- Done when: `systemctl list-timers civic-backup.timer` shows the next run; `journalctl -u civic-backup -n 5` shows `desk: ... integrity ok, chain ok, N entries` and `agora: ... integrity ok`; `ls -l /var/backups/civic/<today>` shows three files, mode `-rw-------`, owner `civic`; after the drill, the `--check` of the restored `desk.db` shows `"ok":true` with the manifest's head, and `/healthz` shows `"desk":true,"agora":true`. Post that output on #82.

### 2026-11-04: set Esch-sur-Alzette's postcodes on the Desk portal (issue #81)

- Why: Desk can now refuse a request for a code by post from outside the commune, but only once an admin sets the commune's postcodes. Until then every four-digit postcode is accepted (the old behaviour). The ranges are not hard-coded: they must come from Post Luxembourg's official list of postcodes for Esch-sur-Alzette, which this PR could not cite.
- Steps (an admin on the portal, no server work): open Post Luxembourg's postcode search (or its downloadable list of streets and postcodes) for the locality Esch-sur-Alzette; enter the postcodes as ranges or single codes, one per line, in **Settings, Postcodes of the commune**; save.
- Done when: `GET /api/desk/settings` (as admin) lists the ranges, the event log shows a `settings.changed` entry with `commune.postcodes`, and a request for a code by post with a postcode outside them is refused in the citizen app with "This service is for residents of this commune only".

### 2026-11-04: turn on the Desk log's daily public fingerprint

- Why: the daily public fingerprint of the Desk log (issue #74, which superseded PR #67) is off until the log has a name.
- Steps: once that PR is deployed, add `DESK_LOG_NAME=cracia.techinsiderbytes.com/desk` to `/etc/civic/desk.env`, restart `civic-desk`, and keep an offline copy of `/var/lib/civic-desk/log.key` (mode 600; the nightly `civic-backup` copies only the databases, not this key). Post the `key` value from `/fingerprints` on the PR so it can be pinned in the repo.
- Done when: the start-up log reads `daily fingerprint on, key cracia.techinsiderbytes.com/desk+...` and `fingerprint <today>: N entries`; `curl -s https://cracia.techinsiderbytes.com/api/desk/fingerprints` shows `"enabled":true` with today's day; within an hour that day's `ots` is not null (the calendars are reachable); and `node --experimental-strip-types /opt/civic/current/modules/desk/src/check-log.ts --url https://cracia.techinsiderbytes.com/api/desk --vkey '<key>'` exits 0.

### 2026-10-07: reinstall the Companion unit for translations

- Why: the translations PR added `StateDirectory=civic-companion` to `ops/deploy/civic-companion.service` (see STATE.md, "Files in the resident's language").
- Steps: copy the unit from the live release to `/etc/systemd/system/` (keep the `node22.conf` drop-in), `systemctl daemon-reload`, restart `civic-companion`.
- Done when: `systemctl show -p StateDirectory civic-companion` names `civic-companion`, and once a model key is set (next entry) `/data/translations.json` is served.
- Status: unit part done (keel-operator, 2026-10-08 08:32 UTC): `StateDirectory=civic-companion`, `/var/lib/civic-companion`
  exists, service active (#61). `/data/translations.json` is served but `texts` stays empty until the Groq entry below is done.

### 2026-10-06: switch the Companion to a free-tier open-weight model (Groq)

- Why: the Companion and Desk run with no model (`"companion": false`, `"model": null`; Desk `LLM_API_KEY` empty, issue #48). The model-agnostic provider (#40) is merged and live: the 2026-10-07 deploy's `/healthz` already carries the `model` field #40 added (#48).
- Waits on: **Marouane's Groq key**, given to the operator session directly, never in chat.
- Steps:
  1. In `/etc/civic/companion.env` and `/etc/civic/desk.env`: `LLM_BASE_URL=https://api.groq.com/openai/v1`, `LLM_MODEL=llama-3.3-70b-versatile`, `LLM_API_KEY=<the key>`. Leave `ANTHROPIC_API_KEY` unset.
  2. Restart `civic-companion` and `civic-desk`.
- Done when: `curl -s 127.0.0.1:8788/healthz` shows `"companion":true,"model":{"kind":"openai","name":"llama-3.3-70b-versatile"}`, the start-up log reads `companion model: openai llama-3.3-70b-versatile at https://api.groq.com`, and one explain request in the app returns an answer instead of "switched off".

## Done

| Date (UTC) | Entry | Evidence |
|---|---|---|
| 2026-10-09 | Desk bootstrap password removed: `/etc/civic/desk-admin.initial` deleted, `DESK_BOOTSTRAP_PASSWORD` blanked in `/etc/civic/desk.env` | Marouane, in the project chat, 2026-10-09 (after changing the `admin` password). Live checks by keel-operator at 09:10 UTC: file gone, `DESK_BOOTSTRAP_PASSWORD` blank, `civic-desk` restarted 09:07 and healthy: #48 (comment of 2026-10-09) |
| 2026-10-07 09:12 | Desk and the staff portals: `civic-desk` on 127.0.0.1:8094, `/etc/civic/desk.env`, `DESK_URL` and `PORTAL_DIR` in `companion.env`, portals built and served at `/portal/` | #48 (comment of 2026-10-07). Marouane changed the `admin` password on 2026-10-09. No backup job for `/var/lib/civic-desk/desk.db` yet. |
| 2026-10-06 03:33 | Commons argument library: `civic-commons` on 127.0.0.1:8093, `COMMONS_URL` in `companion.env` | #25 (second comment) |
| 2026-10-06 03:15 | Claim checker and read-only Ideas list: `civic-provenance` (8090) and `civic-agora --read-only` (8091), `PROVENANCE_URL` and `AGORA_URL` in `companion.env` | #25 (first comment) |
| 2026-10-05 22:55 | Citizen app live at `cracia.techinsiderbytes.com` through the `cracia` Cloudflare tunnel | #12 |
