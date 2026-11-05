---
name: d2-rust-crypto
description: Use when changing a crypto crate (modules/door, modules/booth) or any crypto format, its vectors or its independent verifiers (booth-verify, record, record-verify, lottery, lottery-verify), so no check is weakened and every must-fail case still fails the same way.
---

# Rust crypto crate (and the crypto formats)

Map: `docs/ARCHITECTURE.md` section 6. Read the crate README first (`modules/door/README.md`,
`modules/booth/README.md`): it lists each protocol property and the code that gives it.

## The pieces

| Format | Spec and vectors | Implementation | Independent verifier |
|---|---|---|---|
| Door | `spec/door/README.md`, `spec/door/vectors.json`, `spec/door/unlinkability.md` | `modules/door` (`d2-door`) | verifier service in the crate (`src/http.rs`) |
| Booth | `spec/booth/README.md`, `spec/booth/vectors.json` (`must_fail`) | `modules/booth` (`d2-booth`) | `modules/booth-verify` (Python) |
| Record | `spec/record/README.md`, `spec/record/vectors/` | `modules/record` (Python) | `modules/record-verify` (TS) |
| Lottery | `spec/lottery/README.md`, `spec/lottery/vectors/` | `modules/lottery` (Python) | `modules/lottery-verify` (TS) |

Rust tests per crate: `tests/vectors.rs` (committed vectors check, regenerating gives the same
deterministic parts), `tests/no_panic.rs` (random input into every external field), `tests/acceptance.rs`,
`tests/flow.rs`; Door also `tests/unlinkability.rs`, `tests/http.rs`.

## Rules (QA rejects any of these)

1. **"Unaudited, non-binding" stays.** The security-status block in the README and the crate docs
   (`src/lib.rs`) is never removed or softened.
2. **No check is weakened.** Don't relax a verification, widen an accepted range, skip a proof,
   lower a bound or catch-and-ignore an error to make something pass.
3. **Vectors change only with a stated reason** (a format change), written in the PR, the spec README
   and the crate CHANGELOG. Regenerate with the tool, never by hand:
   `cargo run -p d2-door -- vectors --out spec/door/vectors.json`,
   `cargo run -p d2-booth -- vectors --out spec/booth/vectors.json`.
   Every independent verifier must pass the new vectors in the same PR.
4. **Must-fail cases still fail with the same error code.** Never delete or rename a must-fail case or
   its code. A new attack or bug gets a new must-fail vector (see `lessons/2026-10-06-booth-ballot-replay.md`).
5. **The no-panic sweeps stay** and cover every new externally supplied field: add it to
   `tests/no_panic.rs`. Parsing returns `Result`; no `unwrap`/`expect`/indexing on untrusted input.
6. **Verifiers stay independent:** written from `spec/<name>/README.md` and the vectors only, no shared
   code, no reading the implementation. A spec change lands in the spec first.
7. **Boundaries:** a crate depends on crates.io and, at most, `path` dependencies into `spec/` or
   `charter/`. A new crate adds one line to `members` in the root `Cargo.toml`. Toolchain is pinned in
   `rust-toolchain.toml`.
8. **Tests are deterministic and offline:** fixed seeds (`StdRng::seed_from_u64`), no network
   (`lottery-verify --fetch` is never used in tests).

## Commands

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p d2-door            # or -p d2-booth; tests run at opt-level 1
cargo run -p d2-door -- check spec/door/vectors.json
cargo run -p d2-booth -- check spec/booth/vectors.json
cargo run -p d2-booth -- verify <board.json>   # replay a published board
uv run pytest -q modules/booth-verify
npm run test -w @democracy2/record-verify -w @democracy2/lottery-verify
```

## Done when

- [ ] Every vector and must-fail case passes in the implementation and every verifier
- [ ] New input fields in the no-panic sweep; no check weakened; security status unchanged
- [ ] Spec README, crate README and CHANGELOG updated; vector change reason stated in the PR
- [ ] Then `d2-pr-checklist`
