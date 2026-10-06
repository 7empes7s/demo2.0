# Changelog

## 0.1.0

- Protocol core of Door (02-protocols section 1) with a mock identity provider; unaudited.
- Issuer keys per epoch (BBS, BLS12-381 SHA-256), deterministic from key material, JSON `IssuerKey`.
- Uniqueness key `u = OPRF_K(person_id)` (RFC 9497, ristretto255, single key), direct and blinded paths; `UniquenessStore` refusing a second enrolment per `u` per epoch.
- Blind BBS issuance over the holder's committed secret and the coarse attributes (jurisdiction path per level, adult, epoch, revocation handle); Door never sees the holder secret.
- Presentations with selective disclosure (jurisdiction prefix, adult, epoch) and per-context pseudonyms bound to the proof; `verify` returning pseudonym and disclosed attributes or a precise error.
- Exact-length guards around the BBS library's byte parsers so malformed input is an error, not a panic: proof, commitment, issuer public key (96 bytes) and pseudonym (validated when parsed from JSON: lowercase hex, exactly 48 bytes). A random-input sweep over every external field checks it.
- Canonical `person_id` enforced at enrolment (13 ASCII digits for real providers); `Issuer::add_epoch` refuses an existing epoch.
- `d2-door` CLI (`demo`, `vectors`, `check`) and generated vectors in `spec/door/` with a drift test.
