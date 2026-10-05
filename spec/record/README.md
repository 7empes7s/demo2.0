# Record log format, v1

What an independent verifier needs to check Record's proofs. `modules/record` (Python) writes the log; `modules/record-verify` (TypeScript) was written from this page alone. Both test against `vectors/`.

## 1. Entries and leaves

An entry is five strings:

| Field | Format |
|---|---|
| `type` | one of `spec/record-types.json`; a verifier without that list checks it is 1 to 128 characters, none of them an ASCII space or control character |
| `payload_hash` | `sha256:` followed by 64 lowercase hex digits, nothing after them |
| `payload_uri` | 1 to 2048 characters, none of them an ASCII space or control character (U+0000 to U+0020, U+007F); other Unicode characters are allowed |
| `signer` | the signer's verifier key (section 3) in canonical form: exactly `<name>+<id>+<key>` as the encoding produces it, lowercase id, no surrounding whitespace |
| `signature` | standard base64 of a 64-byte Ed25519 signature over the signed message |

```
signed message = "d2.record.entry-signature/1\n" type "\n" payload_hash "\n" payload_uri "\n"
leaf data      = "d2.record.entry/1\n" type "\n" payload_hash "\n" payload_uri "\n"
                 signer "\n" signature "\n"
```

Both are UTF-8 bytes; a field that has no UTF-8 encoding (such as a lone UTF-16 surrogate from a JSON `\ud800` escape) is rejected. Every field is checked in full: a pattern must match the whole string, so a trailing newline fails. The log holds entries and hashes only; payloads live elsewhere, addressed by `payload_hash`.

## 2. Tree

RFC 9162 section 2.1 (the same tree as RFC 6962), with SHA-256:

```
leaf hash = SHA-256(0x00 || leaf data)
node hash = SHA-256(0x01 || left || right)
MTH({})   = SHA-256("")
MTH(D[n]) = node hash(MTH(D[0:k]), MTH(D[k:n]))   k = largest power of two < n
```

Entry `seq` is the leaf index, counted from 0. Proofs are RFC 9162 inclusion proofs (section 2.1.3) and consistency proofs (section 2.1.4); verify them with the algorithms in sections 2.1.3.2 and 2.1.4.2. A consistency proof needs `0 < from <= to`; from `to == from` the proof is empty and the roots must be equal.

## 3. Keys and signed notes

Checkpoints are C2SP signed notes (`c2sp.org/signed-note`) signed with Ed25519.

```
verifier key = <name> "+" <key id, 8 lowercase hex> "+" base64(0x01 || 32-byte public key)
key id       = first 4 bytes of SHA-256(<name> || 0x0A || 0x01 || public key)
```

Split a verifier key at its first two `+` only: base64 can contain `+`. The name has no spaces and no `+`.

A note is a body, a blank line, and signature lines:

```
<body: one or more non-empty lines, each ending "\n">
"\n"
"— " <key name> " " base64(key id || 64-byte Ed25519 signature over the body bytes) "\n"
```

`—` is U+2014 (em dash). A signature line without the space after the key name is malformed and rejects the note. A verifier accepts the note when one signature line has its key's name and key id and the signature verifies over the body (everything before the blank line, plus its final `\n`). Signature lines from other keys are ignored.

## 4. Checkpoints

The body of a checkpoint (C2SP `tlog-checkpoint`, plus one extension line):

```
<origin>                    the log's name, equal to its key name
<tree size>                 decimal, no leading zeros
<root hash>                 standard base64 of MTH of the first <tree size> leaves
timestamp <unix seconds>    when the log signed it
```

A verifier rejects a checkpoint whose origin is not the name of the key it trusts for that log.

The log makes every append durable (on disk, fsynced) before it signs a checkpoint that covers it, so it can never sign two different roots for one size.

What gets anchored in Bitcoin is `SHA-256(the whole signed note, signature lines included)`.

## 5. Proofs over HTTP

All hashes are standard base64.

```
GET /proof/inclusion?seq=&size=   {"seq": 5, "size": 13, "leaf_hash": "...", "proof": ["...", ...]}
GET /proof/consistency?from=&to=  {"from": 6, "to": 13, "proof": ["...", ...]}
```

To check an entry: verify the checkpoint signature, check `proof.size` equals the checkpoint's tree size, compute the leaf hash from the entry (section 1), check the entry's own signature, and run the RFC 9162 inclusion check against the checkpoint root. `leaf_hash` in the proof is a convenience; never trust it over the one you compute.

To check that a log only grew: verify both checkpoints with the same key, check they have the same origin and that `proof.from` and `proof.to` equal their sizes, then run the RFC 9162 consistency check.

## 6. Vectors

| File | What it pins |
|---|---|
| `vectors/rfc6962.json` | The RFC 6962 reference tree: roots for sizes 1 to 8, inclusion and consistency proofs (hex) |
| `vectors/d2-log.json` | 13 signed entries, a checkpoint per size, every inclusion and consistency proof, and 29 cases that must fail: altered proofs, edited entries and checkpoints, a fork of the same size, malformed signed notes and checkpoint bodies, a wrong origin, and entries in a non-canonical encoding |

Each must-fail case is otherwise valid: the entry-encoding cases sit alone in a correctly signed one-entry tree, so only the entry checks of section 1 can reject them. `d2-log.json` is generated by `uv run python -m d2_record.vectors --out spec/record/vectors/d2-log.json`; a test fails when it drifts. Its keys are public test keys.
