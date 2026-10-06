//! Wire format: the payload of every board entry, as JSON. Field order here is documentation;
//! hashing and signing use canonical JSON (sorted keys), see `board::canonical`. Unknown fields
//! are refused everywhere so a verifier never silently ignores data it did not check.

use crate::group::{ChaumPedersen, Schnorr};
use serde::{Deserialize, Serialize};

/// Schema name in `round.params`.
pub const ROUND_SCHEMA: &str = "d2.booth.round/1";
/// Schema name of a board file.
pub const BOARD_SCHEMA: &str = "d2.booth.board/1";

/// Entry kinds, in the order the state machine accepts them.
pub mod kind {
    /// Round parameters, always entry 0.
    pub const PARAMS: &str = "round.params";
    /// One guardian's Feldman commitments, guardians 1..=n in order.
    pub const GUARDIAN: &str = "guardian.commitment";
    /// The joint key and every guardian's verification key, derived from the commitments.
    pub const KEY: &str = "round.key";
    /// A voter's round key, one per pseudonym.
    pub const SIGNUP: &str = "signup";
    /// An encrypted ballot; the last valid one per pseudonym counts.
    pub const BALLOT: &str = "ballot";
    /// Close of the voting phase.
    pub const CLOSE: &str = "round.close";
    /// One guardian's partial decryption of the aggregates.
    pub const PARTIAL: &str = "partial.decryption";
    /// The published counts.
    pub const TALLY: &str = "tally";
}

/// Entry 0: what the round is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoundParams {
    /// `d2.booth.round/1`.
    pub schema: String,
    /// Round id, `[A-Za-z0-9._:-]{1,128}`. Every proof is bound to it.
    pub round_id: String,
    /// The matter voted on (opaque to Booth).
    pub matter_id: String,
    /// Option labels, 2 to 64, the index is the choice.
    pub options: Vec<String>,
    /// `n`, number of guardians (1 to 64).
    pub guardians: u32,
    /// `k`, guardians needed to decrypt (1 to `n`).
    pub threshold: u32,
}

/// One guardian's dealing: Feldman commitments to its polynomial.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GuardianCommitment {
    /// Guardian index, 1..=n.
    pub guardian: u32,
    /// `C_l = a_l·G` for `l = 0..k`, hex points.
    pub commitments: Vec<String>,
    /// Knowledge of `a_0` (the guardian's contribution to the joint secret).
    pub proof: Schnorr,
}

/// The round's public key material, derived from the commitments.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RoundKey {
    /// `K = Σ_i C_{i,0}`, hex.
    pub joint_key: String,
    /// `K_j = Σ_i Σ_l j^l·C_{i,l}` for `j = 1..=n`, hex each.
    pub guardian_keys: Vec<String>,
}

/// A voter registers a round key under its pseudonym.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Signup {
    /// Door pseudonym for the context `booth:<round_id>`, `[A-Za-z0-9._:-]{1,128}`.
    pub nym: String,
    /// Ed25519 public key, 32 bytes hex.
    pub voter_key: String,
}

/// Exponential ElGamal ciphertext `(a, b) = (r·G, r·K + m·G)`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ciphertext {
    /// `r·G`, hex.
    pub a: String,
    /// `r·K + m·G`, hex.
    pub b: String,
}

/// Disjunctive Chaum-Pedersen proof that a ciphertext encrypts 0 or 1.
///
/// Branch 0 proves `(a, b)` is a DH pair under `(G, K)`; branch 1 proves `(a, b − G)` is.
/// `challenge_1 = c − challenge_0` where `c` is the transcript challenge after the four
/// commitments are appended.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BitProof {
    /// Branch 0 commitment on `G`, hex.
    pub commit_0_1: String,
    /// Branch 0 commitment on `K`, hex.
    pub commit_0_2: String,
    /// Branch 1 commitment on `G`, hex.
    pub commit_1_1: String,
    /// Branch 1 commitment on `K`, hex.
    pub commit_1_2: String,
    /// Branch 0 challenge, hex scalar.
    pub challenge_0: String,
    /// Branch 0 response, hex scalar.
    pub response_0: String,
    /// Branch 1 response, hex scalar.
    pub response_1: String,
}

/// An encrypted ballot. All ballots of a round have the same shape and size.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Ballot {
    /// Must equal the round's id.
    pub round_id: String,
    /// The voter's pseudonym (as signed up).
    pub nym: String,
    /// The voter's round key (as signed up), hex.
    pub voter_key: String,
    /// One ciphertext per option; exactly one encrypts 1.
    pub choices: Vec<Ciphertext>,
    /// One 0-or-1 proof per option.
    pub bit_proofs: Vec<BitProof>,
    /// Proof that the choices sum to exactly one.
    pub sum_proof: ChaumPedersen,
    /// Ed25519 signature, 64 bytes hex, over `SHA-256("d2.booth.ballot/1" || 0x00 ||
    /// canonical JSON of this payload with `signature` set to "")`.
    pub signature: String,
}

/// Close of voting. Empty.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Close {}

/// One guardian's share of the decryption, one per option.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DecryptionShare {
    /// `M = x_i·A_j`, hex.
    pub m: String,
    /// Chaum-Pedersen: `log_G K_i = log_{A_j} M`.
    pub proof: ChaumPedersen,
}

/// A guardian's partial decryption of every option's aggregate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PartialDecryption {
    /// Guardian index.
    pub guardian: u32,
    /// One share per option, in option order.
    pub shares: Vec<DecryptionShare>,
}

/// The result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tally {
    /// Pseudonyms that signed up.
    pub signups: u64,
    /// Ballots that count (one per pseudonym that cast at least one valid ballot).
    pub counted: u64,
    /// Count per option, in option order. Sums to `counted`.
    pub counts: Vec<u64>,
    /// The guardians whose partial decryptions were combined (at least `k`, ascending).
    pub guardians_used: Vec<u32>,
}

/// Check an id or pseudonym: 1 to 128 characters of `[A-Za-z0-9._:-]`.
pub fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b':' | b'-'))
}
