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

## Install and offline

The served build (`dist/`) can be installed to a phone's home screen and opens offline.

- `public/manifest.webmanifest` names the app and lists the icons. The icons are drawn from `icons/*.svg`. To redraw them after changing an SVG, run `NODE_PATH=<dir with playwright> node icons/render.mjs`. The PNGs are committed, and the build does not draw them.
- `sw.js` is the service worker. At build time `vite.config.ts` writes this build's file list and a cache version into it and emits `dist/sw.js`.
  - The app's files are cached on install and served from the cache.
  - Pages and `data/snapshot.json` go to the network first. When offline, the saved copy is used, so the list still opens.
  - `/api/*` requests and other sites are never cached.
  - A new build gets a new cache, and the old one is removed. The saved snapshot is kept.
- `src/lib/pwa.ts` registers the worker only in this build, and only on https or on localhost. Dev and the single-file build never register one, and the single-file page links no manifest.
- The Companion server sends `sw.js`, the manifest and the page with `Cache-Control: no-cache`, so installed copies update.
