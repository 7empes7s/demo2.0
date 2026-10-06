//! The round's state machine. One implementation serves two roles: the operator applies every
//! entry before appending it (so nothing invalid is ever published), and `verify_board`
//! replays a published board through the same machine from entry 0. The machine holds no
//! secrets.
//!
//! Entry order: `round.params`, `guardian.commitment` × n (1..=n in order), `round.key`, then
//! any mix of `signup` and `ballot`, then `round.close`, then `partial.decryption` (any
//! guardian, each at most once), then `tally`. Anything else is `OutOfOrder` and the board
//! is invalid: this verifier is strict, an invalid entry is never skipped.

use crate::ballot::CheckedBallot;
use crate::ballot::{check_ballot, voter_key, RoundPublic};
use crate::board::{payload, Board, Entry};
use crate::error::BoothError;
use crate::group::{g, lagrange_at_zero, point};
use crate::guardian::{decryption_transcript, derive_round_key, Commitments};
use crate::wire::{
    kind, valid_id, Ballot, Close, GuardianCommitment, PartialDecryption, RoundKey, RoundParams,
    Signup, Tally, ROUND_SCHEMA,
};
use curve25519_dalek::ristretto::RistrettoPoint;
use curve25519_dalek::traits::Identity;
use ed25519_dalek::VerifyingKey;
use std::collections::{BTreeMap, HashMap, HashSet};

/// Ballot checks done ahead of the sequential replay, by entry sequence number: the key the
/// check used and its result. The replay uses an item only when the key it would use is the
/// same one; otherwise it checks the ballot itself.
pub type BallotCache = HashMap<u64, BallotCheck>;

/// One pre-checked ballot: the key used and the outcome.
pub type BallotCheck = (VerifyingKey, Result<CheckedBallot, BoothError>);

/// Where the round is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    /// Nothing yet: expecting `round.params`.
    Empty,
    /// Expecting guardian commitments (the next index).
    Commitments,
    /// Expecting `round.key`.
    Key,
    /// Sign-ups and ballots.
    Voting,
    /// Closed: partial decryptions.
    Closed,
    /// Tally published.
    Tallied,
}

/// Limits of the format.
pub const MAX_OPTIONS: usize = 64;
/// Maximum number of guardians.
pub const MAX_GUARDIANS: u32 = 64;

/// Parsed round parameters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Params {
    /// Round id.
    pub round_id: String,
    /// Matter id.
    pub matter_id: String,
    /// Option labels.
    pub options: Vec<String>,
    /// `n`.
    pub guardians: u32,
    /// `k`.
    pub threshold: u32,
}

/// The replayed state.
#[derive(Debug, Clone)]
pub struct State {
    phase: Phase,
    params: Option<Params>,
    commitments: Vec<Commitments>,
    round: Option<RoundPublic>,
    guardian_keys: Vec<RistrettoPoint>,
    signups: BTreeMap<String, VerifyingKey>,
    /// Ciphertexts of the last valid ballot per pseudonym.
    last: BTreeMap<String, Vec<(RistrettoPoint, RistrettoPoint)>>,
    /// `ballot_seq` of the last accepted ballot per pseudonym.
    last_seq: BTreeMap<String, u64>,
    /// Signed digests of every accepted ballot (exact copies are refused).
    digests: HashSet<[u8; 32]>,
    ballots: u64,
    partials: BTreeMap<u32, Vec<RistrettoPoint>>,
    tally: Option<Tally>,
}

impl Default for State {
    fn default() -> Self {
        Self::new()
    }
}

impl State {
    /// A round that has not started.
    pub fn new() -> Self {
        Self {
            phase: Phase::Empty,
            params: None,
            commitments: Vec::new(),
            round: None,
            guardian_keys: Vec::new(),
            signups: BTreeMap::new(),
            last: BTreeMap::new(),
            last_seq: BTreeMap::new(),
            digests: HashSet::new(),
            ballots: 0,
            partials: BTreeMap::new(),
            tally: None,
        }
    }

    /// Current phase.
    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// Round parameters once published.
    pub fn params(&self) -> Option<&Params> {
        self.params.as_ref()
    }

    /// What a voter needs, once the key is published.
    pub fn round_public(&self) -> Option<&RoundPublic> {
        self.round.as_ref()
    }

    /// Sign-ups so far.
    pub fn signup_count(&self) -> usize {
        self.signups.len()
    }

    /// Ballots accepted so far (every valid one, not only the last per pseudonym).
    pub fn ballot_count(&self) -> u64 {
        self.ballots
    }

    /// Pseudonyms with at least one valid ballot.
    pub fn counted(&self) -> usize {
        self.last.len()
    }

    /// The published tally, once there is one.
    pub fn tally(&self) -> Option<&Tally> {
        self.tally.as_ref()
    }

    /// Aggregate `(A_j, B_j) = Σ (a, b)` over the last valid ballot per pseudonym.
    pub fn aggregates(&self) -> Vec<(RistrettoPoint, RistrettoPoint)> {
        let l = self.round.as_ref().map(|r| r.options).unwrap_or(0);
        let mut agg = vec![(RistrettoPoint::identity(), RistrettoPoint::identity()); l];
        for choices in self.last.values() {
            for (slot, (a, b)) in agg.iter_mut().zip(choices) {
                slot.0 += a;
                slot.1 += b;
            }
        }
        agg
    }

    /// Guardians whose partial decryptions are on the board, ascending.
    pub fn guardians_with_partials(&self) -> Vec<u32> {
        self.partials.keys().copied().collect()
    }

    /// Combine the partial decryptions of `set` (at least `k` distinct guardians) into
    /// `Σ λ_j·M_j` per option, which equals `x·A_j`.
    pub fn combine(&self, set: &[u32]) -> Result<Vec<RistrettoPoint>, BoothError> {
        let params = self.params.as_ref().ok_or(BoothError::NoTally)?;
        let mut sorted = set.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        if sorted.len() != set.len() || sorted != set {
            return Err(BoothError::Malformed(
                "guardians_used must be ascending and distinct".to_string(),
            ));
        }
        if set.len() < params.threshold as usize {
            return Err(BoothError::BelowThreshold {
                have: set.len(),
                need: params.threshold as usize,
            });
        }
        let l = self.round.as_ref().map(|r| r.options).unwrap_or(0);
        let mut out = vec![RistrettoPoint::identity(); l];
        for &j in set {
            let shares = self.partials.get(&j).ok_or_else(|| {
                BoothError::Malformed(format!("guardian {j} published no partial decryption"))
            })?;
            let lambda = lagrange_at_zero(j, set)?;
            for (slot, m) in out.iter_mut().zip(shares) {
                *slot += lambda * m;
            }
        }
        Ok(out)
    }

    /// Apply one entry. On error the state is unchanged except for entries that were already
    /// applied; callers treat any error as "board invalid".
    pub fn apply(&mut self, entry: &Entry) -> Result<(), BoothError> {
        self.apply_cached(entry, None)
    }

    /// `apply`, using pre-checked ballots where the cache has them (see `BallotCache`).
    pub fn apply_cached(
        &mut self,
        entry: &Entry,
        cache: Option<&BallotCache>,
    ) -> Result<(), BoothError> {
        let out_of_order = |reason: &str| BoothError::OutOfOrder {
            seq: entry.seq,
            kind: entry.kind.clone(),
            reason: reason.to_string(),
        };
        match (self.phase, entry.kind.as_str()) {
            (Phase::Empty, kind::PARAMS) => self.apply_params(payload(entry)?),
            (Phase::Commitments, kind::GUARDIAN) => self.apply_commitment(payload(entry)?),
            (Phase::Key, kind::KEY) => self.apply_key(payload(entry)?),
            (Phase::Voting, kind::SIGNUP) => self.apply_signup(payload(entry)?),
            (Phase::Voting, kind::BALLOT) => {
                self.apply_ballot(payload(entry)?, cache.and_then(|c| c.get(&entry.seq)))
            }
            (Phase::Voting, kind::CLOSE) => {
                let _: Close = payload(entry)?;
                self.phase = Phase::Closed;
                Ok(())
            }
            (Phase::Closed, kind::PARTIAL) => self.apply_partial(payload(entry)?),
            (Phase::Closed, kind::TALLY) => self.apply_tally(payload(entry)?),
            (phase, _) => Err(out_of_order(&format!("phase {phase:?}"))),
        }
    }

    fn apply_params(&mut self, p: RoundParams) -> Result<(), BoothError> {
        if p.schema != ROUND_SCHEMA {
            return Err(BoothError::Params(format!("schema {}", p.schema)));
        }
        if !valid_id(&p.round_id) {
            return Err(BoothError::Params("round_id".to_string()));
        }
        if p.matter_id.is_empty() || p.matter_id.len() > 256 {
            return Err(BoothError::Params("matter_id".to_string()));
        }
        if p.options.len() < 2 || p.options.len() > MAX_OPTIONS {
            return Err(BoothError::Params(format!("{} options", p.options.len())));
        }
        if p.options.iter().any(|o| o.is_empty() || o.len() > 256) {
            return Err(BoothError::Params("option label".to_string()));
        }
        if p.guardians < 1 || p.guardians > MAX_GUARDIANS {
            return Err(BoothError::Params(format!("{} guardians", p.guardians)));
        }
        if p.threshold < 1 || p.threshold > p.guardians {
            return Err(BoothError::Params(format!(
                "threshold {} of {}",
                p.threshold, p.guardians
            )));
        }
        self.params = Some(Params {
            round_id: p.round_id,
            matter_id: p.matter_id,
            options: p.options,
            guardians: p.guardians,
            threshold: p.threshold,
        });
        self.phase = Phase::Commitments;
        Ok(())
    }

    fn apply_commitment(&mut self, c: GuardianCommitment) -> Result<(), BoothError> {
        let params = self.params.as_ref().expect("phase");
        let expected = self.commitments.len() as u32 + 1;
        if c.guardian != expected {
            return Err(BoothError::Malformed(format!(
                "guardian {} committed where guardian {expected} was due",
                c.guardian
            )));
        }
        let parsed = Commitments::parse(&c, &params.round_id, params.threshold)?;
        self.commitments.push(parsed);
        if self.commitments.len() as u32 == params.guardians {
            self.phase = Phase::Key;
        }
        Ok(())
    }

    fn apply_key(&mut self, k: RoundKey) -> Result<(), BoothError> {
        let params = self.params.as_ref().expect("phase");
        let derived = derive_round_key(&self.commitments);
        if derived != k {
            return Err(BoothError::Malformed(
                "round.key does not match the guardian commitments".to_string(),
            ));
        }
        self.guardian_keys = k
            .guardian_keys
            .iter()
            .map(|h| point("guardian_key", h))
            .collect::<Result<_, _>>()?;
        self.round = Some(RoundPublic {
            round_id: params.round_id.clone(),
            joint_key: point("joint_key", &k.joint_key)?,
            options: params.options.len(),
        });
        self.phase = Phase::Voting;
        Ok(())
    }

    fn apply_signup(&mut self, s: Signup) -> Result<(), BoothError> {
        if !valid_id(&s.nym) {
            return Err(BoothError::Malformed("signup: nym".to_string()));
        }
        let key = voter_key(&s.voter_key)?;
        if self.signups.contains_key(&s.nym) {
            return Err(BoothError::DuplicateSignup(s.nym));
        }
        self.signups.insert(s.nym, key);
        Ok(())
    }

    fn apply_ballot(&mut self, b: Ballot, cached: Option<&BallotCheck>) -> Result<(), BoothError> {
        let round = self.round.as_ref().expect("phase");
        let key = self
            .signups
            .get(&b.nym)
            .ok_or_else(|| BoothError::NotSignedUp(b.nym.clone()))?;
        let checked = match cached {
            Some((used, result)) if used == key => result.clone()?,
            _ => check_ballot(&b, round, key)?,
        };
        // Replays: an exact copy of an accepted ballot (whatever its signature bytes), or a
        // `ballot_seq` that does not move forward, would let anyone who can append to the
        // board reinstate an earlier (coerced) ballot after the re-vote.
        if self.digests.contains(&checked.digest) {
            return Err(BoothError::BallotReplay(checked.nym));
        }
        if let Some(&prev) = self.last_seq.get(&checked.nym) {
            if checked.ballot_seq <= prev {
                return Err(BoothError::BallotReplay(checked.nym));
            }
        }
        self.digests.insert(checked.digest);
        self.last_seq
            .insert(checked.nym.clone(), checked.ballot_seq);
        self.last.insert(checked.nym, checked.choices);
        self.ballots += 1;
        Ok(())
    }

    fn apply_partial(&mut self, p: PartialDecryption) -> Result<(), BoothError> {
        let params = self.params.as_ref().expect("phase");
        let round = self.round.as_ref().expect("phase");
        if p.guardian < 1 || p.guardian > params.guardians {
            return Err(BoothError::Malformed(format!("guardian {}", p.guardian)));
        }
        if self.partials.contains_key(&p.guardian) {
            return Err(BoothError::Malformed(format!(
                "guardian {} already published a partial decryption",
                p.guardian
            )));
        }
        if p.shares.len() != round.options {
            return Err(BoothError::Malformed(format!(
                "guardian {}: {} shares for {} options",
                p.guardian,
                p.shares.len(),
                round.options
            )));
        }
        let kj = self.guardian_keys[p.guardian as usize - 1];
        let aggregates = self.aggregates();
        let mut shares = Vec::with_capacity(round.options);
        for (opt, (share, (a, _))) in p.shares.iter().zip(&aggregates).enumerate() {
            let m = point(&format!("guardian {} share {opt}", p.guardian), &share.m)?;
            if *a == RistrettoPoint::identity() {
                // No ballot counted: the aggregate is the identity and nothing is proved
                // about it. The share must then be the identity too, which `point` refuses,
                // so an empty round cannot be tallied this way. Refuse explicitly.
                return Err(BoothError::Malformed("no ballots to decrypt".to_string()));
            }
            let mut t = decryption_transcript(&round.round_id, p.guardian, opt as u64, &kj, a, &m);
            share.proof.verify(&mut t, &g(), a, &kj, &m)?;
            shares.push(m);
        }
        self.partials.insert(p.guardian, shares);
        Ok(())
    }

    fn apply_tally(&mut self, t: Tally) -> Result<(), BoothError> {
        let round = self.round.as_ref().expect("phase");
        if t.counts.len() != round.options {
            return Err(BoothError::Malformed(format!(
                "tally: {} counts for {} options",
                t.counts.len(),
                round.options
            )));
        }
        if t.signups != self.signups.len() as u64 || t.counted != self.last.len() as u64 {
            return Err(BoothError::Malformed(
                "tally: signups or counted do not match the board".to_string(),
            ));
        }
        let total: u64 = t
            .counts
            .iter()
            .try_fold(0u64, |acc, c| acc.checked_add(*c))
            .ok_or_else(|| BoothError::Malformed("tally: overflow".to_string()))?;
        if total != t.counted {
            return Err(BoothError::Malformed(
                "tally: counts do not sum to counted".to_string(),
            ));
        }
        let decrypted = self.combine(&t.guardians_used)?;
        let aggregates = self.aggregates();
        for (opt, ((_, b), d)) in aggregates.iter().zip(&decrypted).enumerate() {
            let plain = b - d;
            if plain != curve25519_dalek::scalar::Scalar::from(t.counts[opt]) * g() {
                return Err(BoothError::TallyMismatch(opt));
            }
        }
        self.tally = Some(t);
        self.phase = Phase::Tallied;
        Ok(())
    }
}

/// Replay a published board from entry 0 and return the final state. Any invalid entry fails
/// the whole board.
///
/// Ballot proofs are the bulk of the work and independent of each other, so they are checked
/// on every available core first (`precheck_ballots`); the sequential replay then only
/// re-checks a ballot whose registered key differs from the one the pre-check used.
pub fn replay(board: &Board) -> Result<State, BoothError> {
    board.verify_chain()?;
    let cache = precheck_ballots(board);
    let mut state = State::new();
    for entry in &board.entries {
        state.apply_cached(entry, cache.as_ref())?;
    }
    Ok(state)
}

/// Check every ballot entry in parallel against the round key and the first sign-up of its
/// pseudonym. Returns `None` when the board has no usable round key, in which case the
/// sequential replay reports the real error.
pub fn precheck_ballots(board: &Board) -> Option<BallotCache> {
    // The round key is the first `round.key` entry; the state machine checks it is where it
    // belongs. Here it only has to parse: a wrong key makes every proof fail, which the
    // replay then reports entry by entry.
    let mut head = State::new();
    for entry in &board.entries {
        if head.phase() == Phase::Voting {
            break;
        }
        if head.apply(entry).is_err() {
            return None;
        }
    }
    let round = head.round_public()?.clone();
    let mut keys: HashMap<String, VerifyingKey> = HashMap::new();
    for entry in board.entries.iter().filter(|e| e.kind == kind::SIGNUP) {
        if let Ok(s) = payload::<Signup>(entry) {
            if let Ok(k) = voter_key(&s.voter_key) {
                keys.entry(s.nym).or_insert(k);
            }
        }
    }
    let ballots: Vec<&Entry> = board
        .entries
        .iter()
        .filter(|e| e.kind == kind::BALLOT)
        .collect();
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1)
        .clamp(1, 16);
    let chunk = ballots.len().div_ceil(threads).max(1);
    let results: Vec<(u64, BallotCheck)> = std::thread::scope(|scope| {
        let handles: Vec<_> = ballots
            .chunks(chunk)
            .map(|part| {
                let round = &round;
                let keys = &keys;
                scope.spawn(move || {
                    part.iter()
                        .filter_map(|entry| {
                            let b: Ballot = payload(entry).ok()?;
                            let key = *keys.get(b.nym.as_str())?;
                            Some((entry.seq, (key, check_ballot(&b, round, &key))))
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().expect("ballot check thread"))
            .collect()
    });
    Some(results.into_iter().collect())
}

/// The verifier: everything `replay` checks, plus that the board ends with a tally. Returns
/// the tally. This uses nothing but the board.
pub fn verify_board(board: &Board) -> Result<Tally, BoothError> {
    let state = replay(board)?;
    state.tally().cloned().ok_or(BoothError::NoTally)
}
