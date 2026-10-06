//! Test vectors: a whole round generated from one public seed, its tally, and must-fail
//! mutations of the board with the error each must produce. Everything is deterministic
//! (ChaCha20 from the seed), so the drift test compares the file byte for byte. The vectors
//! show this implementation agrees with itself over time and give an independent verifier a
//! board to check; they say nothing about interoperability with other implementations.

use crate::ballot::{RoundPublic, Voter};
use crate::board::Board;
use crate::error::BoothError;
use crate::group::point;
use crate::guardian::run_dkg;
use crate::round::Round;
use crate::state::verify_board;
use crate::wire::{RoundParams, Tally, ROUND_SCHEMA};
use rand_chacha::rand_core::SeedableRng;
use rand_chacha::ChaCha20Rng;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Schema name of the vectors file.
pub const SCHEMA: &str = "d2.booth.vectors/1";

/// What generated the file.
pub const GENERATED_BY: &str = concat!("d2-booth ", env!("CARGO_PKG_VERSION"));

/// Public seed: test material, never for a real round.
pub const SEED: [u8; 32] = *b"d2.booth.vectors/1 public seed!!";

/// The primitives, named so a reader can check the implementation against standards.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Primitives {
    /// Group.
    pub group: String,
    /// Encryption.
    pub encryption: String,
    /// Proof system and transcript.
    pub proofs: String,
    /// Key generation.
    pub key_generation: String,
    /// Voter signatures.
    pub signatures: String,
    /// Board hashing.
    pub board: String,
}

/// The script the round was generated from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Script {
    /// Round id.
    pub round_id: String,
    /// Options.
    pub options: Vec<String>,
    /// `n`.
    pub guardians: u32,
    /// `k`.
    pub threshold: u32,
    /// Each voter's pseudonym and the choices it cast, in order (a second choice is a re-vote).
    pub voters: Vec<(String, Vec<usize>)>,
    /// Guardians that published partial decryptions, and were combined.
    pub decrypting_guardians: Vec<u32>,
}

/// One change to the good board that must make it fail.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MustFail {
    /// Case name.
    pub name: String,
    /// What it shows.
    pub note: String,
    /// The mutation.
    pub mutation: Mutation,
    /// Error code the verifier must give (`BoothError::code`).
    pub error: String,
}

/// A mutation of the board.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Mutation {
    /// Set the value at a JSON pointer inside entry `seq` (relative to the entry, e.g.
    /// `/payload/counts/0`). With `rehash`, recompute that entry's hash and the chain after it,
    /// as an operator rewriting history would; without, leave the hashes alone.
    Set {
        /// Entry index.
        seq: u64,
        /// JSON pointer within the entry.
        pointer: String,
        /// New value.
        value: Value,
        /// Recompute hashes from this entry on.
        rehash: bool,
    },
    /// Remove entry `seq` and rehash the rest.
    Remove {
        /// Entry index.
        seq: u64,
    },
    /// Truncate the board to its first `len` entries (hashes stay valid).
    Truncate {
        /// Entries to keep.
        len: u64,
    },
    /// Insert a copy of entry `seq` right after it and rehash.
    Duplicate {
        /// Entry index.
        seq: u64,
    },
    /// Insert a copy of entry `seq` right after entry `after` (`after >= seq`) and rehash, as
    /// anyone who can append to the board would replay an old entry.
    Copy {
        /// Entry to copy.
        seq: u64,
        /// The copy goes right after this entry.
        after: u64,
    },
}

/// The vectors file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Vectors {
    /// `d2.booth.vectors/1`.
    pub schema: String,
    /// Generator.
    pub generated_by: String,
    /// Seed, hex.
    pub seed: String,
    /// Primitives.
    pub primitives: Primitives,
    /// Script.
    pub script: Script,
    /// The published board.
    pub board: Board,
    /// The tally `verify_board` must return.
    pub tally: Tally,
    /// Boards that must fail.
    pub must_fail: Vec<MustFail>,
}

impl BoothError {
    /// Short stable code of the error, for vectors and CLI output.
    pub fn code(&self) -> &'static str {
        match self {
            BoothError::Malformed(_) => "malformed",
            BoothError::ProofFailed => "proof_failed",
            BoothError::BadSignature => "bad_signature",
            BoothError::ChainBroken(_) => "chain_broken",
            BoothError::OutOfOrder { .. } => "out_of_order",
            BoothError::BadShare { .. } => "bad_share",
            BoothError::DuplicateSignup(_) => "duplicate_signup",
            BoothError::NotSignedUp(_) => "not_signed_up",
            BoothError::BallotReplay(_) => "ballot_replay",
            BoothError::BelowThreshold { .. } => "below_threshold",
            BoothError::TallyMismatch(_) => "tally_mismatch",
            BoothError::NoTally => "no_tally",
            BoothError::Params(_) => "params",
            BoothError::UnknownField(_) => "malformed",
        }
    }
}

fn script() -> Script {
    Script {
        round_id: "booth:test-round-1".to_string(),
        options: ["yes", "no", "abstain"].map(String::from).to_vec(),
        guardians: 3,
        threshold: 2,
        voters: vec![
            ("nym-a".to_string(), vec![0]),
            ("nym-b".to_string(), vec![1]),
            ("nym-c".to_string(), vec![0, 2]),
            ("nym-d".to_string(), vec![0]),
            ("nym-e".to_string(), vec![1, 1, 0]),
            ("nym-f".to_string(), vec![2]),
        ],
        decrypting_guardians: vec![1, 3],
    }
}

/// Run the script with the seed: the board and its tally.
pub fn run(script: &Script, seed: [u8; 32]) -> Result<(Board, Tally), BoothError> {
    let (board, tally, _) = run_keeping_voters(script, seed)?;
    Ok((board, tally))
}

/// What `run` leaves behind besides the board: the voters (with their keys and counters),
/// the round's public data and the generator, so more ballots can be made deterministically.
struct Leftovers {
    voters: Vec<Voter>,
    public: RoundPublic,
    rng: ChaCha20Rng,
}

fn run_keeping_voters(
    script: &Script,
    seed: [u8; 32],
) -> Result<(Board, Tally, Leftovers), BoothError> {
    let mut rng = ChaCha20Rng::from_seed(seed);
    let params = RoundParams {
        schema: ROUND_SCHEMA.to_string(),
        round_id: script.round_id.clone(),
        matter_id: "matter:test".to_string(),
        options: script.options.clone(),
        guardians: script.guardians,
        threshold: script.threshold,
    };
    let (commitments, keys) = run_dkg(
        &script.round_id,
        script.guardians,
        script.threshold,
        &mut rng,
    )?;
    let mut round = Round::open(&params, &commitments)?;
    let public = round.state().round_public().expect("key published").clone();
    let voters: Vec<Voter> = script
        .voters
        .iter()
        .map(|(nym, _)| Voter::new(nym, &mut rng))
        .collect();
    for v in &voters {
        round.signup(&v.signup())?;
    }
    // Interleave: first choices of everyone, then the re-votes.
    let max_len = script
        .voters
        .iter()
        .map(|(_, c)| c.len())
        .max()
        .unwrap_or(0);
    for turn in 0..max_len {
        for (v, (_, choices)) in voters.iter().zip(&script.voters) {
            if let Some(&choice) = choices.get(turn) {
                round.cast(&v.ballot(&public, choice, &mut rng)?)?;
            }
        }
    }
    round.close()?;
    let aggregates = round.state().aggregates();
    for &j in &script.decrypting_guardians {
        let key = &keys[j as usize - 1];
        round.add_partial(&key.partial_decryption(&script.round_id, &aggregates, &mut rng))?;
    }
    let tally = round.tally(&script.decrypting_guardians)?;
    let left = Leftovers {
        voters,
        public,
        rng,
    };
    Ok((round.board().clone(), tally, left))
}

/// Apply a mutation to a copy of the board.
pub fn mutate(board: &Board, m: &Mutation) -> Result<Board, String> {
    let mut b = board.clone();
    let rehash_from = match m {
        Mutation::Set {
            seq,
            pointer,
            value,
            rehash,
        } => {
            let i = *seq as usize;
            let entry = b.entries.get(i).ok_or("seq out of range")?;
            let mut v = serde_json::to_value(entry).map_err(|e| e.to_string())?;
            match v.pointer_mut(pointer) {
                Some(slot) => *slot = value.clone(),
                None => {
                    // A new key: insert it into the parent object.
                    let (parent, key) = pointer.rsplit_once('/').ok_or("pointer not found")?;
                    v.pointer_mut(parent)
                        .and_then(Value::as_object_mut)
                        .ok_or("pointer not found")?
                        .insert(key.to_string(), value.clone());
                }
            }
            b.entries[i] = serde_json::from_value(v).map_err(|e| e.to_string())?;
            if *rehash {
                Some(i)
            } else {
                None
            }
        }
        Mutation::Remove { seq } => {
            let i = *seq as usize;
            if i >= b.entries.len() {
                return Err("seq out of range".to_string());
            }
            b.entries.remove(i);
            Some(i)
        }
        Mutation::Truncate { len } => {
            b.entries.truncate(*len as usize);
            None
        }
        Mutation::Duplicate { seq } => {
            let i = *seq as usize;
            let copy = b.entries.get(i).ok_or("seq out of range")?.clone();
            b.entries.insert(i + 1, copy);
            Some(i + 1)
        }
        Mutation::Copy { seq, after } => {
            let (i, at) = (*seq as usize, *after as usize);
            if at < i || at >= b.entries.len() {
                return Err("after out of range".to_string());
            }
            let copy = b.entries[i].clone();
            b.entries.insert(at + 1, copy);
            Some(at + 1)
        }
    };
    if let Some(from) = rehash_from {
        let mut prev = if from == 0 {
            hex::encode([0u8; 32])
        } else {
            b.entries[from - 1].hash.clone()
        };
        for (i, e) in b.entries.iter_mut().enumerate().skip(from) {
            e.seq = i as u64;
            e.prev = prev.clone();
            e.hash = crate::board::entry_hash(e.seq, &e.prev, &e.kind, &e.payload)
                .map_err(|e| e.to_string())?;
            prev = e.hash.clone();
        }
    }
    Ok(b)
}

fn set(seq: u64, pointer: &str, value: Value, rehash: bool) -> Mutation {
    Mutation::Set {
        seq,
        pointer: pointer.to_string(),
        value,
        rehash,
    }
}

fn must_fail_cases(board: &Board, left: &mut Leftovers) -> Result<Vec<MustFail>, BoothError> {
    // Entry layout of the script: 0 params, 1-3 guardians, 4 key, 5-10 signups, 11-16 first
    // ballots (nym-a..nym-f, ballot_seq 1), 17-18 re-votes (nym-c, nym-e, ballot_seq 2), 19
    // third vote (nym-e, ballot_seq 3), 20 close, 21-22 partials (guardians 1 and 3), 23 tally.
    let e = |seq: usize| &board.entries[seq];
    // Ballots the voters really signed, with a stale `ballot_seq`: nym-c's re-vote carrying
    // the same counter as its first ballot, and nym-e's third vote carrying 1 after 2.
    let nym_c = &left.voters[2];
    let nym_e = &left.voters[4];
    let equal_seq = nym_c.ballot_with_seq(&left.public, 2, 1, &mut left.rng)?;
    let lower_seq = nym_e.ballot_with_seq(&left.public, 0, 1, &mut left.rng)?;
    let as_value = |b: &crate::wire::Ballot| {
        serde_json::to_value(b).map_err(|e| BoothError::Malformed(e.to_string()))
    };
    let equal_seq = as_value(&equal_seq)?;
    let lower_seq = as_value(&lower_seq)?;
    let ballot_12 = e(12).payload.clone();
    let partial_21 = e(21).payload.clone();
    let tally_counts = e(23).payload["counts"].clone();
    let counts: Vec<u64> = serde_json::from_value(tally_counts).expect("counts");
    let guardian_1_point = e(1).payload["commitments"][0].clone();
    let other_point = e(2).payload["commitments"][0].clone();
    point("c", guardian_1_point.as_str().unwrap_or(""))?;
    let case = |name: &str, note: &str, mutation: Mutation, error: &str| MustFail {
        name: name.to_string(),
        note: note.to_string(),
        mutation,
        error: error.to_string(),
    };
    Ok(vec![
        case(
            "edited_ballot_without_rehash",
            "A ballot's first ciphertext is replaced in place; the entry hash no longer matches.",
            set(11, "/payload/choices/0", ballot_12["choices"][0].clone(), false),
            "chain_broken",
        ),
        case(
            "removed_ballot",
            "A re-vote is dropped and the chain rehashed; the aggregates change, so the guardians' decryption proofs (which are over the real aggregates) fail.",
            Mutation::Remove { seq: 17 },
            "proof_failed",
        ),
        case(
            "edited_ballot_rehashed",
            "An operator rewrites a ballot's ciphertext and rehashes the chain; the voter's signature no longer verifies.",
            set(11, "/payload/choices/0", ballot_12["choices"][0].clone(), true),
            "bad_signature",
        ),
        case(
            "ballot_moved_to_another_nym",
            "A ballot is relabelled with another signed-up pseudonym; the registered key differs.",
            set(11, "/payload/nym", Value::String("nym-b".to_string()), true),
            "not_signed_up",
        ),
        case(
            "ballot_for_another_round",
            "A ballot says it belongs to another round.",
            set(11, "/payload/round_id", Value::String("booth:other".to_string()), true),
            "malformed",
        ),
        case(
            "ballot_replayed_after_re_vote",
            "nym-c's first (coerced) ballot is copied, unchanged and validly signed, after its re-vote; its ballot_seq does not move forward, so the replay is refused instead of reinstating the coerced vote.",
            Mutation::Copy { seq: 13, after: 17 },
            "ballot_replay",
        ),
        case(
            "ballot_duplicated",
            "A ballot is published twice in a row; the second is an exact copy of an accepted one.",
            Mutation::Duplicate { seq: 13 },
            "ballot_replay",
        ),
        case(
            "ballot_seq_equal",
            "nym-c's re-vote is replaced by one nym-c signed with the same ballot_seq as its first ballot.",
            set(17, "/payload", equal_seq, true),
            "ballot_replay",
        ),
        case(
            "ballot_seq_decreasing",
            "nym-e's third ballot is replaced by one nym-e signed with ballot_seq 1, after its ballot_seq 2.",
            set(19, "/payload", lower_seq, true),
            "ballot_replay",
        ),
        case(
            "ballot_seq_edited",
            "An operator raises a ballot's ballot_seq and rehashes; the signature no longer verifies.",
            set(11, "/payload/ballot_seq", Value::from(7), true),
            "bad_signature",
        ),
        case(
            "duplicate_signup",
            "The same pseudonym signs up twice.",
            Mutation::Duplicate { seq: 5 },
            "duplicate_signup",
        ),
        case(
            "signup_key_changed",
            "A sign-up's key is replaced; the pseudonym's ballots no longer match it.",
            set(5, "/payload/voter_key", e(6).payload["voter_key"].clone(), true),
            "not_signed_up",
        ),
        case(
            "ballot_before_signup",
            "A ballot entry is placed where a sign-up was (kind changed); the payload has the wrong shape.",
            set(5, "/kind", Value::String("ballot".to_string()), true),
            "malformed",
        ),
        case(
            "ballot_after_close",
            "A partial decryption entry is relabelled as a ballot; a ballot after close is out of order.",
            set(21, "/kind", Value::String("ballot".to_string()), true),
            "out_of_order",
        ),
        case(
            "guardian_commitment_edited",
            "Guardian 1's constant-term commitment is swapped for guardian 2's; the proof of knowledge fails.",
            set(1, "/payload/commitments/0", other_point, true),
            "proof_failed",
        ),
        case(
            "round_key_edited",
            "The published joint key is not what the commitments derive to.",
            set(4, "/payload/joint_key", guardian_1_point, true),
            "malformed",
        ),
        case(
            "partial_decryption_share_swapped",
            "Guardian 1's share for option 0 is replaced by its share for option 1; the Chaum-Pedersen proof fails.",
            set(21, "/payload/shares/0/m", partial_21["shares"][1]["m"].clone(), true),
            "proof_failed",
        ),
        case(
            "partial_decryption_duplicated",
            "A guardian publishes twice.",
            Mutation::Duplicate { seq: 21 },
            "malformed",
        ),
        case(
            "tally_count_moved",
            "One vote is moved from option 0 to option 1; the sum still matches but the decryption does not.",
            set(
                23,
                "/payload/counts",
                serde_json::json!([counts[0] - 1, counts[1] + 1, counts[2]]),
                true,
            ),
            "tally_mismatch",
        ),
        case(
            "tally_count_inflated",
            "One vote is added to option 0; the counts no longer sum to the counted ballots.",
            set(
                23,
                "/payload/counts",
                serde_json::json!([counts[0] + 1, counts[1], counts[2]]),
                true,
            ),
            "malformed",
        ),
        case(
            "tally_below_threshold",
            "The tally claims to use one guardian where two are needed.",
            set(23, "/payload/guardians_used", serde_json::json!([1]), true),
            "below_threshold",
        ),
        case(
            "tally_uses_absent_guardian",
            "The tally names a guardian that published no partial decryption.",
            set(23, "/payload/guardians_used", serde_json::json!([1, 2]), true),
            "malformed",
        ),
        case(
            "no_tally",
            "The board stops before the tally.",
            Mutation::Truncate { len: 23 },
            "no_tally",
        ),
        case(
            "ballot_payload_edited_unsigned_field",
            "An extra field is added to a ballot; unknown fields are refused.",
            set(11, "/payload/extra", Value::String("x".to_string()), true),
            "malformed",
        ),
        case(
            "hash_edited",
            "An entry's hash is replaced by another 32-byte hex value.",
            set(11, "/hash", e(12).payload["voter_key"].clone(), false),
            "chain_broken",
        ),
        case(
            "seq_edited",
            "An entry's sequence number is changed.",
            set(12, "/seq", Value::from(99), false),
            "chain_broken",
        ),
        case(
            "unused_ballot",
            "A pseudonym's only ballot is dropped; the aggregates change and the decryption proofs fail.",
            Mutation::Remove { seq: 11 },
            "proof_failed",
        ),
        case(
            "threshold_edited",
            "Threshold raised to 3 after the fact; guardian commitments have the wrong length.",
            set(0, "/payload/threshold", Value::from(3), true),
            "malformed",
        ),
        case(
            "bad_option_count",
            "Params say two options; ballots have three.",
            set(0, "/payload/options", serde_json::json!(["yes", "no"]), true),
            "malformed",
        ),
    ])
}

/// Generate the vectors.
pub fn generate() -> Result<Vectors, BoothError> {
    let script = script();
    let (board, tally, mut left) = run_keeping_voters(&script, SEED)?;
    let must_fail = must_fail_cases(&board, &mut left)?;
    Ok(Vectors {
        schema: SCHEMA.to_string(),
        generated_by: GENERATED_BY.to_string(),
        seed: hex::encode(SEED),
        primitives: Primitives {
            group: "ristretto255 (curve25519-dalek 4.1.3)".to_string(),
            encryption: "exponential ElGamal: (a, b) = (r*G, r*K + m*G)".to_string(),
            proofs: "Chaum-Pedersen and disjunctive Chaum-Pedersen, Fiat-Shamir over merlin 3 transcripts (STROBE-128), protocol label d2.booth/1".to_string(),
            key_generation: "joint Feldman VSS (Pedersen 1991), k-of-n, Schnorr proof of the constant term, Lagrange at zero".to_string(),
            signatures: "Ed25519 (RFC 8032) over SHA-256(\"d2.booth.ballot/1\" || 0x00 || canonical JSON of the ballot with signature \"\"); ballot_seq strictly increasing per pseudonym, exact copies refused".to_string(),
            board: "SHA-256(\"d2.booth.entry/1\" || 0x00 || seq be64 || prev || kind || 0x00 || canonical JSON payload); canonical = sorted keys, compact, integers only".to_string(),
        },
        script,
        board,
        tally,
        must_fail,
    })
}

/// Check a vectors file against this code: the board verifies to the recorded tally and every
/// must-fail case fails with the recorded code. Returns the number of checks.
pub fn check(v: &Vectors) -> Result<usize, String> {
    if v.schema != SCHEMA {
        return Err(format!("schema {}", v.schema));
    }
    let tally = verify_board(&v.board).map_err(|e| format!("board: {e}"))?;
    if tally != v.tally {
        return Err("tally differs from the recorded one".to_string());
    }
    let mut n = 1;
    for case in &v.must_fail {
        let board = mutate(&v.board, &case.mutation).map_err(|e| format!("{}: {e}", case.name))?;
        match verify_board(&board) {
            Ok(_) => return Err(format!("{}: verified, expected {}", case.name, case.error)),
            Err(e) if e.code() == case.error => n += 1,
            Err(e) => {
                return Err(format!(
                    "{}: expected {}, got {} ({e})",
                    case.name,
                    case.error,
                    e.code()
                ))
            }
        }
    }
    Ok(n)
}
