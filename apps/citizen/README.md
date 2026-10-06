# Civic Companion (citizen app)

The resident-facing app for Luxembourg.

- Opens on "This week": the files that affect where you live and the files on topics you follow, sorted on the device by `@democracy2/pulse`. Where you live and your topics stay in `localStorage`; every device downloads the same list, so the server never learns them.
- Lists what the Chamber of Deputies has on its agenda, from the Docket snapshot.
- Explains each file in Luxembourgish, French, German, English or Portuguese. Every sentence cites the official document it comes from.
- Asks where you stand, keeps that answer on your device, and argues the other side using only arguments that official bodies made about the file.
- Shows the ideas residents posted on Agora (`#ideas`, served build only), read only: posting and supporting open once secure sign-in is ready. The Companion server reads them (`GET /api/ideas`) and drops proposer pseudonyms.
- Asks 3 to 5 quick questions on what each file's official text says (Arena), with the quoted passage after each answer. Progress stays on the device; nothing is sent. Questions come from `@democracy2/arena` (hand-written for a few files, made by fixed rules for the rest).
- Checks a claim you heard against the documents, graded green, yellow or red. The served build asks Provenance through the Companion server (`/api/factcheck`), on each file and on its own page (`#check`); the single-file demo asks the Companion.

The app never tells anyone how to vote. See `VOCABULARY.md` for the words it uses.

## Run it

```sh
npm install                      # from the repo root
npm run dev -w @democracy2/citizen   # Vite on :5173, proxies /api and /data to :8787
SNAPSHOT=path/to/lu-chd.json AI_BASE_URL=http://127.0.0.1:11434/v1 AI_MODEL=qwen2.5:7b-instruct npm run serve -w @democracy2/companion
uv run d2-provenance serve --docket path/to/lu-chd.json   # the claim checker on :8090 (optional)
```

## Two builds

- `npm run build` produces `dist/`, which the Companion server serves (`STATIC_DIR=apps/citizen/dist`). The browser sends only an item id. The server builds every prompt and holds the model endpoint and its key, if any (`modules/companion/README.md`, "The model").
- `npm run build:single`, then `node scripts/embed.mjs <snapshot.json>`, produces one self-contained HTML file with the snapshot inside. Pass `--fragment` to get the version for a claude.ai artifact. That version runs the Companion core in the page, uses the viewer's own Claude as the model (the `sample` capability), and needs no server or key.

## Look

The app is Affichage: paper sheets pasted on a public wall (the decision and its pages are in `docs/design/`). It is the only look; there is no flag.

- `src/tokens.css` is the only source of colour and material. Light is the wall by day (cream plaster, paper, ink); dark is the wall with the lights off (a near-black wall, charcoal sheets, cream print, soft grey lines, amber only for what is pressed, chosen or yours). Every sheet class remaps the tokens for what is printed on it, so a component never knows which mode it is in.
- Materials are tokens too: `--rule` (the ink border), `--backing` (the second sheet behind a button), `--backing-navy`, `--pressed-bg` and `--pressed-fg` (a pressed or chosen thing), `--accent-line`, `--ink`, `--paper`. Components use them for their own sheets and marks; nothing has a radius or a blurred shadow.
- Titles (`.serif`), labels and buttons are set in Big Shoulders Display; data in JetBrains Mono; body text in Public Sans.
- Motion, at the end of `tokens.css` and only under `prefers-reduced-motion: no-preference`: new sheets are pasted on, buttons press, the old screen peels off on a screen change (a view transition, run by `peel()` in `src/lib/look.ts` when the browser has the API), a score flaps in and waiting is marching ants. Readers who ask for less motion get none, and screen changes switch on the spot.

## Install and offline

The served build (`dist/`) can be installed to a phone's home screen and opens offline.

- `public/manifest.webmanifest` names the app and lists the icons. The icons are drawn from `icons/*.svg`. To redraw them after changing an SVG, run `NODE_PATH=<dir with playwright> node icons/render.mjs`. The PNGs are committed, and the build does not draw them.
- `sw.js` is the service worker. At build time `vite.config.ts` writes this build's file list and a cache version into it and emits `dist/sw.js`. The version is a hash of the bytes of every cached file, `public/` included, so changing only an icon or the manifest still ships an update.
  - The app's files are cached on install (bypassing the HTTP cache) and served from the cache. Other files under `/assets/` are cached the first time they are fetched.
  - Pages and `data/snapshot.json` go to the network first. When offline, when the server answers 5xx, or when the network takes over 4 seconds and a saved copy exists, the saved copy is used, so the list still opens.
  - Only the app page itself (`/` or `/index.html`, served as HTML) is saved as the offline app. Error and partial responses are never saved, and a failed cache write never fails the request.
  - `/api/*` requests and other sites are never cached.
  - A new build gets a new cache, and the old one is removed. The saved snapshot is kept.
- `src/lib/pwa.ts` registers the worker only in this build, and only on https or on localhost. Dev and the single-file build never register one, and the single-file page links no manifest.
- The Companion server sends `sw.js`, the manifest and the page with `Cache-Control: no-cache`, so installed copies update.
