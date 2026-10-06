//! The operator's side: builds a board by running every entry through the state machine
//! before publishing it, and computes the counts once enough guardians have decrypted.

use crate::board::Board;
use crate::error::BoothError;
use crate::group::g;
use crate::guardian::{derive_round_key, Commitments};
use crate::state::{Phase, State};
use crate::wire::{
    kind, Ballot, Close, GuardianCommitment, PartialDecryption, RoundParams, Signup, Tally,
};
use curve25519_dalek::ristretto::RistrettoPoint;
use curve25519_dalek::traits::Identity;
use serde::Serialize;

/// A round being run.
#[derive(Debug, Clone)]
pub struct Round {
    board: Board,
    state: State,
}

impl Round {
    /// Open a round: publish the parameters, every guardian's commitments (in index order)
    /// and the derived key.
    pub fn open(
        params: &RoundParams,
        commitments: &[GuardianCommitment],
    ) -> Result<Self, BoothError> {
        let mut round = Self {
            board: Board::new(),
            state: State::new(),
        };
        round.push(kind::PARAMS, params)?;
        for c in commitments {
            round.push(kind::GUARDIAN, c)?;
        }
        if round.state.phase() != Phase::Key {
            return Err(BoothError::Params(format!(
                "{} commitments for {} guardians",
                commitments.len(),
                params.guardians
            )));
        }
        let parsed = commitments
            .iter()
            .map(|c| Commitments::parse(c, &params.round_id, params.threshold))
            .collect::<Result<Vec<_>, _>>()?;
        round.push(kind::KEY, &derive_round_key(&parsed))?;
        Ok(round)
    }

    /// The board so far.
    pub fn board(&self) -> &Board {
        &self.board
    }

    /// The replayed state.
    pub fn state(&self) -> &State {
        &self.state
    }

    /// Register a voter.
    pub fn signup(&mut self, s: &Signup) -> Result<(), BoothError> {
        self.push(kind::SIGNUP, s)
    }

    /// Publish a ballot (after checking it).
    pub fn cast(&mut self, b: &Ballot) -> Result<(), BoothError> {
        self.push(kind::BALLOT, b)
    }

    /// Close voting.
    pub fn close(&mut self) -> Result<(), BoothError> {
        self.push(kind::CLOSE, &Close {})
    }

    /// Publish a guardian's partial decryption (after checking its proofs).
    pub fn add_partial(&mut self, p: &PartialDecryption) -> Result<(), BoothError> {
        self.push(kind::PARTIAL, p)
    }

    /// Combine the partial decryptions of `guardians_used`, recover the counts and publish
    /// the tally.
    pub fn tally(&mut self, guardians_used: &[u32]) -> Result<Tally, BoothError> {
        if self.state.phase() != Phase::Closed {
            return Err(BoothError::OutOfOrder {
                seq: self.board.entries.len() as u64,
                kind: kind::TALLY.to_string(),
                reason: format!("phase {:?}", self.state.phase()),
            });
        }
        let decrypted = self.state.combine(guardians_used)?;
        let aggregates = self.state.aggregates();
        let counted = self.state.counted() as u64;
        let counts = aggregates
            .iter()
            .zip(&decrypted)
            .enumerate()
            .map(|(opt, ((_, b), d))| {
                discrete_log(&(b - d), counted).ok_or(BoothError::TallyMismatch(opt))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let tally = Tally {
            signups: self.state.signup_count() as u64,
            counted,
            counts,
            guardians_used: guardians_used.to_vec(),
        };
        self.push(kind::TALLY, &tally)?;
        Ok(tally)
    }

    fn push<T: Serialize>(&mut self, kind: &str, payload: &T) -> Result<(), BoothError> {
        let entry = self.board.append(kind, payload)?.clone();
        if let Err(e) = self.state.apply(&entry) {
            self.board.entries.pop();
            return Err(e);
        }
        Ok(())
    }
}

/// `n` with `target = n·G` for `0 <= n <= max`, by walking from 0.
pub fn discrete_log(target: &RistrettoPoint, max: u64) -> Option<u64> {
    let mut acc = RistrettoPoint::identity();
    let base = g();
    for n in 0..=max {
        if acc == *target {
            return Some(n);
        }
        acc += base;
    }
    None
}
