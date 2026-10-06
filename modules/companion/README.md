# Companion

The core of the citizen app. Given one file from the Docket snapshot, it can:

| Ability | What the resident gets | How it stays honest |
|---|---|---|
| `explain` | A plain-language explanation in lb, fr, de, en or pt, at short, standard or deep depth | Every factual sentence cites a numbered source and quotes it; a sentence is marked verified only when the quote is found word for word in that source |
| `extractArguments` | The arguments named institutions make in the file's own documents (the Commons seed for Phase 1) | Arguments whose quote isn't in the cited source are dropped |
| `challenge` | A devil's advocate that argues the other side, from Commons first, then those arguments | It may rephrase, never invent; each turn lists the arguments it shows with their source links, and labels any point the model wrote itself. With 2 or more Commons reasons on the other side (recorded votes don't count), model-written points are not shown |
| `checkClaim` | Green / yellow / red for a claim the resident heard, with quotes | Green or red needs at least one verified quote, otherwise the grade drops to yellow |

Prompts are versioned (`PROMPT_VERSION`) and every answer records the prompt version, model and item it came from. The Companion never recommends how to vote.

## Server

```
SNAPSHOT=data/lu-chd.json ANTHROPIC_API_KEY=... STATIC_DIR=apps/citizen/dist npm run serve -w @democracy2/companion
```

Set `COMMONS_URL` to a Commons API (`d2-commons serve`) to draw the other side from it. One process serves the app, `/data/snapshot.json`, `/healthz` and `POST /api/{explain,arguments,challenge,claim}`. The browser names an item; the server builds the prompt, so the key can't be used as a general model proxy. Model calls are rate limited per client and explanations are cached.

Licence: held (see LICENSE).
