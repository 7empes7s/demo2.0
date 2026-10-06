# Changelog

## 0.1.0

- Replays a Booth board (`spec/booth/README.md`, board `d2.booth.board/1`) and prints the tally it proves, or the spec's error code; exit 0, 1 or 2.
- Pure Python ristretto255 (RFC 9496), Keccak-f[1600], STROBE-128 and Merlin transcripts; Ed25519 via PyNaCl.
- Passes `spec/booth/vectors.json`: the recorded tally and all 29 must-fail codes.
- `testgen`: builds large test boards from the spec with a public seed (10,000-ballot run in the README).
