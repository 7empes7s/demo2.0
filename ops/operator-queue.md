# Operator queue (Mulinux)

Server work for the cracia deploy (`https://cracia.techinsiderbytes.com`) that the cloud sessions cannot do themselves. Newest first.

How it works:

- A builder adds an entry here in the same PR as the change that needs it, then sends the steps to the operator session on Mulinux **as a message**. That session does the server work and confirms it with live checks.
- When the work is done, the entry moves to **Done** with the date and a link to the evidence (the live checks, posted on a demo2.0 issue or PR).
- Secrets never go in this file, an issue, a PR or chat. Marouane gives a key to the operator session directly, which writes it into `/etc/civic/*.env` (mode 600).
- Install steps themselves live in `ops/deploy/README.md`; an entry says only what changes and how to tell it worked.

History: from 2026-10-05 to 2026-10-07 this queue lived in the keel repo (`ops/operator-queue.md` there). It moved here on 2026-10-08; keel no longer carries cracia work.

## Open

### 2026-10-07: reinstall the Companion unit for translations

- Why: the translations PR added `StateDirectory=civic-companion` to `ops/deploy/civic-companion.service` (see STATE.md, "Files in the resident's language").
- Steps: copy the unit from the live release to `/etc/systemd/system/` (keep the `node22.conf` drop-in), `systemctl daemon-reload`, restart `civic-companion`.
- Done when: `systemctl show -p StateDirectory civic-companion` names `civic-companion`, and once a model key is set (next entry) `/data/translations.json` is served.
- Status: not yet confirmed on the box.

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
| 2026-10-09 | Desk bootstrap password removed: `/etc/civic/desk-admin.initial` deleted, `DESK_BOOTSTRAP_PASSWORD` blanked in `/etc/civic/desk.env` | Marouane, in the project chat, 2026-10-09 (after changing the `admin` password) |
| 2026-10-07 09:12 | Desk and the staff portals: `civic-desk` on 127.0.0.1:8094, `/etc/civic/desk.env`, `DESK_URL` and `PORTAL_DIR` in `companion.env`, portals built and served at `/portal/` | #48 (comment of 2026-10-07). Marouane changed the `admin` password on 2026-10-09. No backup job for `/var/lib/civic-desk/desk.db` yet. |
| 2026-10-06 03:33 | Commons argument library: `civic-commons` on 127.0.0.1:8093, `COMMONS_URL` in `companion.env` | #25 (second comment) |
| 2026-10-06 03:15 | Claim checker and read-only Ideas list: `civic-provenance` (8090) and `civic-agora --read-only` (8091), `PROVENANCE_URL` and `AGORA_URL` in `companion.env` | #25 (first comment) |
| 2026-10-05 22:55 | Citizen app live at `cracia.techinsiderbytes.com` through the `cracia` Cloudflare tunnel | #12 |
