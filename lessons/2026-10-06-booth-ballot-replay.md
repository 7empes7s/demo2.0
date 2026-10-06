# "Last counts" needs a signed counter

**Mistake (Booth PR #31 review):** the state machine let the last valid ballot per pseudonym count, but nothing in a signed ballot said which of a voter's ballots came last. Anyone who could append to the board copied a voter's first (coerced) ballot after the re-vote, rehashed the chain, and `d2-booth verify` accepted the board with the coerced vote counted. The re-vote acceptance test passed because it only built honest boards.

**Rule:** any "latest wins" rule over signed messages needs a signed, strictly increasing per-signer counter (bound into every proof that covers the message) and a refusal of exact copies of accepted messages. Every such rule gets a must-fail vector that replays an earlier, validly signed message after a later one.
