# Civic Companion (citizen app)

The resident-facing app for Luxembourg.

- Lists what the Chamber of Deputies has on its agenda, from the Docket snapshot.
- Explains each file in Luxembourgish, French, German, English or Portuguese. Every sentence cites the official document it comes from.
- Asks where you stand, keeps that answer on your device, and argues the other side using only arguments that official bodies made about the file.
- Checks a claim you heard against the documents, graded green, yellow or red.

The app never tells anyone how to vote. See `VOCABULARY.md` for the words it uses.

## Run it

```sh
npm install                      # from the repo root
npm run dev -w @democracy2/citizen   # Vite on :5173, proxies /api and /data to :8787
SNAPSHOT=path/to/lu-chd.json ANTHROPIC_API_KEY=… npm run serve -w @democracy2/companion
```

## Two builds

- `npm run build` produces `dist/`, which the Companion server serves (`STATIC_DIR=apps/citizen/dist`). The browser sends only an item id. The server builds every prompt and holds the API key.
- `npm run build:single`, then `node scripts/embed.mjs <snapshot.json>`, produces one self-contained HTML file with the snapshot inside. Pass `--fragment` to get the version for a claude.ai artifact. That version runs the Companion core in the page, uses the viewer's own Claude as the model (the `sample` capability), and needs no server or key.
