//! Errors. Every verifier error names what went wrong without panicking; an independent
//! verifier should fail the same boards for the same reasons (see spec/booth/README.md).

use thiserror::Error;

/// Anything that can go wrong in Booth.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum BoothError {
    /// Input does not have the documented shape (length, hex, charset, range).
    #[error("malformed: {0}")]
    Malformed(String),
    /// A zero-knowledge proof did not verify.
    #[error("proof failed")]
    ProofFailed,
    /// An Ed25519 signature did not verify.
    #[error("bad signature")]
    BadSignature,
    /// The board's hash chain is broken at the given sequence number.
    #[error("hash chain broken at entry {0}")]
    ChainBroken(u64),
    /// An entry appears where the round's state machine does not allow it.
    #[error("entry {seq} ({kind}) out of order: {reason}")]
    OutOfOrder {
        /// Sequence number of the offending entry.
        seq: u64,
        /// Its kind.
        kind: String,
        /// Why it cannot appear here.
        reason: String,
    },
    /// A guardian's share does not match the published commitments.
    #[error("guardian {from} sent guardian {to} a share that does not match its commitments")]
    BadShare {
        /// Dealing guardian.
        from: u32,
        /// Receiving guardian.
        to: u32,
    },
    /// Two sign-ups for one pseudonym.
    #[error("duplicate sign-up for nym {0}")]
    DuplicateSignup(String),
    /// A ballot for a pseudonym that never signed up, or signed with a different key.
    #[error("ballot for nym {0} does not match a sign-up")]
    NotSignedUp(String),
    /// Fewer partial decryptions than the threshold.
    #[error("only {have} of the {need} partial decryptions needed")]
    BelowThreshold {
        /// Valid partial decryptions on the board.
        have: usize,
        /// Threshold `k`.
        need: usize,
    },
    /// The published counts do not match what the partial decryptions open to.
    #[error("tally does not match the decryption for option {0}")]
    TallyMismatch(usize),
    /// The board does not end with a tally.
    #[error("board has no tally yet")]
    NoTally,
    /// Round parameters the state machine refuses (threshold, counts, ids).
    #[error("round parameters: {0}")]
    Params(String),
    /// A field name the format does not know (payload with extra keys).
    #[error("unknown field in {0}")]
    UnknownField(String),
}
