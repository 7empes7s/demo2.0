# Changelog

## Unreleased

- `readSnapshot` reads Docket snapshot/1 and /2 into the /2 shape (a `sources` list) and refuses other schemas; the server uses it at start-up.
- Item types cover Esch council points (`reference`, `theme`, `votes`) and consultations (`summary`, `opens`, `closes`, `phases`, no number). Source 1 names the right body and lists these facts.

## 0.1.0

- explain, extractArguments, challenge and checkClaim with quote verification.
- Anthropic provider; zero-dependency Node server with caching and rate limiting.
