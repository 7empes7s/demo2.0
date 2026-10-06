//! Phase 3 acceptance (docs/architecture/00-overview.md section 7), as far as v1 goes:
//!
//! (a) Re-vote: "a coerced vote followed by a private re-vote results in only the re-vote
//!     being counted, and no public artefact reveals that a re-vote happened." The first half
//!     holds and is tested. The second half does NOT hold in v1 and the test says exactly which
//!     public artefacts reveal it (the spec's "alternative considered" admits this leak for a
//!     homomorphic tally). See README "Receipt-freeness".
//! (b) A 10,000-ballot election whose tally a verifier confirms from the published board
//!     alone. The verifier here is this crate's `verify_board` fed a JSON round trip of the
//!     board; the independent verifier from another codebase is still to come.

use d2_booth::wire::{kind, Ballot, ROUND_SCHEMA};
use d2_booth::{run_dkg, verify_board, Board, Round, RoundParams, Voter};
use rand::rngs::StdRng;
use rand::SeedableRng;
use std::collections::BTreeMap;
use std::time::Instant;

fn params(round_id: &str, options: &[&str], n: u32, k: u32) -> RoundParams {
    RoundParams {
        schema: ROUND_SCHEMA.to_string(),
        round_id: round_id.to_string(),
        matter_id: "matter:acceptance".to_string(),
        options: options.iter().map(|s| s.to_string()).collect(),
        guardians: n,
        threshold: k,
    }
}

/// A full round: `script[i]` is the list of choices voter `i` casts, in order.
fn election(seed: u64, round_id: &str, script: &[Vec<usize>]) -> Board {
    let mut rng = StdRng::seed_from_u64(seed);
    let p = params(round_id, &["yes", "no", "abstain"], 3, 2);
    let (commitments, keys) = run_dkg(round_id, 3, 2, &mut rng).unwrap();
    let mut round = Round::open(&p, &commitments).unwrap();
    let public = round.state().round_public().unwrap().clone();
    let voters: Vec<Voter> = (0..script.len())
        .map(|i| Voter::new(&format!("nym-{i:03}"), &mut rng))
        .collect();
    for v in &voters {
        round.signup(&v.signup()).unwrap();
    }
    let turns = script.iter().map(Vec::len).max().unwrap_or(0);
    for turn in 0..turns {
        for (v, choices) in voters.iter().zip(script) {
            if let Some(&c) = choices.get(turn) {
                round
                    .cast(&v.ballot(&public, c, &mut rng).unwrap())
                    .unwrap();
            }
        }
    }
    round.close().unwrap();
    let aggregates = round.state().aggregates();
    for key in &keys[..2] {
        round
            .add_partial(&key.partial_decryption(round_id, &aggregates, &mut rng))
            .unwrap();
    }
    round.tally(&[1, 2]).unwrap();
    round.board().clone()
}

/// Ballots per pseudonym on a board.
fn ballots_per_nym(board: &Board) -> BTreeMap<String, usize> {
    let mut m = BTreeMap::new();
    for e in board.entries.iter().filter(|e| e.kind == kind::BALLOT) {
        let b: Ballot = serde_json::from_value(e.payload.clone()).unwrap();
        *m.entry(b.nym).or_insert(0) += 1;
    }
    m
}

#[test]
fn re_vote_only_the_re_vote_counts_and_the_leak_is_exactly_the_admitted_one() {
    // 40 voters. Voter 7 is coerced into "yes" (0) and later re-votes "no" (1) in private.
    let mut base: Vec<Vec<usize>> = (0..40).map(|i| vec![(i * 5 + 1) % 3]).collect();
    base[7] = vec![1];
    let no_coercion = base.clone();
    let mut coerced = base;
    coerced[7] = vec![0, 1];

    let board_a = election(21, "booth:revote", &coerced);
    let board_b = election(22, "booth:revote", &no_coercion);
    let tally_a = verify_board(&board_a).unwrap();
    let tally_b = verify_board(&board_b).unwrap();

    // Only the re-vote counts: the tallies agree option by option, and the coerced "yes"
    // is not in the count.
    assert_eq!(tally_a.counts, tally_b.counts);
    assert_eq!(tally_a.counted, 40);
    assert_eq!(tally_a.signups, 40);
    let yes_without_7 = no_coercion.iter().filter(|c| c[0] == 0).count() as u64;
    assert_eq!(tally_a.counts[0], yes_without_7);

    // Every ballot on both boards has the same shape and the same size, so a ballot's bytes
    // say nothing about whether it is a first vote or a re-vote.
    let sizes = |b: &Board| -> Vec<usize> {
        b.entries
            .iter()
            .filter(|e| e.kind == kind::BALLOT)
            .map(|e| d2_booth::board::canonical(&e.payload).unwrap().len())
            .collect()
    };
    let sa = sizes(&board_a);
    let sb = sizes(&board_b);
    assert_eq!(
        sa.iter().collect::<std::collections::BTreeSet<_>>().len(),
        1
    );
    assert_eq!(sa[0], sb[0]);

    // The tally entry itself is identical in content on both boards.
    assert_eq!(
        board_a.entries.last().unwrap().payload,
        board_b.entries.last().unwrap().payload
    );

    // What the public board DOES reveal, exactly, in v1:
    // 1. one more ballot than sign-ups: somebody re-voted;
    assert_eq!(board_a.entries.len(), board_b.entries.len() + 1);
    let kinds = |b: &Board| b.entries.iter().map(|e| e.kind.clone()).collect::<Vec<_>>();
    let mut ka = kinds(&board_a);
    let pos = ka.iter().rposition(|k| k == kind::BALLOT).unwrap();
    ka.remove(pos);
    assert_eq!(ka, kinds(&board_b));
    // 2. which pseudonym did: two ballots carry nym-007 on board A, one on board B.
    let per_a = ballots_per_nym(&board_a);
    let per_b = ballots_per_nym(&board_b);
    assert_eq!(per_a["nym-007"], 2);
    assert_eq!(per_b["nym-007"], 1);
    let others_a: Vec<_> = per_a.iter().filter(|(n, _)| *n != "nym-007").collect();
    let others_b: Vec<_> = per_b.iter().filter(|(n, _)| *n != "nym-007").collect();
    assert_eq!(others_a, others_b);
    // So a coercer who knows the voter's pseudonym learns that a re-vote happened. That is
    // the leak 02-protocols section 2 admits for a homomorphic tally and the reason the
    // Phase 3 criterion is not met by v1; the MACI-style processing proof is what removes it.
}

#[test]
fn ten_thousand_ballots_verified_from_the_published_board_alone() {
    const VOTERS: usize = 10_000;
    let round_id = "booth:10k";
    let mut rng = StdRng::seed_from_u64(31);
    let p = params(round_id, &["yes", "no", "abstain"], 5, 3);
    let (commitments, keys) = run_dkg(round_id, 5, 3, &mut rng).unwrap();
    let mut round = Round::open(&p, &commitments).unwrap();
    let public = round.state().round_public().unwrap().clone();

    let t0 = Instant::now();
    let voters: Vec<Voter> = (0..VOTERS)
        .map(|i| Voter::new(&format!("nym-{i:05}"), &mut rng))
        .collect();
    for v in &voters {
        round.signup(&v.signup()).unwrap();
    }
    // Voters encrypt on their own devices, so in parallel here; the operator checks and
    // publishes each ballot in order. Every 97th voter re-votes.
    let mut expected = [0u64; 3];
    let mut plan: Vec<(usize, Vec<usize>)> = Vec::with_capacity(VOTERS);
    for i in 0..VOTERS {
        let first = (i * 7919) % 3;
        let choices = if i % 97 == 0 {
            vec![first, (first + 1) % 3]
        } else {
            vec![first]
        };
        expected[*choices.last().unwrap()] += 1;
        plan.push((i, choices));
    }
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    let ballots: Vec<Vec<Ballot>> = std::thread::scope(|scope| {
        let handles: Vec<_> = plan
            .chunks(VOTERS.div_ceil(threads))
            .enumerate()
            .map(|(t, part)| {
                let voters = &voters;
                let public = &public;
                scope.spawn(move || {
                    let mut rng = StdRng::seed_from_u64(1000 + t as u64);
                    part.iter()
                        .map(|(i, choices)| {
                            choices
                                .iter()
                                .map(|&c| voters[*i].ballot(public, c, &mut rng).unwrap())
                                .collect::<Vec<_>>()
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().unwrap())
            .collect()
    });
    let encrypt_time = t0.elapsed();
    let t0 = Instant::now();
    // First choices of everyone, then the re-votes, so re-votes land later on the board.
    for turn in 0..2 {
        for per_voter in &ballots {
            if let Some(b) = per_voter.get(turn) {
                round.cast(b).unwrap();
            }
        }
    }
    let cast_time = t0.elapsed();
    round.close().unwrap();
    let aggregates = round.state().aggregates();
    for &j in &[1u32, 3, 5] {
        round
            .add_partial(&keys[j as usize - 1].partial_decryption(round_id, &aggregates, &mut rng))
            .unwrap();
    }
    let tally = round.tally(&[1, 3, 5]).unwrap();
    assert_eq!(tally.counts, expected.to_vec());
    assert_eq!(tally.counted, VOTERS as u64);
    assert_eq!(tally.signups, VOTERS as u64);
    assert_eq!(
        round.state().ballot_count(),
        VOTERS as u64 + (VOTERS as u64).div_ceil(97)
    );

    // Publish: the verifier gets JSON and nothing else.
    let published = serde_json::to_string(round.board()).unwrap();
    drop(round);
    drop(keys);
    let t1 = Instant::now();
    let board: Board = serde_json::from_str(&published).unwrap();
    let verified = verify_board(&board).unwrap();
    let verify_time = t1.elapsed();
    assert_eq!(verified, tally);
    eprintln!(
        "10k election: {} entries, {} KiB of board, encrypt {:.1?} ({threads} threads), operator check {:.1?}, verify {:.1?}",
        board.entries.len(),
        published.len() / 1024,
        encrypt_time,
        cast_time,
        verify_time
    );
}
