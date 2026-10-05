# Provenance

Send a factual claim, get a grade with the records it rests on:

| Grade | Means |
|---|---|
| `green` | Solid: a record states it. |
| `yellow` | Contested or unclear: the records neither confirm nor contradict it, they disagree, or it is a matter of opinion. |
| `red` | Flatly false: a record states something else. |

Every grade carries at least one piece of evidence: the link a reader opens, the passage and where
it is. A claim no record mentions gets no grade at all (HTTP 404, CLI exit 3). Provenance never
grades values or opinions.

Python package `d2_provenance`, stdlib only. Licence: AGPL-3.0-or-later.

## Run it

```sh
# Records come from a Docket snapshot (uv run d2-docket snapshot --out data/docket.json).
uv run d2-provenance grade --docket data/docket.json "Le projet de loi 8752 a été déposé le 15 mai 2026" --why
uv run d2-provenance grade --docket data/docket.json --context lu.esch.42063 "Voté à l'unanimité"
uv run d2-provenance serve --docket data/docket.json --port 8090
uv run d2-provenance eval  --labels modules/provenance/labels/recorded-v0.json
```

Exit codes: `0` ok, `1` eval below its bar, `2` bad input, `3` no record mentions the claim.

## API

| Route | Body | Answer |
|---|---|---|
| `POST /claims/grade` | `{"text": "...", "context": "lu.chd.8752"}` (`context` optional: the Docket item the claim is about) | `200` a `Grade` (`spec/schemas/grade.schema.json`): `claim_id`, `checker_id`, `grade`, `evidence[]` (`url`, `source_document_id`, `excerpt`, `locator`), `model_version`. `404` no record mentions the claim. `400` bad input, `413` body over 16 KiB. |
| `GET /checkers` | | `{"checkers": [{checker_id, model_version, method, corpus}]}` |
| `GET /healthz` | | `{ok, items, sentences}` |

`claim_id` is `claim-` plus the first 16 hex digits of SHA-256 over text and context, so the same
claim always gets the same id. `model_version` is `match/1+docket:<first 12 hex of the snapshot's
SHA-256>`: a grade names both the rules and the records it came from. `source_document_id` is
`sha256:<hash>` of the fetched document when Docket fetched it, else `null`.

## How the `match` checker grades

It is deterministic: no language model, no network. The rules, in order:

1. **Which records.** `context` picks one Docket item. Otherwise a Chamber dossier number in the
   claim next to a word like *loi*, *bill*, *Gesetz*, *projeto* or *débat* picks that dossier.
   Otherwise every item is searched.
2. **Opinion.** A claim with a value word (*should*, *devrait*, *unfair*, *trop*, *scandale* ...)
   is yellow, shown with the closest records.
3. **Structured facts** (only for one picked item, and only when the claim has no negation):
   - *Deposit date*: a deposit word (*déposé*, *filed*, *eingereicht*, *apresentado* ...) and
     exactly one date. Same as the record: green; different: red.
   - *Council vote*: a tally ("11 voix contre 8", "12 votes to 7", "11 Stëmme fir"), counts
     ("8 voix contre") or unanimity (*unanimité*, *einstimmig* ...). Matches the record: green;
     differs: red. "Rejected by 11 to 8" is read as 11 against.
4. **Record text** (only if rule 3 did not decide). Records are split into sentences: title,
   history rows, summary and document text. For a claim of at least 3 content words, a sentence
   that carries every one of them (one may be missing per ten), the same negation and the same
   references (`2024/2809`):
   - with every number and date of the claim: green;
   - with a different number for the same counted thing ("40 %" vs "50 %", "250 millions" vs
     "300 millions") or a different date, and none matching: red.
   Green and red sentences for the same claim make it yellow.
5. **Otherwise** yellow, with up to three sentences that share at least a third of the claim's
   content words. None: no grade.

Dates are read in fr, de, en, pt and lb (`15 mai 2026`, `15. Mai 2026`, `May 15, 2026`,
`15/05/2026`, `2026-05-15`). Numbers read `5.000`, `5 000` and `5,000` as 5000 and `12,5` as 12.5.
Words are compared after folding case and accents and cutting to six letters, in the record's
language: a claim in English about a French record is graded by rules 3 only, and is otherwise
yellow.

**Why so strict.** A false red is the costly error (`docs/architecture/01-modules.md`), so the
checker only says red when the same sentence states another figure, or the structured record
says otherwise. A claim the record words differently ("le fonds" vs "il") stays yellow.

## Labelled sets

`eval` reports agreement, red precision and recall, a confusion matrix and every disagreement.
It passes when red precision is at least 95% and every grade has a source.

| Set | Records | Claims | Agreement | Red called | Red precision | Red recall |
|---|---|---|---|---|---|---|
| `labels/recorded-v0.json` | `tests/fixtures/docket-recorded.json` | 32 | 69% | 6 | 100% | 67% |
| `labels/synthetic-v0.json` | `tests/fixtures/docket-synthetic.json` | 28 | 75% | 8 | 100% | 73% |

No false green on either set. Labels say what the records show, not what the checker says:
misses stay in the set.

- `docket-recorded.json` was built with Docket's own parsers from the pages Docket recorded in
  `modules/docket/tests/fixtures/` (Chamber dossiers 8752, 8821 and 8700; six points of the
  Esch-sur-Alzette council of 2 October 2026, one with its vote). Councillor names are left out.
  Those recordings hold no document text.
- `docket-synthetic.json` holds two example bills with document text, on `example.org` links.

The Phase 1 bar is 500 labelled claims over a live snapshot; these sets are the seed.
