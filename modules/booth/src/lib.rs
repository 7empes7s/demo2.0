//! Booth protocol core, v1: secret, verifiable ballots with a k-of-n guardian key.
//!
//! **Unaudited. Non-binding use only.** See the README for what this does and does not
//! achieve, in particular about receipt-freeness.
//!
//! Pieces:
//! - [`guardian`]: joint Feldman key generation, partial decryption with proofs.
//! - [`ballot`]: voters, exponential ElGamal ballots, 0-or-1 and sum proofs, signatures.
//! - [`board`]: the hash-chained bulletin board and canonical JSON.
//! - [`state`]: the state machine, [`verify_board`] replays a board from entry 0.
//! - [`round`]: the operator's builder, which runs the same machine before publishing.
//! - [`vectors`]: generated test vectors in `spec/booth/`.
//! - [`delegation`]: not implemented in v1, see the module docs.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod ballot;
pub mod board;
pub mod delegation;
pub mod error;
pub mod group;
pub mod guardian;
pub mod round;
pub mod state;
pub mod vectors;
pub mod wire;

pub use ballot::{check_ballot, RoundPublic, Voter};
pub use board::{Board, Entry};
pub use error::BoothError;
pub use guardian::{run_dkg, Dealer, GuardianKey};
pub use round::Round;
pub use state::{replay, verify_board, Phase, State};
pub use wire::{Ballot, GuardianCommitment, PartialDecryption, RoundParams, Signup, Tally};
