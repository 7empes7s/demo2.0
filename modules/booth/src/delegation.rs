//! Liquid delegation (02-protocols section 3): **not implemented in v1**.
//!
//! Why it does not fit this tally: delegation resolves per voter ("a direct vote wins,
//! otherwise the delegate's public vote on the topic, otherwise abstain") and applies a cap
//! per delegate. With a homomorphic tally, whether a voter delegated and to whom would have
//! to be either public on the board (a receipt the spec forbids: "their followers' choice to
//! follow is private") or resolved inside a proven computation over hidden data, which is the
//! MACI-style processing proof this crate does not have yet. The honest state is a stub.
//!
//! Planned wire shape, so the board format does not move when it lands: a `delegate` entry
//! `{nym, voter_key, topic, delegate_id, signature}` and a `revoke` entry of the same shape,
//! both encrypted to the round key like ballots, resolved at tally with
//! `delegation.max_depth`, `delegation.cap` and `delegation.ttl_months` from the Charter, and
//! per-delegate follower totals published per epoch (`DelegateTotal`).

/// Message kinds the delegation extension will add to the board.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum DelegationMessage {
    /// Follow a delegate on a topic.
    Delegate,
    /// Stop following.
    Revoke,
}

/// Whether this build resolves delegations in the tally. `false` in v1.
pub const IMPLEMENTED: bool = false;
